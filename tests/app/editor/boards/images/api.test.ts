import { expect, test } from 'bun:test'

import { fromUint8Array } from 'js-base64'

import { requestBoardImageAPI } from '@/app/editor/boards/images/api'
import type { FetchFunction } from '@/app/http/types'

// The PNG signature and IHDR suffice for validating the transport's image header contract.
const png = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0
])
const opaquePNG = Uint8Array.from([...png.slice(0, 25), 2, ...png.slice(26)])
const config = { baseURL: 'https://images.example/v1/', model: 'image-test', apiKey: 'test-secret' }

test('sends the configured image model to generations and imports base64 bytes', async () => {
  let sentURL = ''
  let sentBody = ''
  const fetcher: FetchFunction = async (url, init) => {
    sentURL = String(url)
    sentBody = String(init?.body)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-secret')
    return Response.json({ data: [{ b64_json: fromUint8Array(png) }] })
  }
  const result = await requestBoardImageAPI(
    config,
    { prompt: '陶土角色', size: '1024x1536' },
    fetcher
  )
  expect(sentURL).toBe('https://images.example/v1/images/generations')
  expect(JSON.parse(sentBody)).toEqual({
    model: 'image-test',
    prompt: '陶土角色',
    size: '1024x1536',
    n: 1
  })
  expect(result).toEqual(png)
})

test('sends a reference as multipart edits and downloads results without the API credential', async () => {
  let calls = 0
  const fetcher: FetchFunction = async (url, init) => {
    calls++
    if (calls === 1) {
      expect(String(url)).toBe('https://images.example/v1/images/edits')
      expect(init?.body).toBeInstanceOf(FormData)
      const body = init?.body
      if (!(body instanceof FormData)) throw new Error('Expected edit multipart')
      expect(body.get('model')).toBe('image-test')
      expect(body.get('image')).toBeInstanceOf(Blob)
      expect(body.get('background')).toBe('transparent')
      expect(body.get('output_format')).toBe('png')
      return Response.json({ data: [{ url: 'https://cdn.example/result.png' }] })
    }
    expect(String(url)).toBe('https://cdn.example/result.png')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    return new Response(png)
  }
  expect(
    await requestBoardImageAPI(
      config,
      { prompt: '换成红衣', size: '1024x1024', reference: png, transparent: true },
      fetcher
    )
  ).toEqual(png)
  expect(calls).toBe(2)
})

test('cancels the provider request when the design reply stops', async () => {
  const controller = new AbortController()
  let requestSignal: AbortSignal | null | undefined
  const fetcher: FetchFunction = async (_url, init) => {
    requestSignal = init?.signal
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      controller.abort(new DOMException('Stopped', 'AbortError'))
    })
  }
  await expect(
    requestBoardImageAPI(config, { prompt: '角色', size: '1024x1024' }, fetcher, controller.signal)
  ).rejects.toThrow('Stopped')
  expect(requestSignal?.aborted).toBe(true)
})

test('does not import an empty or non-image response as a successful layer', async () => {
  const fetcher: FetchFunction = async () =>
    Response.json({
      data: [{ b64_json: fromUint8Array(new TextEncoder().encode('not an image')) }]
    })
  await expect(
    requestBoardImageAPI(config, { prompt: '角色', size: '1024x1024' }, fetcher)
  ).rejects.toThrow('不是有效图片')
})

test('requests transparent PNG output and refuses a PNG without alpha', async () => {
  let body: Record<string, unknown> = {}
  const fetcher: FetchFunction = async (_url, init) => {
    body = JSON.parse(String(init?.body))
    return Response.json({ data: [{ b64_json: fromUint8Array(opaquePNG) }] })
  }
  await expect(
    requestBoardImageAPI(config, { prompt: '青禾', size: '1024x1024', transparent: true }, fetcher)
  ).rejects.toThrow('没有真正的 Alpha 透明通道')
  expect(body).toMatchObject({ background: 'transparent', output_format: 'png', quality: 'high' })
})

test('explains when a compatible endpoint refuses transparent PNG options', async () => {
  const fetcher: FetchFunction = async () => new Response(null, { status: 400 })
  await expect(
    requestBoardImageAPI(config, { prompt: '青禾', size: '1024x1024', transparent: true }, fetcher)
  ).rejects.toThrow('不支持透明 PNG 文字素材')
})
