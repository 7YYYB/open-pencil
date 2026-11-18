<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed } from 'vue'

import { resolveEditorProfile } from '@open-pencil/core'

import { useEditorStore } from '@/app/editor/active-store'
import { selectedBoard } from '@/app/editor/boards/actions'
import { imageAtSelection } from '@/app/editor/boards/layers/source'
import { requestStudioAction, studioBusy } from '@/app/editor/boards/workbench'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppDropdownMenuRoot from '@/components/ui/menu/AppDropdownMenuRoot.vue'
import { menuItem, useMenuUI } from '@/components/ui/menu/menu'

const store = useEditorStore()
const busy = studioBusy(store)
const canEdit = computed(() => resolveEditorProfile(store.state).edits)
const selection = computed(() => {
  void store.state.sceneVersion
  if (store.state.selectedIds.size !== 1) return undefined
  const [id] = store.state.selectedIds
  return store.graph.getNode(id)
})
const image = computed(() => (selection.value ? imageAtSelection(store) : undefined))
const text = computed(() =>
  selection.value?.type === 'TEXT' && !selection.value.locked ? selection.value : undefined
)
const board = computed(() => (selection.value ? selectedBoard(store) : undefined))
const boardSelected = computed(() => Boolean(board.value && board.value.id === selection.value?.id))
const menu = useMenuUI({ content: 'min-w-40' })
const item = menuItem({ justify: 'start' })
</script>

<template>
  <div
    v-if="(image || text || boardSelected) && store.state.editingTextId === null && canEdit"
    class="absolute inset-x-2 top-3 z-10 flex justify-center pointer-events-none"
  >
    <div
      class="pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-xl border border-border bg-panel p-1 shadow-sm"
      aria-label="所选内容的操作"
    >
      <template v-if="image">
        <AppButton
          size="sm"
          :disabled="busy"
          @click="requestStudioAction(store, 'split', image.id)"
        >
          <template #leading><icon-lucide-layers class="size-3.5" /></template>
          拆分图层
        </AppButton>
        <AppButton
          size="sm"
          :disabled="busy"
          @click="requestStudioAction(store, 'edit-image', image.id)"
        >
          <template #leading><icon-lucide-wand-sparkles class="size-3.5" /></template>
          描述改图
        </AppButton>
      </template>
      <template v-if="text">
        <AppButton size="sm" @click="store.startTextEditing(text.id)">编辑文字</AppButton>
        <AppButton size="sm" @click="requestStudioAction(store, 'properties')"
          >字体与排版</AppButton
        >
      </template>
      <AppDropdownMenuRoot v-if="boardSelected">
        <DropdownMenuTrigger as-child>
          <AppButton size="sm">
            <template #leading><icon-lucide-download class="size-3.5" /></template>
            导出展板
          </AppButton>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent :class="menu.content" :side-offset="6">
            <DropdownMenuItem :class="item" @select="requestStudioAction(store, 'export-png')"
              >PNG · 300 ppi</DropdownMenuItem
            >
            <DropdownMenuItem :class="item" @select="requestStudioAction(store, 'export-jpg')"
              >JPG · 300 ppi</DropdownMenuItem
            >
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </AppDropdownMenuRoot>
    </div>
  </div>
</template>
