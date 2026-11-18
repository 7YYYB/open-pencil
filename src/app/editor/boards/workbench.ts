import { createEventHook } from '@vueuse/core'
import type { UIMessage } from 'ai'
import { ref, type Ref } from 'vue'

import { showChatPanel } from '@/app/ai/chat/panel'
import type { EditorStore } from '@/app/editor/active-store'

export type StudioAction =
  | 'generate'
  | 'split'
  | 'edit-image'
  | 'properties'
  | 'export-png'
  | 'export-jpg'
export type StudioJob = Extract<StudioAction, 'generate' | 'split' | 'edit-image'>

const requests = createEventHook<{ editor: EditorStore; action: StudioAction; nodeId?: string }>()
export const onStudioAction = requests.on
const busyByEditor = new WeakMap<EditorStore, Ref<boolean>>()

export function studioBusy(editor: EditorStore) {
  let busy = busyByEditor.get(editor)
  if (!busy) {
    busy = ref(false)
    busyByEditor.set(editor, busy)
  }
  return busy
}

export function requestStudioAction(editor: EditorStore, action: StudioAction, nodeId?: string) {
  if (action !== 'properties') showChatPanel()
  void requests.trigger({ editor, action, nodeId })
}

export interface StudioResult {
  nodeId: string
  kind: StudioJob
  brief?: string
}

export const STUDIO_RESULT_PART = 'data-board-result'

export function studioResult(message: UIMessage): StudioResult | undefined {
  const part = message.parts.find((entry) => entry.type === STUDIO_RESULT_PART)
  if (part?.type !== STUDIO_RESULT_PART || typeof part.data !== 'object' || !part.data) return
  const { nodeId, kind, brief } = part.data as Partial<StudioResult>
  if (
    typeof nodeId === 'string' &&
    (kind === 'generate' || kind === 'split' || kind === 'edit-image')
  ) {
    return { nodeId, kind, brief: typeof brief === 'string' ? brief : undefined }
  }
}

export function isAnotherBoard(text: string): boolean {
  return /(?:再(?:来|做|生成|出|试).{0,8}(?:版|张|套|方案)|换(?:一|个)(?:版|方案|构图)|另一版|备选方案|another version|another draft)/i.test(
    text
  )
}

/** Explicit design actions run directly; questions and layout requests go to the design agent. */
export function studioIntent(
  text: string,
  hasImage: boolean,
  emptyPage: boolean
): StudioJob | undefined {
  const request = text.trim()
  if (
    request.startsWith('/') ||
    /^(?:能不能|可以|如何|怎么|为什么|帮我分析|看看|请分析|what|how|can you explain)/i.test(request)
  )
    return
  if (
    /^(?:请|帮我|把(?:这张图|这张展板|所选图片)|先|然后)*\s*(?:拆分|分层|提取元素|split|separate layers)/i.test(
      request
    )
  )
    return 'split'
  if (
    isAnotherBoard(request) ||
    /(?:生成|设计|做|制作|画|create|generate).{0,30}(?:展板|海报|主海报|poster|board)/i.test(
      request
    )
  )
    return 'generate'
  if (
    hasImage &&
    /^(?:请|帮我|把这张图|把所选图片)*\s*(?:改图|改成|把.{1,40}(?:换成|改成|变成)|重绘|重新生成|修掉|去掉|替换背景|换色)/i.test(
      request
    )
  )
    return 'edit-image'
  if (
    emptyPage &&
    !/[？?]$/.test(request) &&
    /展板|海报|包装|品牌|文创|配色|构图|视觉|排版|设计|\bIP\b/i.test(request) &&
    !/字体|导出|透明花字|透明标题/.test(request)
  )
    return 'generate'
}
