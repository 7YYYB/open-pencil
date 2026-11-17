import type { PromptRequest } from '@agentclientprotocol/sdk/unstable'
import type { UIMessage } from 'ai'
import { fromUint8Array } from 'js-base64'

import { parseDataURL } from '@open-pencil/scene-graph/images'

import { isImageAttachmentMediaType } from '@/app/ai/attachment/image/prepare'

/** The newest message's files go to the agent as image bytes, alongside its text. */
export function attachedImages(message: UIMessage | undefined): PromptRequest['prompt'] {
  const images: PromptRequest['prompt'] = []
  for (const part of message?.parts ?? []) {
    if (part.type !== 'file') continue
    if (!isImageAttachmentMediaType(part.mediaType)) {
      throw new Error('Choose a PNG, JPEG, or WebP image for this attachment.')
    }
    const image = parseDataURL(part.url)
    if (!image || image.bytes.length === 0) {
      throw new Error('Could not read the attached image. Please attach it again.')
    }
    if (image.mimeType !== part.mediaType) {
      throw new Error(
        'The attached image format does not match its media type. Please attach it again.'
      )
    }
    images.push({ type: 'image', data: fromUint8Array(image.bytes), mimeType: image.mimeType })
  }
  return images
}
