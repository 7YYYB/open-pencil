import { describe, expect, mock, spyOn, test } from 'bun:test'

import type { Chat } from '@ai-sdk/vue'
import type { FileUIPart, UIMessage } from 'ai'
import { ref, shallowRef } from 'vue'

import { SceneGraph } from '@open-pencil/scene-graph'
import { parseDataURL } from '@open-pencil/scene-graph/images'
import { expectDefined } from '@open-pencil/test-support/assert'
import { asDouble } from '@open-pencil/test-support/doubles'

import { AgentSetupError } from '@/app/ai/agents/setup/readiness'
import type { PreparedImageAttachment } from '@/app/ai/attachment/image/types'
import {
  attachmentsForMessage,
  deleteMessageAttachments,
  setMessageAttachments
} from '@/app/ai/attachment/presentation/store'
import { prepareSubmittedImages } from '@/app/ai/chat/submission/images'
import { useChatSubmission } from '@/app/ai/chat/submission/use'
import { modelSettingsSnapshot, replaceAIModelSettings } from '@/app/ai/models'
import type { EditorStore } from '@/app/editor/active-store'
const messages = ref({
  openSettings: 'Open settings',
  requestFailed: 'Request failed',
  visionUnavailable: 'Vision unavailable',
  cloudUnavailable: 'Cloud AI unavailable',
  runSetup: 'Run guided setup',
  agentSetup: {
    'companion-missing': 'Companion missing',
    'companion-outdated': 'Companion outdated',
    'mcp-outdated': 'MCP outdated',
    'pi-sign-in': 'Pi sign-in',
    'pi-model': 'Pi model'
  }
})

function submission(
  ensureChat: () => Promise<Chat<UIMessage> | null>,
  overrides: Partial<Parameters<typeof useChatSubmission>[0]> = {}
) {
  const reportError = mock(() => undefined)
  const openSetup = mock(() => undefined)
  const chat = useChatSubmission({
    chat: shallowRef<Chat<UIMessage> | null>(null),
    ensureChat,
    clearFailure: () => undefined,
    getEditor: () => asDouble<EditorStore>({}),
    messages,
    reportError,
    openModelSettings: () => undefined,
    openSetup,
    ...overrides
  })
  return { chat, reportError, openSetup }
}

const message = { modelText: 'Draw a card', displayText: 'Draw a card', images: [], nodes: [] }
const preparedImage: PreparedImageAttachment = {
  data: new Uint8Array([1, 2, 3]),
  blob: new Blob(['png'], { type: 'image/png' }),
  mediaType: 'image/png',
  originalWidth: 100,
  originalHeight: 100,
  width: 100,
  height: 100
}

describe('useChatSubmission', () => {
  test('reports an unsent message so the composer can keep it', async () => {
    const { chat } = submission(async () => null)
    expect(await chat.submit(message)).toBe(false)
  })

  test('names the setup problem that stopped an agent chat and offers guided setup', async () => {
    const { chat, reportError, openSetup } = submission(async () => {
      throw new AgentSetupError('mcp-outdated')
    })
    expect(await chat.submit(message)).toBe(false)
    expect(reportError).toHaveBeenCalledWith('MCP outdated', {
      label: 'Run guided setup',
      run: openSetup
    })
  })

  test('keeps the previews of an unsent message for the composer to take back', async () => {
    const revoke = spyOn(URL, 'revokeObjectURL')
    try {
      const { chat } = submission(async () => null)
      const image = { file: new File(['png'], 'card.png'), previewURL: 'blob:card' }
      expect(await chat.submit({ ...message, images: [image] })).toBe(false)
      expect(revoke).not.toHaveBeenCalled()
    } finally {
      revoke.mockRestore()
    }
  })

  test('hands back a message that failed before reaching the chat', async () => {
    const target = fakeChat()
    const { chat } = submission(async () => target)
    // The editor stand-in cannot snapshot the referenced layer, which fails before sending.
    const node = { id: '1:2', name: 'Card', type: 'FRAME' as const }
    expect(await chat.submit({ ...message, nodes: [node] })).toBe(false)
    expect(target.messages).toEqual([])
  })

  test('takes back a message whose images could not be prepared', async () => {
    const revoke = spyOn(URL, 'revokeObjectURL')
    try {
      const target = fakeChat()
      const { chat } = submission(async () => target)
      const image = { file: new File(['not an image'], 'card.png'), previewURL: 'blob:card' }
      expect(await chat.submit({ ...message, images: [image] })).toBe(false)
      expect(target.messages).toEqual([])
      expect(revoke).not.toHaveBeenCalled()
    } finally {
      revoke.mockRestore()
    }
  })

  test('shows a message as sending until the chat it waits for takes it in', async () => {
    const connected = Promise.withResolvers<Chat<UIMessage> | null>()
    const { chat } = submission(() => connected.promise)
    const submitted = chat.submit(message)
    expect(chat.sending.value).toEqual(message)
    connected.resolve(fakeChat())
    expect(await submitted).toBe(true)
    expect(chat.sending.value).toBeNull()
  })

  test('stops showing a message that never reached the chat', async () => {
    const { chat } = submission(async () => null)
    const submitted = chat.submit(message)
    expect(chat.sending.value).toEqual(message)
    expect(await submitted).toBe(false)
    expect(chat.sending.value).toBeNull()
  })

  test('delivers reference files to the visual Design model without needing a Vision assignment', async () => {
    const settings = modelSettingsSnapshot()
    const revoke = spyOn(URL, 'revokeObjectURL')
    try {
      const selected = structuredClone(settings)
      expectDefined(
        selected.models.find((profile) => profile.id === selected.assignments.design),
        'Design profile'
      ).capabilities = ['tools', 'vision']
      selected.assignments.vision = null
      replaceAIModelSettings(selected)
      const send = mock<Chat<UIMessage>['sendMessage']>(async () => undefined)
      const target = fakeChat(send)
      const analyze = mock(async () => 'Vision must not be needed')
      const { chat } = submission(async () => target, {
        prepareImages: (editor, text, images, options) =>
          prepareSubmittedImages(editor, text, images, options, {
            prepare: async () => preparedImage,
            analyze
          })
      })
      const image = {
        file: new File(['png'], 'reference.png', { type: 'image/png' }),
        previewURL: 'blob:reference'
      }

      expect(await chat.submit({ ...message, images: [image] })).toBe(true)

      expect(analyze).not.toHaveBeenCalled()
      const request = send.mock.calls[0]?.[0]
      expect(request && 'text' in request ? request.text : undefined).toBe(message.modelText)
      const files = request?.files
      expect(Array.isArray(files)).toBe(true)
      if (!Array.isArray(files)) throw new Error('Expected image file parts')
      expect(files[0]?.filename).toBe('reference.png')
      expect(parseDataURL(files[0]?.url ?? '')?.bytes).toEqual(preparedImage.data)
      expect(revoke).toHaveBeenCalledWith('blob:reference')
      const id = expectDefined(target.messages[0]?.id, 'Submitted message')
      expect(attachmentsForMessage(id).value.map((attachment) => attachment.kind)).toEqual([
        'image'
      ])
      deleteMessageAttachments(id)
    } finally {
      replaceAIModelSettings(settings)
      revoke.mockRestore()
    }
  })

  test('stopping image preparation aborts it and hands the intact draft back without an error', async () => {
    const started = Promise.withResolvers<AbortSignal>()
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof prepareSubmittedImages>>>()
    const stop = mock(async () => undefined)
    const target = fakeChat()
    target.stop = stop
    const revoke = spyOn(URL, 'revokeObjectURL')
    try {
      const { chat, reportError } = submission(async () => target, {
        prepareImages: async (_editor, _text, _images, options) => {
          started.resolve(options.signal)
          return pending.promise
        }
      })
      const image = { file: new File(['png'], 'card.png'), previewURL: 'blob:card' }
      const sending = chat.submit({ ...message, images: [image] })
      const signal = await started.promise
      expect(target.messages.length).toBe(1)
      const id = target.messages[0].id

      await chat.stop()

      expect(await sending).toBe(false)
      expect(signal.aborted).toBe(true)
      expect(target.messages).toEqual([])
      expect(attachmentsForMessage(id).value).toEqual([])
      expect(chat.busy.value).toBe(false)
      expect(reportError).not.toHaveBeenCalled()
      expect(revoke).not.toHaveBeenCalled()
      expect(stop).toHaveBeenCalledTimes(1)
    } finally {
      revoke.mockRestore()
    }
  })

  test('editing and resending a message keeps its reference files and image previews', async () => {
    const file: FileUIPart = {
      type: 'file',
      mediaType: 'image/png',
      filename: 'reference.png',
      url: 'https://example.com/reference.png'
    }
    const send = mock<Chat<UIMessage>['sendMessage']>(async () => undefined)
    const target = fakeChat(send)
    target.messages = [
      { id: 'reference-resend', role: 'user', parts: [{ type: 'text', text: 'Old' }, file] }
    ]
    setMessageAttachments('reference-resend', [
      {
        id: 'reference-preview',
        messageId: 'reference-resend',
        kind: 'image',
        name: 'reference.png',
        preview: preparedImage.blob,
        mediaType: 'image/png',
        originalSize: { x: 100, y: 100 }
      }
    ])
    try {
      const { chat } = submission(async () => target, {
        chat: shallowRef(target),
        getEditor: () => asDouble<EditorStore>({ graph: new SceneGraph() })
      })

      await chat.resend('reference-resend', 'Use a larger title')

      expect(send.mock.calls[0]?.[0]?.files).toEqual([file])
      expect(
        attachmentsForMessage('reference-resend').value.map((attachment) => attachment.id)
      ).toEqual(['reference-preview'])
    } finally {
      deleteMessageAttachments('reference-resend')
    }
  })
})

function fakeChat(
  sendMessage: Chat<UIMessage>['sendMessage'] = async () => undefined
): Chat<UIMessage> {
  return asDouble<Chat<UIMessage>>({ messages: [], status: 'ready', sendMessage })
}
