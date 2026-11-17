import { expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { imageDataURL } from '@open-pencil/scene-graph/images'

import { referenceAttachmentBytes } from '@/app/editor/boards/images/attachment'

const firstPNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0
])
const secondPNG = Uint8Array.from([...firstPNG, 1, 2, 3])

test('uses the requested image from the newest user turn, ignoring tool and older images', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: firstPNG }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Earlier response' }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Use the second reference' },
        { type: 'file', mediaType: 'application/pdf', data: 'ignored' },
        { type: 'file', mediaType: 'image/png', data: { type: 'data', data: firstPNG } },
        { type: 'file', mediaType: 'image/png', data: imageDataURL(secondPNG) }
      ]
    }
  ]
  expect(referenceAttachmentBytes(messages, 2)).toEqual(secondPNG)
  expect(referenceAttachmentBytes(messages, 1)).toEqual(firstPNG)
})

test('does not silently select an older attachment when the newest user has no pictures', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: [{ type: 'file', mediaType: 'image/png', data: firstPNG }] },
    { role: 'user', content: 'New request with no picture' }
  ]
  expect(() => referenceAttachmentBytes(messages, 1)).toThrow('最新用户消息')
})

test('accepts SDK tagged data URLs but refuses external image links and invalid indices', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/png',
          data: { type: 'url', url: imageDataURL(firstPNG) }
        },
        { type: 'file', mediaType: 'image/png', data: new URL('https://example.com/reference.png') }
      ]
    }
  ]
  expect(referenceAttachmentBytes(messages, 1)).toEqual(firstPNG)
  expect(() => referenceAttachmentBytes(messages, 2)).toThrow('本地附加')
  expect(() => referenceAttachmentBytes(messages, 0)).toThrow('从 1 开始')
})
