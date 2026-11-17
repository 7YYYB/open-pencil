import * as v from 'valibot'

import { defineTool, parseToolArgs, type ToolDef } from '@open-pencil/core/tools'

import type { EditorStore } from '@/app/editor/active-store'
import { prepareBoardSplit } from '@/app/editor/boards/layers/split'

const inputSchema = v.strictObject({
  node_id: v.pipe(
    v.string(),
    v.description(
      'The selected complete board preview image layer to split. Read the actual node ID first.'
    )
  ),
  font_family: v.optional(
    v.pipe(v.string(), v.description('Optional installed font for reconstructed editable text.'))
  )
})

export const splitBoardImageTool = defineTool({
  name: 'split_board_image',
  description:
    'Split a selected complete board image into transparent image elements, a completed background, and real editable text layers using OCR and image-generated segmentation. The original is retained hidden. Call after the user chooses a preview or explicitly asks to split. Makes several image API calls; may take a few minutes. Raster artwork becomes independently movable/regeneratable, not vector paths; OCR and geometry may need correction.',
  execution: { kind: 'async', mutation: 'document' },
  capabilities: ['document:write', 'network:access'],
  exposure: { mcp: false, webmcp: false },
  input: inputSchema,
  execute: async () => {
    throw new Error('展板拆分需要直接 API 设计聊天或工作台按钮。')
  }
})

export async function prepareBoardSplitTool(
  store: EditorStore,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  isLive?: () => boolean
): Promise<ToolDef> {
  const input = parseToolArgs('split_board_image', inputSchema, args)
  const prepared = await prepareBoardSplit(store, input.node_id, {
    signal: signal ?? new AbortController().signal,
    fontFamily: input.font_family
  })
  return {
    ...splitBoardImageTool,
    execute: (figma) => {
      signal?.throwIfAborted()
      if (isLive?.() === false) throw new DOMException('拆分任务已停止。', 'AbortError')
      return prepared.commit(figma)
    }
  }
}
