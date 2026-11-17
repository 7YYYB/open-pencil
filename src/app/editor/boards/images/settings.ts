import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

import { aiModelSettings, designModelConnection, modelConnection } from '@/app/ai/models/store'
import type { AIModelConnection } from '@/app/ai/models/types'

/** Image model names are API-specific and are deliberately independent of the chat model. */
export const boardImageModel = useLocalStorage('board-studio:image-model', '', {
  writeDefaults: false
})
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

export const boardImageSetup = computed(() => {
  const connection = boardImageConnection.value
  const label = boardImageConnections.value.find((item) => item.id === connection?.id)?.label ?? ''
  if (!connection || !supportsImageAPI(connection)) {
    return { available: false, label, reason: '请选择支持 OpenAI 图像接口的 API 连接。' }
  }
  if (!boardImageModel.value.trim()) {
    return { available: false, label, reason: '填写服务商提供的图像模型 ID 后可生成素材。' }
  }
  return { available: true, label, reason: '使用已保存的 API 密钥；接口须支持图像生成或编辑。' }
})
