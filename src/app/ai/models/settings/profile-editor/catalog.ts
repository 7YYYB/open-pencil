import { tryOnScopeDispose } from '@vueuse/core'
import { computed, ref, shallowRef, watch, type Ref } from 'vue'

import {
  accountCatalogBaseURL,
  cachedAccountModels,
  fetchAccountModels,
  MODEL_CATALOG_TIMEOUT_MS,
  rememberAccountModels,
  supportsAccountCatalog,
  type AccountModel
} from '@/app/ai/models/catalog/connection'
import { modelCredentialRevision, resolveModelConnectionAPIKey } from '@/app/ai/models/runtime'
import { findModelConnectionForDraft } from '@/app/ai/models/store'
import type { AIModelConnection, AIModelProfileDraft } from '@/app/ai/models/types'
import { validSettingsURL } from '@/app/settings/validation/schema'

interface Options {
  draft: AIModelProfileDraft
  keyInput: Ref<string>
  keyCleared: Ref<boolean>
}

export function useProfileAccountCatalog({ draft, keyInput, keyCleared }: Options) {
  const models = shallowRef<AccountModel[]>()
  const loading = ref(false)
  const error = ref('')
  const supported = computed(() => supportsAccountCatalog(draft.providerID))
  const url = computed(() => accountCatalogBaseURL(draft.providerID, draft.customBaseURL))
  const chatModels = computed(() => models.value?.filter((model) => model.conversation))
  const imageCount = computed(() => models.value?.filter((model) => model.candidate).length ?? 0)
  let request: AbortController | undefined

  function reset() {
    request?.abort()
    request = undefined
    models.value = undefined
    loading.value = false
    error.value = ''
  }
  watch(
    () => [draft.providerID, url.value, draft.customAPIType, keyInput.value, keyCleared.value],
    reset,
    { flush: 'sync' }
  )
  tryOnScopeDispose(reset)

  function readTarget(force: boolean) {
    const baseURL = url.value
    if (!validSettingsURL(baseURL)) {
      if (force) error.value = '请先在下方填写有效的 API 基础 URL。'
      return
    }
    const connection = findModelConnectionForDraft(draft)
    const replacement = keyInput.value.trim()
    if (!force && (!connection || replacement || keyCleared.value)) return
    const savedId = !keyCleared.value ? connection?.id : undefined
    const revision = modelCredentialRevision.value
    const cached = !force && savedId ? cachedAccountModels(savedId, baseURL, revision) : undefined
    return { baseURL, replacement, savedId, revision, cached }
  }

  async function read(force = true) {
    if (!supported.value || loading.value) return
    const target = readTarget(force)
    if (!target) return
    const { baseURL, replacement, savedId, revision, cached } = target
    if (cached) {
      models.value = cached
      return
    }
    const controller = new AbortController()
    request = controller
    const deadline = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(MODEL_CATALOG_TIMEOUT_MS)
    ])
    loading.value = true
    error.value = ''
    try {
      const key = replacement || (savedId ? await resolveModelConnectionAPIKey(savedId) : '')
      deadline.throwIfAborted()
      if (!key) {
        if (force) error.value = '请先在下方输入 API 密钥。已保存的密钥会自动使用。'
        return
      }
      const result = await fetchAccountModels(baseURL, key, deadline)
      deadline.throwIfAborted()
      if (revision !== modelCredentialRevision.value) return
      models.value = result
      if (savedId && !replacement) rememberAccountModels(savedId, baseURL, revision, result)
    } catch (problem) {
      if (request !== controller || controller.signal.aborted) return
      const reason = problem instanceof Error ? problem.message : '暂时无法读取模型列表。'
      error.value = deadline.aborted ? '读取模型超时，可以重试。' : reason
    } finally {
      if (request === controller) {
        loading.value = false
        request = undefined
      }
    }
  }

  /** Called only after credentials and connection edits have been saved. */
  function share(connection: AIModelConnection) {
    if (
      !models.value ||
      url.value !== accountCatalogBaseURL(connection.providerID, connection.customBaseURL)
    )
      return
    rememberAccountModels(connection.id, url.value, modelCredentialRevision.value, models.value)
  }

  return { supported, chatModels, imageCount, loading, error, read, share }
}
