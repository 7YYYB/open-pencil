import type { UIMessage } from 'ai'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { resolveEditorProfile } from '@open-pencil/core'

import { prepareImageAttachment, revokeImagePreviewURL } from '@/app/ai/attachment/image/prepare'
import { setMessageAttachments } from '@/app/ai/attachment/presentation/store'
import type { ImagePresentation } from '@/app/ai/attachment/presentation/types'
import { resolveReferencedNodes } from '@/app/ai/chat/context'
import { referenceLink } from '@/app/ai/chat/references/link'
import type { ChatSubmission } from '@/app/ai/chat/submission/types'
import type { EditorStore } from '@/app/editor/active-store'
import { exportBoard } from '@/app/editor/boards/actions'
import {
  generateWholeBoard,
  regenerateSelectedElement,
  splitSelectedBoard
} from '@/app/editor/boards/layers/actions'
import { imageAtSelection } from '@/app/editor/boards/layers/source'
import type { BoardJobOptions } from '@/app/editor/boards/layers/split'
import {
  isAnotherBoard,
  STUDIO_RESULT_PART,
  studioBusy,
  studioIntent,
  studioResult,
  type StudioJob
} from '@/app/editor/boards/workbench'

interface Options {
  editor: EditorStore
  conversation(): string | undefined
  messages(): UIMessage[]
  append(id: string, messages: UIMessage[]): Promise<void>
  restore(message: ChatSubmission): void
}

export function useBoardStudio({ editor, conversation, messages, append, restore }: Options) {
  const busy = studioBusy(editor)
  const pending = shallowRef<ChatSubmission>()
  const progress = ref('')
  const error = ref('')
  const mode = ref<'edit-image' | null>(null)
  const image = computed(() => {
    void editor.state.sceneVersion
    return imageAtSelection(editor)
  })
  const selection = computed(() => {
    void editor.state.sceneVersion
    return resolveReferencedNodes(editor.graph, [...editor.state.selectedIds])
  })
  let controller: AbortController | undefined

  function stop() {
    controller?.abort()
  }

  watch(
    () => [editor.graph, editor.state.currentPageId, conversation()],
    () => {
      stop()
      mode.value = null
      error.value = ''
    }
  )
  watch(
    () => image.value?.id,
    () => {
      if (mode.value === 'edit-image') mode.value = null
    },
    { flush: 'sync' }
  )
  onScopeDispose(stop)

  function generationContext(kind: StudioJob, text: string, target?: string) {
    if (kind !== 'generate' || !isAnotherBoard(text)) return { brief: text }
    const versions = messages().flatMap((entry) => {
      const result = studioResult(entry)
      return result?.kind === 'generate' ? [result] : []
    })
    const previous = versions.findLast(({ nodeId }) => nodeId === target) ?? versions.at(-1)
    const brief = previous?.brief
      ? `${previous.brief.split('\n新版要求：')[0]}\n新版要求：${text}`
      : text
    const referenceId = target ?? previous?.nodeId
    return {
      brief,
      referenceId:
        referenceId && editor.graph.getNode(referenceId)?.visible ? referenceId : undefined
    }
  }

  async function run(
    kind: StudioJob,
    message: ChatSubmission,
    target = image.value?.id,
    restoreDraft = true
  ) {
    const id = conversation()
    if (!id || busy.value || !resolveEditorProfile(editor.state).edits) return false
    const pageId = editor.state.currentPageId
    const task = new AbortController()
    controller = task
    busy.value = true
    pending.value = message
    progress.value = '正在准备…'
    error.value = ''
    const options: BoardJobOptions = {
      signal: task.signal,
      progress: (text) => {
        progress.value = text.replace(/^\d\/\d\s*/, '')
      }
    }
    let completed = false
    try {
      const request = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: message.displayText }]
      } satisfies UIMessage
      const previews = await referencePreviews(message, request.id)
      task.signal.throwIfAborted()
      const context = generationContext(kind, message.displayText, target)
      const result = await executeStudioJob(editor, kind, message, target, {
        ...options,
        ...context
      })
      completed = true
      mode.value = null
      if (previews.length) setMessageAttachments(request.id, previews)
      await append(id, [
        request,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: [
            { type: 'text', text: result.text },
            {
              type: STUDIO_RESULT_PART,
              data: {
                kind,
                nodeId: result.nodeId,
                brief: kind === 'generate' ? context.brief : undefined
              }
            }
          ]
        }
      ])
    } catch (problem) {
      if (conversation() === id && editor.state.currentPageId === pageId) {
        const reason = problem instanceof Error ? problem.message : '创作任务失败，请重试。'
        error.value = task.signal.aborted ? '本次操作已停止。' : reason
      }
    } finally {
      const retryable = !completed && conversation() === id && editor.state.currentPageId === pageId
      if (retryable && restoreDraft) restore(message)
      else for (const item of message.images) revokeImagePreviewURL(item.previewURL)
      controller = undefined
      pending.value = undefined
      progress.value = ''
      busy.value = false
    }
    return true
  }

  function intent(message: ChatSubmission) {
    const currentPage = editor.graph.getNode(editor.state.currentPageId)
    return (
      mode.value ??
      studioIntent(message.displayText, Boolean(image.value), !currentPage?.childIds.length)
    )
  }

  function withSelection(message: ChatSubmission): ChatSubmission {
    if (message.nodes.length || !selection.value.length || message.displayText.startsWith('/'))
      return message
    const context = selection.value
      .map((node) => referenceLink({ kind: 'node', id: node.id, label: node.name }))
      .join(' ')
    return {
      ...message,
      modelText: `${message.modelText}\n\n当前选区：${context}。先读取这些图层的最新状态，仅在我的要求涉及它们时修改。`
    }
  }

  async function save(format: 'png' | 'jpg') {
    try {
      await exportBoard(editor, format)
    } catch (problem) {
      error.value = problem instanceof Error ? problem.message : '导出失败。'
    }
  }

  return {
    busy,
    pending,
    progress,
    error,
    mode,
    selection,
    image,
    run,
    stop,
    intent,
    withSelection,
    save
  }
}

function referencePreviews(message: ChatSubmission, messageId: string) {
  return Promise.all(
    message.images.map(async ({ file }): Promise<ImagePresentation> => {
      const prepared = await prepareImageAttachment(file, 360)
      return {
        id: crypto.randomUUID(),
        messageId,
        kind: 'image',
        name: file.name,
        mediaType: prepared.mediaType,
        preview: prepared.blob,
        originalSize: { x: prepared.originalWidth, y: prepared.originalHeight }
      }
    })
  )
}

function orientation(text: string) {
  if (/横版|横向|landscape/i.test(text)) return true
  if (/竖版|竖向|portrait/i.test(text)) return false
}

function executeStudioJob(
  editor: EditorStore,
  kind: StudioJob,
  message: ChatSubmission,
  target: string | undefined,
  options: BoardJobOptions & { brief: string; referenceId?: string }
) {
  if (kind === 'generate') {
    return generateWholeBoard(editor, options.brief, message.images, {
      ...options,
      landscape: orientation(message.displayText)
    })
  }
  if (kind === 'split') return splitSelectedBoard(editor, options, target)
  return regenerateSelectedElement(editor, message.displayText, options, target, message.images)
}
