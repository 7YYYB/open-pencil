<script setup lang="ts">
import { computed } from 'vue'

import { resolveEditorProfile } from '@open-pencil/core'
import { imageDataURL } from '@open-pencil/scene-graph/images'

import { useEditorStore } from '@/app/editor/active-store'
import { requestStudioAction, studioBusy, type StudioResult } from '@/app/editor/boards/workbench'
import { focusNodesOnTheirPage } from '@/app/editor/selection/focus'
import AppButton from '@/components/ui/button/AppButton.vue'

const { result } = defineProps<{ result?: StudioResult }>()
const store = useEditorStore()
const busy = studioBusy(store)
const canEdit = computed(() => resolveEditorProfile(store.state).edits)
const node = computed(() => {
  void store.state.sceneVersion
  return result ? store.graph.getNode(result.nodeId) : undefined
})
const imageHash = computed(() => {
  void store.state.sceneVersion
  const fill = node.value?.fills.find((item) => item.type === 'IMAGE' && item.visible)
  return fill?.imageHash
})
const thumbnail = computed(() => {
  const bytes = imageHash.value ? store.graph.images.get(imageHash.value) : undefined
  return bytes ? imageDataURL(bytes) : undefined
})

async function act(action: 'split' | 'generate') {
  if (!result || !(await focusNodesOnTheirPage(store, [result.nodeId]))) return
  requestStudioAction(store, action, result.nodeId)
}
</script>

<template>
  <div
    v-if="node && result"
    class="flex flex-col gap-2 rounded-lg border border-border bg-panel p-2"
  >
    <AppButton
      v-if="thumbnail && node.visible"
      aria-label="在画布上查看方案"
      class="h-auto w-full overflow-hidden p-0"
      @click="focusNodesOnTheirPage(store, [result.nodeId])"
    >
      <img
        :src="thumbnail"
        :alt="node.name"
        class="max-h-54 w-full rounded-md bg-canvas object-contain"
      />
    </AppButton>
    <div class="flex flex-wrap items-center gap-1.5">
      <AppButton
        v-if="node.visible"
        size="xs"
        variant="outline"
        @click="focusNodesOnTheirPage(store, [result.nodeId])"
      >
        在画布查看
      </AppButton>
      <AppButton
        v-if="result.kind === 'generate' && node.visible"
        size="xs"
        variant="soft"
        :disabled="busy || !canEdit"
        @click="act('split')"
      >
        拆分图层
      </AppButton>
      <AppButton
        v-if="result.kind === 'generate' && node.visible"
        size="xs"
        :disabled="busy || !canEdit"
        @click="act('generate')"
      >
        再做一版
      </AppButton>
      <span v-if="!node.visible" class="text-2xs text-muted">{{ node.name }}已隐藏</span>
    </div>
  </div>
</template>
