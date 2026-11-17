import type { ModelMessage } from 'ai'
import * as v from 'valibot'

import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { graphOf } from '@open-pencil/core/figma-api'
import { defineTool, parseToolArgs, type ToolDef } from '@open-pencil/core/tools'
import { imageHeader } from '@open-pencil/scene-graph/images'

import { renderForModel } from '@/app/ai/tools/vision/render'
import type { EditorStore } from '@/app/editor/active-store'
import { referenceAttachmentBytes } from '@/app/editor/boards/images/attachment'
import { generateBoardImage } from '@/app/editor/boards/images/generate'

const TOOL_NAME = 'generate_board_image'
const positionSchema = v.pipe(v.number(), v.finite(), v.minValue(-1_000_000), v.maxValue(1_000_000))
const lengthSchema = v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(20_000))

const inputSchema = v.strictObject({
  purpose: v.pipe(
    v.picklist(['illustration', 'title-lettering']),
    v.description(
      'Use illustration for characters, packaging, and imagery. Use title-lettering only for the short headline whose lettering should be a transparent PNG; all other Chinese text stays editable text.'
    )
  ),
  prompt: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(16_000),
    v.description(
      'Describe one artwork asset. For title-lettering, include the exact short Chinese headline verbatim and request accurate readable strokes on transparent background.'
    )
  ),
  name: v.pipe(
    v.string(),
    v.minLength(1),
    v.description('Layer name, such as 主角正面 or 包装效果图')
  ),
  parent_id: v.optional(v.string()),
  reference_node_id: v.optional(
    v.pipe(
      v.string(),
      v.description(
        'Existing canvas image or group to send to the image editing API for a new variant. Original is kept.'
      )
    )
  ),
  reference_attachment: v.optional(
    v.pipe(
      v.number(),
      v.integer(),
      v.minValue(1),
      v.description(
        'One-based image index in the newest user message (1 = its first attached image). Supports PNG/JPEG/WebP. Use instead of reference_node_id to edit directly from the supplied reference.'
      )
    )
  ),
  x: positionSchema,
  y: positionSchema,
  width: lengthSchema,
  height: lengthSchema,
  image_size: v.optional(v.picklist(['1024x1024', '1024x1536', '1536x1024']), '1024x1024')
})

export const generateBoardImageTool = defineTool({
  name: TOOL_NAME,
  description:
    'Generate one character, illustration, packaging mockup, or a short headline lettering asset using the configured image API. Image assets and title lettering are separate image layers; only title-lettering uses a transparent PNG. Keep every other Chinese heading and body copy as editable text. Use reference_attachment for a picture in the newest user message, or reference_node_id for an existing canvas asset, never both. Requires an image model configured in 展板工作台; API requests can incur provider charges.',
  execution: { kind: 'async', mutation: 'document' },
  capabilities: ['document:write', 'network:access'],
  exposure: { mcp: false, webmcp: false },
  input: inputSchema,
  execute: async () => {
    throw new Error('图像生成需要通过展板工作台的设计聊天运行。')
  }
})

/** Performs the network wait before the existing tool runner opens an undo transaction. */
interface BoardImageToolOptions {
  signal?: AbortSignal
  messages?: readonly ModelMessage[]
  isLive?: () => boolean
}

export async function prepareBoardImageTool(
  store: EditorStore,
  figma: FigmaAPI,
  args: Record<string, unknown>,
  { signal, messages = [], isLive }: BoardImageToolOptions = {}
): Promise<ToolDef> {
  const checkLive = () => {
    signal?.throwIfAborted()
    if (isLive?.() === false)
      throw new DOMException('设计任务已停止，未插入生成素材。', 'AbortError')
  }
  checkLive()
  const input = parseToolArgs(TOOL_NAME, inputSchema, args)
  if (input.reference_node_id && input.reference_attachment !== undefined) {
    throw new Error('reference_node_id 与 reference_attachment 只能指定一个。')
  }
  const graph = graphOf(figma)
  const parentId = input.parent_id ?? figma.currentPageId
  const parent = graph.getNode(parentId)
  if (!parent || !['FRAME', 'GROUP', 'CANVAS', 'SECTION'].includes(parent.type)) {
    throw new Error('请为生成素材指定有效的展板或分组 parent_id。')
  }
  if (parent.locked) throw new Error('目标分组已锁定，请先解锁。')
  let reference: Uint8Array | undefined
  if (input.reference_attachment !== undefined) {
    reference = referenceAttachmentBytes(messages, input.reference_attachment)
  }
  if (input.reference_node_id) {
    const node = graph.getNode(input.reference_node_id)
    if (!node) throw new Error('参考图层已不存在，请重新选择。')
    const page = graph.closest(node.id, (candidate) => candidate.type === 'CANVAS')
    if (!page) throw new Error('参考图层不在有效页面中。')
    const rendered = await renderForModel(store, [node.id], page.id, 1536)
    if (!rendered) throw new Error('无法读取参考图层，请确认该图层可见。')
    reference = rendered.png
  }
  checkLive()
  const transparent = input.purpose === 'title-lettering'
  const bytes = await generateBoardImage(
    { prompt: input.prompt, size: input.image_size, reference, transparent },
    signal
  )
  checkLive()
  const header = imageHeader(bytes)
  if (!header || header.width > 4096 || header.height > 4096) {
    throw new Error('生成素材尺寸超过当前画板可导入的 4096 像素单边限制。')
  }
  return {
    ...generateBoardImageTool,
    execute: (target) => {
      checkLive()
      if (store.graph !== graph || graphOf(target) !== graph)
        throw new Error('文档已更换，未插入生成素材。')
      const destination = target.getNodeById(parentId)
      if (!destination || destination.locked)
        throw new Error('目标分组已被删除或锁定，未插入生成素材。')
      const image = target.createImage(bytes)
      const node = target.createRectangle()
      destination.appendChild(node)
      node.name = input.name
      node.x = input.x
      node.y = input.y
      node.resize(input.width, input.height)
      node.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FIT' }]
      return {
        id: node.id,
        name: node.name,
        imageHash: image.hash,
        width: header.width,
        height: header.height,
        editable:
          'Independent raster image layer. Typography and other board elements remain separate.'
      }
    }
  }
}
