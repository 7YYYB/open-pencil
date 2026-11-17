import { isValid, toUint8Array } from 'js-base64'
import { joinURL } from 'ufo'
import * as v from 'valibot'

import { imageHeader } from '@open-pencil/scene-graph/images'

import { readBoundedBody } from '@/app/document/io/browser'
import type { FetchFunction } from '@/app/http/types'

import { imageResponseSchema } from './schema'

export const IMAGE_TIMEOUT_MS = 180_000
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
export const MAX_RESPONSE_BYTES = 48 * 1024 * 1024

export type BoardImageSize = '1024x1024' | '1024x1536' | '1536x1024'

export interface BoardImageRequest {
  prompt: string
  size: BoardImageSize
  reference?: Uint8Array
  transparent?: boolean
}

export interface BoardImageAPIConfig {
  baseURL: string
  model: string
  apiKey: string
}

/** No provider response body is surfaced: some gateways echo request headers on errors. */
function requestFailure(status: number, transparent: boolean): Error {
  if (status === 401 || status === 403)
    return new Error('图像 API 拒绝访问，请检查连接的密钥和模型权限。')
  if (status === 404) return new Error('此 API 未提供图像接口或模型不存在，请核对图像模型 ID。')
  if (status === 429) return new Error('图像 API 已限流或额度不足，请稍后重试。')
  if (status === 400 && transparent) {
    return new Error(
      '服务商或当前图像模型不支持透明 PNG 文字素材；请换用支持 transparent PNG 的 OpenAI Images 接口。'
    )
  }
  return new Error(`图像请求失败（HTTP ${status}），请检查服务商是否支持该模型和尺寸。`)
}

function checkedURL(value: string): URL {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('图像 API 返回了不支持的下载地址。')
  }
  return url
}

function imageRequestBody(config: BoardImageAPIConfig, request: BoardImageRequest): BodyInit {
  if (request.reference) {
    const form = new FormData()
    const mime = imageHeader(request.reference)?.type ?? 'image/png'
    form.set('model', config.model)
    form.set('prompt', request.prompt)
    form.set('size', request.size)
    form.set('n', '1')
    if (request.transparent) {
      form.set('background', 'transparent')
      form.set('output_format', 'png')
      form.set('quality', 'high')
    }
    form.set('image', new Blob([request.reference.slice()], { type: mime }), 'reference.png')
    return form
  }
  const body = { model: config.model, prompt: request.prompt, size: request.size, n: 1 }
  return JSON.stringify(
    request.transparent
      ? { ...body, background: 'transparent', output_format: 'png', quality: 'high' }
      : body
  )
}

function checkImage(bytes: Uint8Array, transparent: boolean): void {
  const header = imageHeader(bytes)
  if (bytes.byteLength > MAX_IMAGE_BYTES || !header) {
    throw new Error('图像 API 返回的内容不是有效图片或超过 32 MiB。')
  }
  if (header.width < 1 || header.height < 1 || header.width > 4096 || header.height > 4096) {
    throw new Error('图像 API 返回的素材尺寸无效或超过单边 4096 像素。')
  }
  if (!['image/png', 'image/jpeg', 'image/gif'].includes(header.type)) {
    throw new Error('当前素材需要 PNG 或 JPEG 格式，请在图像服务商设置中选择相应输出格式。')
  }
  if (transparent && (header.type !== 'image/png' || (bytes[25] !== 4 && bytes[25] !== 6))) {
    throw new Error('服务商返回的 PNG 没有真正的 Alpha 透明通道，未将文字素材插入画板。')
  }
}

async function readGeneratedImage(
  response: Response,
  fetcher: FetchFunction,
  controller: AbortController
): Promise<Uint8Array> {
  const responseBytes = await readBoundedBody(response, MAX_RESPONSE_BYTES, {
    onExceeded: () => controller.abort(),
    sizeError: '图像 API 响应过大。'
  })
  const parsed = v.safeParse(
    v.pipe(v.string(), v.parseJson(), imageResponseSchema),
    new TextDecoder().decode(responseBytes)
  )
  if (!parsed.success) throw new Error('图像 API 未返回可用图片；需要 OpenAI Images 格式。')
  const first = parsed.output.data[0]
  if (first?.b64_json && isValid(first.b64_json)) return toUint8Array(first.b64_json)
  if (!first?.url) throw new Error('图像 API 返回的图片内容为空。')
  const downloadURL = checkedURL(first.url)
  // Never send the API credential to an image CDN or provider-owned download address.
  const downloaded = await fetcher(downloadURL, { signal: controller.signal })
  if (!downloaded.ok) throw new Error('图片已生成，但下载失败，请稍后重试。')
  return readBoundedBody(downloaded, MAX_IMAGE_BYTES, {
    onExceeded: () => controller.abort(),
    sizeError: '生成的图片超过 32 MiB。'
  })
}

/** OpenAI-compatible image contract. Dependencies allow a wire-level check without paid calls. */
export async function requestBoardImageAPI(
  config: BoardImageAPIConfig,
  request: BoardImageRequest,
  fetcher: FetchFunction,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, IMAGE_TIMEOUT_MS)
  try {
    const endpoint = joinURL(
      config.baseURL,
      request.reference ? 'images/edits' : 'images/generations'
    )
    checkedURL(endpoint)
    const headers = new Headers({ Authorization: `Bearer ${config.apiKey}` })
    if (!request.reference) headers.set('Content-Type', 'application/json')
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers,
      body: imageRequestBody(config, request),
      signal: controller.signal
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw requestFailure(response.status, request.transparent === true)
    }
    const bytes = await readGeneratedImage(response, fetcher, controller)
    controller.signal.throwIfAborted()
    checkImage(bytes, request.transparent === true)
    return bytes
  } catch (error) {
    if (timedOut) throw new Error('生成图片超过 3 分钟，已停止等待；可稍后重试。')
    if (signal?.aborted) signal.throwIfAborted()
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}
