<script setup lang="ts">
import { ref } from 'vue'

import { showChatPanel } from '@/app/ai/chat/panel'
import { useEditorStore } from '@/app/editor/active-store'
import { createBoard, exportBoard, replaceBoardFonts } from '@/app/editor/boards/actions'
import { openSettingsDialog } from '@/app/settings/dialog'
import FontPicker from '@/components/font-picker/FontPicker.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'

const store = useEditorStore()
const expanded = ref(true)
const font = ref('')
const busy = ref(false)
const message = ref('')
const failed = ref(false)

async function perform(action: () => Promise<unknown>) {
  busy.value = true
  message.value = ''
  failed.value = false
  try {
    await action()
  } catch (error) {
    failed.value = true
    message.value = error instanceof Error ? error.message : '操作失败，请重试。'
  } finally {
    busy.value = false
  }
}

async function changeFonts() {
  const count = await replaceBoardFonts(store, font.value)
  message.value = `已更新 ${count} 个文字图层，可通过撤销恢复。`
}
</script>

<template>
  <section class="shrink-0 border-b border-border bg-panel p-3" aria-label="展板工作台">
    <div class="flex items-center justify-between gap-2">
      <strong class="text-sm">展板工作台</strong>
      <AppButton size="xs" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? '收起' : '展开' }}
      </AppButton>
    </div>
    <div v-if="expanded" class="mt-3 flex flex-col gap-3">
      <p class="text-xs text-muted">A3 · 297 × 420 mm · 3508 × 4961 px</p>
      <div class="flex gap-2">
        <AppButton variant="outline" @click="createBoard(store)">新建竖版</AppButton>
        <AppButton variant="outline" @click="createBoard(store, true)">新建横版</AppButton>
      </div>
      <p class="text-xs">选择文字、分组或整张展板，批量更换字体</p>
      <FontPicker v-model="font" label="展板字体" placeholder="选择字体" />
      <div class="flex gap-2">
        <AppButton variant="outline" :disabled="!font || busy" @click="perform(changeFonts)">应用字体</AppButton>
        <AppButton @click="openSettingsDialog('fonts')">字体管理</AppButton>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton :disabled="busy" variant="outline" @click="perform(() => exportBoard(store, 'png'))">导出 PNG</AppButton>
        <AppButton :disabled="busy" variant="outline" @click="perform(() => exportBoard(store, 'jpg'))">导出 JPG</AppButton>
        <AppButton @click="showChatPanel()">对话设计</AppButton>
        <AppButton @click="openSettingsDialog('ai')">模型 API</AppButton>
      </div>
      <AppAlert v-if="message" :heading="failed ? '操作未完成' : '字体已更新'" :tone="failed ? 'error' : 'info'" :description="message" />
    </div>
  </section>
</template>
