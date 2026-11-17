import type { DataContent, FilePart, ModelMessage } from 'ai'
import { isValid, toUint8Array } from 'js-base64'

import { imageHeader, parseDataURL } from '@open-pencil/scene-graph/images'

function dataBytes(data: DataContent | URL): Uint8Array | null {
  if (data instanceof Uint8Array) return data.slice()
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
  const value = data instanceof URL ? data.href : data
  return parseDataURL(value)?.bytes ?? (isValid(value) ? toUint8Array(value) : null)
}

function fileBytes(file: FilePart): Uint8Array | null {
  const { data } = file
  if (
    typeof data === 'string' ||
    data instanceof Uint8Array ||
    data instanceof ArrayBuffer ||
    data instanceof URL
  ) {
    return dataBytes(data)
  }
  if (data.type === 'data') return dataBytes(data.data)
  if (data.type === 'url') return dataBytes(data.url)
  return null
}

/** One-based image index in the newest user message, never an image from a tool or older turn. */
export function referenceAttachmentBytes(
  messages: readonly ModelMessage[],
  index: number
): Uint8Array {
  const user = messages.findLast((message) => message.role === 'user')
  const files =
    user && Array.isArray(user.content)
      ? user.content.filter(
          (part) =>
            part.type === 'file' &&
            (part.mediaType === 'image' || part.mediaType.startsWith('image/'))
        )
      : []
  const file = files[index - 1]
  if (!Number.isInteger(index) || index < 1 || !file || file.type !== 'file') {
    throw new Error('reference_attachment 必须是最新用户消息中图片的编号，从 1 开始。')
  }
  const bytes = fileBytes(file)
  const header = bytes ? imageHeader(bytes) : null
  if (!bytes || !header || !['image/png', 'image/jpeg', 'image/webp'].includes(header.type)) {
    throw new Error('参考附件必须是本地附加的 PNG、JPEG 或 WebP 图片；请重新附加图片。')
  }
  return bytes
}
