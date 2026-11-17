import { computed, markRaw, ref, shallowReadonly, shallowRef, type Ref } from 'vue'

import { snapshotNodes } from '@/app/ai/attachment/node/snapshot'
import {
  attachmentsForMessage,
  setMessageAttachments
} from '@/app/ai/attachment/presentation/store'
import { appendSkillContext } from '@/app/ai/chat/context'
import { setVisibleMessageText } from '@/app/ai/chat/presentation'
import { commandsAsText } from '@/app/ai/chat/references/command'
import { mentionedNodes } from '@/app/ai/chat/references/nodes'
import { reportSubmissionError, type SubmissionErrorOptions } from '@/app/ai/chat/submission/errors'
import { sendAttachments, type prepareSubmittedImages } from '@/app/ai/chat/submission/images'
import { chatToResend } from '@/app/ai/chat/submission/resend'
import { sendText } from '@/app/ai/chat/submission/text'
import type { ChatInstance, ChatSubmission } from '@/app/ai/chat/submission/types'
import { designModelProfile } from '@/app/ai/models'
import { restoreTurn, revertTurn } from '@/app/ai/reply/turns'
import { useUndoRecords } from '@/app/ai/reply/undo'
import { invokedSkill } from '@/app/ai/skills/invoke'
import type { EditorStore } from '@/app/editor/active-store'
import { withAbortSignal } from '@/app/runtime/abort'

interface SubmissionOptions extends SubmissionErrorOptions {
  chat: Ref<ChatInstance | null>
  ensureChat: () => Promise<ChatInstance | null>
  flush?: () => Promise<void>
  clearFailure: () => void
  getEditor: () => EditorStore
  prepare?: (chat: ChatInstance, text: string) => Promise<void> // e.g. compacting before `text`
  prepareImages?: typeof prepareSubmittedImages
}

export function useChatSubmission(options: SubmissionOptions) {
  const isPreparingAttachments = ref(false)
  /** A message sent but not in the chat yet, shown while the chat connects or compacts first. */
  const sending = shallowRef<ChatSubmission | null>(null)
  let operationVersion = 0
  let preparation: AbortController | null = null

  const undone = useUndoRecords(options)
  const { withTurn } = undone

  /** Redoes a reply's undone edits; Redo noticing them removes the marks. */
  async function restore(messageId: string): Promise<void> {
    if (!readyChat() || !restoreTurn(messageId)) return
    await options.flush?.().catch(() => undefined)
  }

  /** Undoes a reply's edits; the history change marks them, for the chat and the next request. */
  async function revert(messageId: string): Promise<void> {
    if (!readyChat() || !revertTurn(messageId)) return
    await options.flush?.().catch(() => undefined)
  }

  /**
   * Resolves to false when the message never reached the chat. The composer then takes the
   * submission back, attachments included, so their previews stay alive until it decides.
   */
  async function submit(submission: ChatSubmission): Promise<boolean> {
    if (isSubmitting()) {
      reportUnsentImages(submission)
      return false
    }

    const version = ++operationVersion
    const controller = new AbortController()
    preparation = controller
    // Whether the message was sent: after that, a failure must not hand it back.
    let sent = false
    const dispatch = () => {
      sent = true
      if (preparation === controller) preparation = null
      if (version === operationVersion) isPreparingAttachments.value = false
    }
    sending.value = submission
    isPreparingAttachments.value = submission.images.length > 0
    options.clearFailure()
    try {
      // Read before the version check below, so a cancel or newer message meanwhile wins.
      const skill = await withAbortSignal(invokedSkill(submission.displayText), controller.signal)
      const currentChat = await withAbortSignal(options.ensureChat(), controller.signal)
      if (currentChat && version === operationVersion) options.chat.value = markRaw(currentChat)
      if (!currentChat || version !== operationVersion) {
        reportUnsentImages(submission)
        return false
      }
      const supportsImages = designModelProfile.value?.capabilities.includes('vision') ?? false
      const note = undone.note(submission.modelText, currentChat.messages)
      const noted = { ...submission, modelText: appendSkillContext(note.text, skill) }
      if (options.prepare) {
        await withAbortSignal(options.prepare(currentChat, noted.modelText), controller.signal)
      }
      if (version !== operationVersion) return false
      const previousIds = new Set(currentChat.messages.map((message) => message.id))
      // Both ways of sending add the message to the chat at once, which shows it from then on.
      sending.value = null
      if (submission.images.length === 0 && submission.nodes.length === 0) {
        await sendText(currentChat, noted, dispatch, withTurn)
      } else {
        await sendAttachments(
          {
            chat: currentChat,
            editor: options.getEditor(),
            submission: noted,
            signal: controller.signal,
            supportsImages,
            isCurrent: () => version === operationVersion && options.chat.value === currentChat,
            dispatch,
            withTurn
          },
          options.prepareImages
        )
      }
      const request = currentChat.messages.find(
        (message) => message.role === 'user' && !previousIds.has(message.id)
      )
      if (request) undone.reported(currentChat, note.reports, request.id)
      return sent
    } catch (error) {
      if (!controller.signal.aborted && version === operationVersion) {
        reportSubmissionError(options, error)
      }
      return sent
    } finally {
      if (preparation === controller) preparation = null
      await options.flush?.().catch(() => undefined)
      if (version === operationVersion) {
        isPreparingAttachments.value = false
        sending.value = null
      }
    }
  }

  function isSubmitting(): boolean {
    const status = options.chat.value?.status ?? 'ready'
    return (
      status === 'streaming' ||
      status === 'submitted' ||
      isPreparingAttachments.value ||
      sending.value !== null
    )
  }

  function reportUnsentImages(submission: ChatSubmission): void {
    if (submission.images.length > 0) options.reportError(options.messages.value.requestFailed)
  }

  function readyChat(): ChatInstance | null {
    const currentChat = options.chat.value
    if (!currentChat || isPreparingAttachments.value) return null
    return currentChat.status === 'ready' || currentChat.status === 'error' ? currentChat : null
  }

  /** Asks again for the last reply, undoing its edits when it can, or for an unanswered request. */
  async function regenerate(): Promise<void> {
    const currentChat = await chatToResend(options, readyChat())
    const last = currentChat?.messages.at(-1)
    if (!currentChat || !last) return
    options.clearFailure()
    if (last.role === 'assistant') revertTurn(last.id)
    try {
      await withTurn(currentChat, () =>
        currentChat.regenerate({ messageId: last.id }).catch(() => undefined)
      )
    } finally {
      await options.flush?.().catch(() => undefined)
    }
  }

  /** Replaces the last user message and asks again, undoing the old reply's edits when it can. */
  async function resend(messageId: string, text: string): Promise<void> {
    const currentChat = await chatToResend(options, readyChat())
    const trimmed = text.trim()
    if (!currentChat || !trimmed) return
    const index = currentChat.messages.findIndex((message) => message.id === messageId)
    const later = currentChat.messages.slice(index + 1)
    if (index === -1 || later.some((message) => message.role === 'user')) return
    options.clearFailure()
    for (const message of later) if (message.role === 'assistant') revertTurn(message.id)
    // Replies after the edited message are replaced; what it reported needs a new report.
    const note = undone.note(commandsAsText(trimmed), currentChat.messages.slice(0, index))
    const skill = await invokedSkill(trimmed)
    setVisibleMessageText(messageId, trimmed)
    const files = currentChat.messages[index].parts.filter((part) => part.type === 'file')
    const images = attachmentsForMessage(messageId).value.filter(
      (attachment) => attachment.kind === 'image'
    )
    // The layers the edited text mentions replace the previews the message showed.
    const editor = options.getEditor()
    setMessageAttachments(messageId, [
      ...snapshotNodes(editor, messageId, mentionedNodes(editor.graph, trimmed)),
      ...images
    ])
    try {
      await withTurn(currentChat, () =>
        currentChat
          .sendMessage({ messageId, text: appendSkillContext(note.text, skill), files })
          .catch(() => undefined)
      )
      undone.reported(currentChat, note.reports, messageId)
    } finally {
      await options.flush?.().catch(() => undefined)
    }
  }

  function cancel(): void {
    operationVersion += 1
    preparation?.abort()
    preparation = null
    isPreparingAttachments.value = false
    sending.value = null
  }

  const busy = computed(() => isPreparingAttachments.value)

  return {
    busy,
    sending: shallowReadonly(sending),
    cancel,
    stop: () => {
      cancel()
      return options.chat.value?.stop()
    },
    submit,
    regenerate,
    resend,
    revert,
    restore
  }
}
