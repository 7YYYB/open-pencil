<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { modelCredentialRevision } from '@/app/ai/models/runtime'
import {
  discoverImageModels,
  imageModelOptions,
  imageModelsLoading,
  imageModelsMessage
} from '@/app/editor/boards/images/discovery'
import {
  boardImageConnection,
  boardImageConnectionId,
  boardImageConnections,
  boardImageModel
} from '@/app/editor/boards/images/settings'
import { openSettingsDialog } from '@/app/settings/dialog'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const advanced = ref(false)
const connection = computed({
  get: () => boardImageConnectionId.value || 'design',
  set: (id: string) => {
    boardImageConnectionId.value = id === 'design' ? '' : id
  }
})
const connections = computed(() => [
  { value: 'design', label: '使用现有设计 API' },
  ...boardImageConnections.value.map(({ id, label }) => ({ value: id, label }))
])
const models = computed(() => {
  const options = imageModelOptions.value.map(({ id, candidate }) => ({
    value: id,
    label: `${candidate ? '生图候选 · ' : ''}${id}`
  }))
  if (boardImageModel.value && !options.some((option) => option.value === boardImageModel.value)) {
    options.unshift({ value: boardImageModel.value, label: boardImageModel.value })
  }
  return options
})
watch(
  () => [
    boardImageConnection.value?.id,
    boardImageConnection.value?.customBaseURL,
    modelCredentialRevision.value
  ],
  () => {
    void discoverImageModels(true)
  },
  { immediate: true }
)
</script>

<template>
  <section class="flex flex-col gap-2 rounded border border-border p-2" aria-label="生图模型与 API">
    <div class="flex items-center justify-between gap-2">
      <strong class="text-xs">生图模型 · 自动读取</strong>
      <AppButton size="xs" :disabled="imageModelsLoading" @click="discoverImageModels(true)">
        {{ imageModelsLoading ? '读取中…' : '读取模型' }}
      </AppButton>
    </div>
    <AppSelect v-model="connection" label="生图 API 连接" :options="connections" />
    <AppSelect
      v-model="boardImageModel"
      label="生图模型"
      :options="models"
      placeholder="自动读取后在此选择模型"
    />
    <p class="text-xs text-muted">{{ imageModelsMessage }}</p>
    <div class="flex gap-2">
      <AppButton size="xs" @click="openSettingsDialog('ai')">管理 API 连接</AppButton>
      <AppButton size="xs" @click="advanced = !advanced">{{
        advanced ? '收起高级设置' : '高级设置'
      }}</AppButton>
    </div>
    <label v-if="advanced" class="flex flex-col gap-1 text-xs">
      自定义图像模型 ID（仅用于服务商不返回列表时）
      <AppInput v-model="boardImageModel" placeholder="服务商提供的准确模型 ID" />
    </label>
  </section>
</template>
