import { computed, ref } from 'vue'

import {
  accountCatalogBaseURL,
  cachedAccountModels,
  fetchAccountModels,
  isChatModelID,
  MODEL_CATALOG_TIMEOUT_MS,
  rememberAccountModels,
  supportsAccountCatalog,
  type AccountModel
} from '@/app/ai/models/catalog/connection'
import { profileModelID } from '@/app/ai/models/language-model'
import { modelCredentialRevision, resolveModelConnectionAPIKey } from '@/app/ai/models/runtime'
import { aiModelSettings } from '@/app/ai/models/store'

import { boardImageConnection, boardImageModel } from './settings'

export const imageModelOptions = ref<AccountModel[]>([])
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

function showModels(models: AccountModel[]) {
  imageModelOptions.value = models
  const count = imageCandidates.value.length
  imageModelsMessage.value = count
    ? `已从 API 读取 ${count} 个生图候选。`
    : '服务商未返回可识别的生图模型。可在自定义模型 ID 中指定已开通的模型。'
}

export function discoverImageModels(force = false): Promise<void> {
  const connection = boardImageConnection.value
  const revision = modelCredentialRevision.value
  const identity = connection ? `${connection.id}:${connection.customBaseURL}:${revision}` : 'none'
  const baseURL = connection
    ? accountCatalogBaseURL(connection.providerID, connection.customBaseURL)
    : ''
  const cached = !force && connection && cachedAccountModels(connection.id, baseURL, revision)
  if (cached && !pending) {
    loadedConnection = identity
    showModels(cached)
    return Promise.resolve()
  }
  if (!force && loadedConnection === identity) return pending ?? Promise.resolve()
  discovery?.abort()
  const controller = new AbortController()
  discovery = controller
  loadedConnection = identity
  imageModelOptions.value = []
  pending = undefined
  if (!connection || !supportsAccountCatalog(connection.providerID)) {
    imageModelsMessage.value = '请先在模型 API 中添加 OpenAI 兼容连接。'
    imageModelsLoading.value = false
    return Promise.resolve()
  }
  imageModelsLoading.value = true
  imageModelsMessage.value = '正在从现有 API 读取模型列表…'
  pending = (async () => {
    const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS)
    try {
      const key = await resolveModelConnectionAPIKey(connection.id)
      if (!key) throw new Error('现有连接尚未保存 API 密钥。请在模型 API 中保存。')
      const models = await fetchAccountModels(baseURL, key, controller.signal)
      controller.signal.throwIfAborted()
      if (discovery !== controller) return
      rememberAccountModels(connection.id, baseURL, revision, models)
      showModels(models)
    } catch (error) {
      if (discovery !== controller) return
      loadedConnection = ''
      const reason = error instanceof Error ? error.message : '模型列表读取失败。'
      imageModelsMessage.value = controller.signal.aborted
        ? '读取模型超时，可以刷新模型列表重试。'
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
