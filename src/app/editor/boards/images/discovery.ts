import { computed, ref } from 'vue'

import { IS_TAURI } from '@open-pencil/core/constants'

import { profileModelID } from '@/app/ai/models/language-model'
import { modelCredentialRevision, resolveModelConnectionAPIKey } from '@/app/ai/models/runtime'
import { aiModelSettings } from '@/app/ai/models/store'
import { tauriFetch } from '@/app/tauri/http'

import { fetchImageModels, isChatModelID, type ImageModelOption } from './catalog'
import { boardImageConnection, boardImageModel } from './settings'

export const imageModelOptions = ref<ImageModelOption[]>([])
export const imageModelsLoading = ref(false)
export const imageModelsMessage = ref('自动沿用现有 API 连接和密钥。')
export const imageCandidates = computed(() =>
  imageModelOptions.value.filter((model) => model.candidate)
)
export const activeImageModel = computed(() => {
  const saved = boardImageModel.value.trim()
  const confirmed = imageCandidates.value.some(({ id }) => id === saved)
  const chatProfile = aiModelSettings.value.models.some(
    (profile) =>
      profile.connectionId === boardImageConnection.value?.id && profileModelID(profile) === saved
  )
  if (saved && (confirmed || (!chatProfile && !isChatModelID(saved)))) return saved
  return imageCandidates.value[0]?.id ?? ''
})
let discovery: AbortController | undefined
let pending: Promise<void> | undefined
let loadedConnection = ''

export function discoverImageModels(force = false): Promise<void> {
  const connection = boardImageConnection.value
  const identity = connection
    ? `${connection.id}:${connection.customBaseURL}:${modelCredentialRevision.value}`
    : 'none'
  if (!force && loadedConnection === identity) return pending ?? Promise.resolve()
  discovery?.abort()
  const controller = new AbortController()
  discovery = controller
  loadedConnection = identity
  imageModelOptions.value = []
  if (!connection || !['openai', 'openai-compatible'].includes(connection.providerID)) {
    imageModelsMessage.value = '请先在模型 API 中添加 OpenAI 兼容连接。'
    imageModelsLoading.value = false
    return Promise.resolve()
  }
  imageModelsLoading.value = true
  imageModelsMessage.value = '正在从现有 API 读取模型列表…'
  pending = (async () => {
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const key = await resolveModelConnectionAPIKey(connection.id)
      if (!key) throw new Error('现有连接尚未保存 API 密钥。请在模型 API 中保存。')
      const baseURL =
        connection.providerID === 'openai' ? 'https://api.openai.com/v1' : connection.customBaseURL
      const fetcher = IS_TAURI
        ? (input: RequestInfo | URL, init?: RequestInit) =>
            tauriFetch(input, init, 4 * 1024 * 1024, 20_000)
        : fetch
      const models = await fetchImageModels(baseURL, key, fetcher, controller.signal)
      controller.signal.throwIfAborted()
      if (discovery !== controller) return
      imageModelOptions.value = models
      const candidates = imageCandidates.value
      imageModelsMessage.value = candidates.length
        ? `已读取 ${models.length} 个模型，发现 ${candidates.length} 个生图候选；可在下拉列表切换。`
        : '服务商未返回可识别的生图模型。可在自定义模型 ID 中指定已开通的模型。'
    } catch (error) {
      if (discovery !== controller) return
      const reason = error instanceof Error ? error.message : '模型列表读取失败。'
      imageModelsMessage.value = controller.signal.aborted
        ? '读取模型超时，可点击“读取模型”重试。'
        : reason
    } finally {
      clearTimeout(timeout)
      if (discovery === controller) {
        imageModelsLoading.value = false
        pending = undefined
      }
    }
  })()
  return pending
}

export async function ensureImageModel() {
  await discoverImageModels()
  if (!activeImageModel.value) throw new Error(imageModelsMessage.value)
}
