import { IS_TAURI } from '@open-pencil/core/constants'

import { resolveModelConnectionAPIKey } from '@/app/ai/models/runtime'
import type { FetchFunction } from '@/app/http/types'
import { tauriFetch } from '@/app/tauri/http'

import {
  IMAGE_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  requestBoardImageAPI,
  type BoardImageRequest
} from './api'
import { activeImageModel, ensureImageModel } from './discovery'
import { boardImageConnection } from './settings'
import { requireTransparentPixels } from './transparency'

export async function generateBoardImage(request: BoardImageRequest, signal?: AbortSignal) {
  await ensureImageModel()
  signal?.throwIfAborted()
  const connection = boardImageConnection.value
  if (!connection || !['openai', 'openai-compatible'].includes(connection.providerID)) {
    throw new Error('请在设置的「图像生成」中选择支持 OpenAI Images 的 API 连接。')
  }
  const model = activeImageModel.value
  const apiKey = await resolveModelConnectionAPIKey(connection.id)
  if (!apiKey) throw new Error('无法读取此 API 连接的密钥，请在模型设置中保存。')
  const baseURL =
    connection.providerID === 'openai' ? 'https://api.openai.com/v1' : connection.customBaseURL
  if (!baseURL.trim()) throw new Error('图像 API 缺少基础地址。')
  const fetcher: FetchFunction = IS_TAURI
    ? (input, init) => tauriFetch(input, init, MAX_RESPONSE_BYTES, IMAGE_TIMEOUT_MS + 1000)
    : fetch
  const bytes = await requestBoardImageAPI({ baseURL, model, apiKey }, request, fetcher, signal)
  if (request.transparent) await requireTransparentPixels(bytes)
  signal?.throwIfAborted()
  return bytes
}
