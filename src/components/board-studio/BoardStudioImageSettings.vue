<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { modelCredentialRevision } from '@/app/ai/models/runtime'
import {
  activeImageModel,
  discoverImageModels,
  imageCandidates,
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
import SettingsSection from '@/components/settings/layout/SettingsSection.vue'
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
const models = computed(() => [
  {
    value: 'auto',
    label:
      activeImageModel.value && !boardImageModel.value
        ? `自动 · ${activeImageModel.value}`
        : '自动选择生图模型'
  },
  ...imageCandidates.value.map(({ id }) => ({
    value: id,
    label: id
  }))
])
const chosenModel = computed({
  get: () =>
    imageCandidates.value.some(({ id }) => id === boardImageModel.value)
      ? boardImageModel.value
      : 'auto',
  set: (id: string) => {
    boardImageModel.value = id === 'auto' ? '' : id
  }
})
watch(
  () => [
    boardImageConnection.value?.id,
    boardImageConnection.value?.customBaseURL,
    modelCredentialRevision.value
  ],
  () => {
    void discoverImageModels()
  },
  { immediate: true }
)
</script>

<template>
  <SettingsSection>
    <template #title>图像生成</template>
    <template #description>为展板出图、拆分和改图选择 API。设计对话模型在「模型」页配置。</template>
    <template #actions>
      <AppButton size="xs" :disabled="imageModelsLoading" @click="discoverImageModels(true)">
        {{ imageModelsLoading ? '读取中…' : '刷新模型列表' }}
      </AppButton>
    </template>
    <div class="flex flex-col gap-3">
      <AppSelect v-model="connection" label="生图 API 连接" :options="connections" />
      <AppSelect
        v-model="chosenModel"
        label="生图模型"
        :options="models"
        placeholder="自动读取后在此选择模型"
      />
      <p class="text-xs text-muted">{{ imageModelsMessage }}</p>
      <p v-if="activeImageModel" class="text-xs text-muted">当前生图模型 {{ activeImageModel }}</p>
      <div class="flex gap-2">
        <AppButton size="xs" @click="openSettingsDialog('ai')">管理 API 连接</AppButton>
        <AppButton size="xs" @click="advanced = !advanced">{{
          advanced ? '收起自定义模型' : '自定义模型 ID'
        }}</AppButton>
      </div>
      <label v-if="advanced" class="flex flex-col gap-1 text-xs">
        自定义图像模型 ID
        <AppInput v-model="boardImageModel" placeholder="服务商提供的准确模型 ID" />
      </label>
    </div>
  </SettingsSection>
</template>
