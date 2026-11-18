import { useLocalStorage } from '@vueuse/core'
import { computed, watch } from 'vue'

import { aiModelSettings, designModelConnection, modelConnection } from '@/app/ai/models/store'
import type { AIModelConnection } from '@/app/ai/models/types'

/** Image model names are API-specific and are deliberately independent of the chat model. */
const legacyImageModel = useLocalStorage('board-studio:image-model', '', {
  writeDefaults: false
})
const connectionModels = useLocalStorage<Record<string, string>>('board-studio:image-models', {})
/** Empty follows the current Design connection, without copying its saved credential. */
export const boardImageConnectionId = useLocalStorage('board-studio:image-connection', '', {
  writeDefaults: false
})

function supportsImageAPI(connection: AIModelConnection): boolean {
  return connection.providerID === 'openai' || connection.providerID === 'openai-compatible'
}

export const boardImageConnections = computed(() =>
  aiModelSettings.value.connections.filter(supportsImageAPI).map((connection) => ({
    id: connection.id,
    label:
      aiModelSettings.value.models.find((model) => model.connectionId === connection.id)?.name ??
      connection.providerID
  }))
)

export const boardImageConnection = computed(() =>
  boardImageConnectionId.value
    ? modelConnection(boardImageConnectionId.value)
    : designModelConnection.value
)

watch(
  () => boardImageConnection.value?.id,
  (id) => {
    if (!id || !legacyImageModel.value.trim()) return
    if (!(id in connectionModels.value))
      connectionModels.value = { ...connectionModels.value, [id]: legacyImageModel.value }
    legacyImageModel.value = ''
  },
  { immediate: true }
)

export const boardImageModel = computed({
  get: () => connectionModels.value[boardImageConnection.value?.id ?? ''] ?? '',
  set: (model: string) => {
    const id = boardImageConnection.value?.id
    if (id) connectionModels.value = { ...connectionModels.value, [id]: model }
    legacyImageModel.value = ''
  }
})
