import { createEventHook } from '@vueuse/core'

import type { ImageAttachmentDraft } from '@/app/ai/attachment/image/types'
import { resolveReferencedNodes } from '@/app/ai/chat/context'
import { showChatPanel } from '@/app/ai/chat/panel'
import { referenceLink } from '@/app/ai/chat/references/link'
import type { ChatSubmission } from '@/app/ai/chat/submission/types'
import type { EditorStore } from '@/app/editor/active-store'
import { selectedBoard } from '@/app/editor/boards/actions'

export type BoardDesignStep = 'reference' | 'hero' | 'lettering' | 'board'

interface BoardDesignRequest {
  editor: EditorStore
  submission: ChatSubmission
  accept: () => void
}

const designRequested = createEventHook<BoardDesignRequest>()
export const onBoardDesignRequested = designRequested.on

const instructions: Record<BoardDesignStep, string> = {
  reference:
    '先读取附件中的参考图，分析主视觉占比、标题与主体的关系、分区顺序、颜色和信息密度。用简短中文给出针对我主题的设计方向；这一步不要修改画板。',
  hero: '先完成独立主视觉素材。如果有 generate_board_image 工具，实际调用它生成与主题和参考风格一致的主角或主视觉，作为独立图片图层放入目标画板。保留后续排版空间，这一步不铺满整板、不添加虚构的占位模块。如果没有可用生图接口，明确说明缺少哪项配置。',
  lettering:
    '只为主标题设计一张透明背景的 PNG 花字图层；如果 generate_board_image 提供透明文字目的参数，真实调用并指定透明背景与 PNG 输出，不得烘焙到整板背景。保留字体形态、色彩与构图作为独立图层。标题以外的中文副标题、正文、标签和编号必须继续使用真实文字层，字体调用本地已安装字体，按标题、正文、注释设置不同字重与字号。若当前 API 不能输出带 Alpha 的透明 PNG，告知我并提供可编辑文字标题备选，不要输出假透明棋盘格。',
  board:
    '先用 generate_board_image 的 board-preview 生成完整比赛展板效果图，包含主视觉、标题、文字和应用展示。让我选择满意的整张效果图后，再用 split_board_image 拆分为独立元素和真实文字层。不要用占位框或等分卡片网格代替完成的效果图，不要将尚未拆分的图片称为可编辑展板。'
}

/** Sends an explicit workbench action through the existing chat and attachment pipeline. */
export async function requestBoardDesign(
  editor: EditorStore,
  brief: string,
  images: ImageAttachmentDraft[],
  step: BoardDesignStep
): Promise<void> {
  if (!brief.trim()) throw new Error('请先填写展板主题与设计要求。')
  const board = selectedBoard(editor)
  if (step !== 'reference' && !board) {
    throw new Error('请先选中要设计的展板，或新建 A3 画板。')
  }
  const target = board
    ? `目标画板：${referenceLink({ kind: 'node', id: board.id, label: board.name })}。使用现有尺寸，读取最新图层后再操作。`
    : '这一步只分析附件，不修改当前文档。'
  const fontNote =
    '普通中文文字应选择本机可用字体，并按信息层级使用不同字号和字重（粗体标题、常规正文、轻型注释），不以整板生图替代文字排版。'
  const text = `${brief.trim()}\n\n${instructions[step]}\n${fontNote}\n${target}\n参考图只用于视觉分析和风格参考；不要把参考图直接贴成我的作品。`
  const submission: ChatSubmission = {
    modelText: text,
    displayText: text,
    images,
    nodes: board ? resolveReferencedNodes(editor.graph, [board.id]) : []
  }
  let accepted = false
  showChatPanel()
  await designRequested.trigger({
    editor,
    submission,
    accept: () => {
      accepted = true
    }
  })
  if (!accepted) throw new Error('请先在“模型 API”中配置设计模型，然后重试。')
}
