<script setup lang="ts">
import { computed, onScopeDispose, ref, useId, watch } from 'vue'

import { createImagePreviewURL, revokeImagePreviewURL } from '@/app/ai/attachment/image/prepare'
import { showChatPanel } from '@/app/ai/chat/panel'
import { useEditorStore } from '@/app/editor/active-store'
import { createBoard, exportBoard, replaceBoardFonts } from '@/app/editor/boards/actions'
import { requestBoardDesign, type BoardDesignStep } from '@/app/editor/boards/design'
import {
  generateWholeBoard,
  regenerateSelectedElement,
  splitSelectedBoard
} from '@/app/editor/boards/layers/actions'
import type { BoardJobOptions } from '@/app/editor/boards/layers/split'
import { openSettingsDialog } from '@/app/settings/dialog'
import { useAttachmentDrafts } from '@/components/chat/input/useAttachments'
import FontPicker from '@/components/font-picker/FontPicker.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppTextarea from '@/components/ui/input/AppTextarea.vue'

import BoardStudioImageSettings from './BoardStudioImageSettings.vue'

const store = useEditorStore()
const expanded = ref(true)
const font = ref('')
const busy = ref(false)
const message = ref('')
const failed = ref(false)
const briefId = useId()
const brief = ref('')
const editInstruction = ref('')
const editId = useId()
let operation: AbortController | undefined
onScopeDispose(() => operation?.abort())
watch(
  () => store.graph,
  () => operation?.abort()
)
const attachments = useAttachmentDrafts({
  editor: store,
  selectedIds: computed(() => store.state.selectedIds),
  reportError: (error) => {
    failed.value = true
    message.value = error
  }
})
const { images, openImageDialog, removeImage } = attachments
async function imageJob(action: (options: BoardJobOptions) => Promise<string>) {
  operation = new AbortController()
  await perform(async () => {
    message.value = await action({
      signal: operation?.signal ?? AbortSignal.abort(),
      fontFamily: font.value,
      progress: (text) => {
        message.value = text
      }
    })
  })
  operation = undefined
}

async function design(step: BoardDesignStep) {
  const copies = images.value.map(({ file }) => ({ file, previewURL: createImagePreviewURL(file) }))
  try {
    await requestBoardDesign(store, brief.value, copies, step)
    message.value = '任务已发送到下方 AI 对话。可以继续用语言修改图层。'
  } catch (error) {
    copies.forEach(({ previewURL }) => revokeImagePreviewURL(previewURL))
    throw error
  }
}

async function perform(action: () => Promise<unknown>) {
  busy.value = true
  message.value = ''
  failed.value = false
  try {
    await action()
  } catch (error) {
    failed.value = true
    const reason = error instanceof Error ? error.message : '操作失败，请重试。'
    message.value = operation?.signal.aborted ? '任务已停止。' : reason
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
      <strong class="text-sm">展板工作台 · 整图拆分</strong>
      <AppButton size="xs" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? '收起' : '展开' }}
      </AppButton>
    </div>
    <div v-if="expanded" class="mt-3 flex max-h-[48vh] flex-col gap-3 overflow-y-auto">
      <BoardStudioImageSettings />
      <p class="text-xs">① 生成完整效果图 → ② 选中满意的图拆分 → ③ 编辑文字或重生成单个元素</p>
      <p class="text-xs text-muted">A3 · 297 × 420 mm · 3508 × 4961 px</p>
      <div class="flex gap-2">
        <AppButton variant="outline" :disabled="busy" @click="createBoard(store)"
          >新建竖版</AppButton
        >
        <AppButton variant="outline" :disabled="busy" @click="createBoard(store, true)"
          >新建横版</AppButton
        >
      </div>
      <label :for="briefId" class="text-xs">主题与设计要求</label>
      <AppTextarea
        :id="briefId"
        v-model="brief"
        :rows="3"
        placeholder="例如：凌县泥咕咕文创 IP；参照下图的构图与视觉密度，暖红与米白配色，正文可编辑。"
      />
      <div class="flex items-center justify-between gap-2">
        <AppButton variant="outline" @click="openImageDialog()">添加参考图</AppButton>
        <span class="text-xs text-muted">{{ images.length }} / 4</span>
      </div>
      <div v-if="images.length" class="flex flex-col gap-1">
        <div
          v-for="(image, index) in images"
          :key="image.previewURL"
          class="flex items-center gap-2"
        >
          <img
            :src="image.previewURL"
            :alt="image.file.name"
            class="size-10 rounded object-cover"
          />
          <span class="min-w-0 flex-1 truncate text-xs">{{ image.file.name }}</span>
          <AppButton size="xs" @click="removeImage(index)">移除</AppButton>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton
          :disabled="busy || !brief.trim()"
          @click="imageJob((options) => generateWholeBoard(store, brief, images, options))"
          >① 生成完整效果图</AppButton
        >
        <AppButton
          :disabled="busy"
          variant="outline"
          @click="imageJob((options) => splitSelectedBoard(store, options))"
          >② 拆分元素与文字</AppButton
        >
        <AppButton
          :disabled="busy || !brief.trim()"
          variant="outline"
          @click="perform(() => design('reference'))"
          >分析参考</AppButton
        >
        <AppButton
          :disabled="busy || !brief.trim()"
          variant="outline"
          @click="perform(() => design('hero'))"
          >先做主视觉</AppButton
        >
        <AppButton
          :disabled="busy || !brief.trim()"
          variant="outline"
          @click="perform(() => design('lettering'))"
          >透明标题花字</AppButton
        >
      </div>
      <label :for="editId" class="text-xs">所选元素的修改要求</label>
      <AppTextarea
        :id="editId"
        v-model="editInstruction"
        :rows="2"
        placeholder="例如：保持角色造型，把衣服换成红色，保留透明背景。"
      />
      <AppButton
        :disabled="busy || !editInstruction.trim()"
        variant="outline"
        @click="imageJob((options) => regenerateSelectedElement(store, editInstruction, options))"
        >③ 重新生成所选元素</AppButton
      >
      <p class="text-xs">选择文字、分组或整张展板，批量更换字体</p>
      <FontPicker v-model="font" label="展板字体" placeholder="选择字体" />
      <div class="flex gap-2">
        <AppButton variant="outline" :disabled="!font || busy" @click="perform(changeFonts)"
          >应用字体</AppButton
        >
        <AppButton @click="openSettingsDialog('fonts')">字体管理</AppButton>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton
          :disabled="busy"
          variant="outline"
          @click="perform(() => exportBoard(store, 'png'))"
          >导出 PNG</AppButton
        >
        <AppButton
          :disabled="busy"
          variant="outline"
          @click="perform(() => exportBoard(store, 'jpg'))"
          >导出 JPG</AppButton
        >
        <AppButton @click="showChatPanel()">对话设计</AppButton>
        <AppButton @click="openSettingsDialog('ai')">模型 API</AppButton>
      </div>
    </div>
    <div v-if="message || busy" class="mt-2 flex flex-col gap-2" aria-live="polite">
      <AppAlert
        :heading="busy ? '处理中' : failed ? '操作未完成' : '操作结果'"
        :tone="failed ? 'error' : 'info'"
        :description="message"
      />
      <AppButton v-if="busy && operation" @click="operation?.abort()">停止当前任务</AppButton>
    </div>
  </section>
</template>
