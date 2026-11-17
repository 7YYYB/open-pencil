import type { FileUIPart } from 'ai'

import { imageDataURL } from '@open-pencil/scene-graph/images'

import {
  analyzeAttachedImages,
  designMessageWithImageFindings
} from '@/app/ai/attachment/image/analyze'
import { prepareImageAttachment, revokeImagePreviewURL } from '@/app/ai/attachment/image/prepare'
import {
  imageDraftPresentations,
  preparedImagePresentations
} from '@/app/ai/attachment/image/presentation'
import type { ImageAttachmentDraft } from '@/app/ai/attachment/image/types'
import { snapshotNodes } from '@/app/ai/attachment/node/snapshot'
import {
  deleteMessageAttachments,
  setMessageAttachments
} from '@/app/ai/attachment/presentation/store'
import { setVisibleMessageText } from '@/app/ai/chat/presentation'
import type { ChatInstance, ChatSubmission } from '@/app/ai/chat/submission/types'
import type { EditorStore } from '@/app/editor/active-store'
import { withAbortSignal } from '@/app/runtime/abort'

interface SubmittedImagesOptions {
  supportsImages: boolean
  signal: AbortSignal
}

interface SubmittedImagesDependencies {
  prepare: typeof prepareImageAttachment
  analyze: typeof analyzeAttachedImages
}

/** Sends references to a visual Design model itself, using a Vision summary only as a fallback. */
export async function prepareSubmittedImages(
  editor: EditorStore,
  text: string,
  images: ImageAttachmentDraft[],
  { supportsImages, signal }: SubmittedImagesOptions,
  dependencies: SubmittedImagesDependencies = {
    prepare: prepareImageAttachment,
    analyze: analyzeAttachedImages
  }
) {
  signal.throwIfAborted()
  const prepared = await withAbortSignal(
    Promise.all(images.map((image) => dependencies.prepare(image.file))),
    signal
  )
  signal.throwIfAborted()
  const files: FileUIPart[] = supportsImages
    ? prepared.map((image, index) => ({
        type: 'file',
        mediaType: image.mediaType,
        filename: images[index]?.file.name,
        url: imageDataURL(image.data)
      }))
    : []
  if (supportsImages) return { prepared, files, text }

  const findings = await dependencies.analyze(editor, text, prepared, undefined, { signal })
  return {
    prepared,
    files,
    text: designMessageWithImageFindings(
      text,
      images.map((image) => image.file.name),
      findings
    )
  }
}

interface ImageSubmissionOptions {
  chat: ChatInstance
  editor: EditorStore
  submission: ChatSubmission
  signal: AbortSignal
  supportsImages: boolean
  isCurrent: () => boolean
  dispatch: () => void
  withTurn: (chat: ChatInstance, send: () => Promise<void>) => Promise<void>
}

/** Shows an attachment message immediately, taking it back if preparation fails or is stopped. */
export async function sendAttachments(
  {
    chat,
    editor,
    submission,
    signal,
    supportsImages,
    isCurrent,
    dispatch,
    withTurn
  }: ImageSubmissionOptions,
  prepareImages = prepareSubmittedImages
): Promise<void> {
  const messageId = crypto.randomUUID()
  const nodeAttachments = snapshotNodes(editor, messageId, submission.nodes)
  chat.messages = [
    ...chat.messages,
    { id: messageId, role: 'user', parts: [{ type: 'text', text: submission.modelText }] }
  ]
  setVisibleMessageText(messageId, submission.displayText)
  setMessageAttachments(messageId, [
    ...nodeAttachments,
    ...imageDraftPresentations(messageId, submission.images)
  ])
  let sent = false
  try {
    let text = submission.modelText
    let files: FileUIPart[] = []
    if (submission.images.length > 0) {
      const images = await withAbortSignal(
        prepareImages(editor, text, submission.images, { supportsImages, signal }),
        signal
      )
      text = images.text
      files = images.files
      setMessageAttachments(messageId, [
        ...nodeAttachments,
        ...preparedImagePresentations(messageId, submission.images, images.prepared)
      ])
    }
    signal.throwIfAborted()
    if (!isCurrent()) return
    dispatch()
    sent = true
    for (const image of submission.images) revokeImagePreviewURL(image.previewURL)
    await withTurn(chat, () => chat.sendMessage({ messageId, text, files }).catch(() => undefined))
  } finally {
    if (!sent) {
      chat.messages = chat.messages.filter((message) => message.id !== messageId)
      deleteMessageAttachments(messageId)
    }
  }
}
