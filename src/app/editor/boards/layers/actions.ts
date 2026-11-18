import { prepareImageAttachment } from '@/app/ai/attachment/image/prepare'
import type { ImageAttachmentDraft } from '@/app/ai/attachment/image/types'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import type { EditorStore } from '@/app/editor/active-store'
import { createBoard, selectedBoard } from '@/app/editor/boards/actions'
import { generateBoardImage } from '@/app/editor/boards/images/generate'
import { ensureGraphFonts } from '@/app/editor/fonts'

import { wholeBoardPrompt } from './prompts'
import { decodeRaster } from './raster'
import { captureSource, selectedImage } from './source'
import { prepareBoardSplit, type BoardJobOptions } from './split'

export async function generateWholeBoard(
  store: EditorStore,
  brief: string,
  references: ImageAttachmentDraft[],
  options: BoardJobOptions & { landscape?: boolean; referenceId?: string }
) {
  if (!brief.trim()) throw new Error('请先填写主题和设计要求。')
  const graph = store.graph
  const page = store.state.currentPageId
  const selected = selectedBoard(store)
  const landscape = options.landscape ?? (selected ? selected.width > selected.height : false)
  const images = await Promise.all(
    references.map(async ({ file }) => (await prepareImageAttachment(file, 1536)).data)
  )
  if (images.length === 0 && options.referenceId) {
    images.push((await captureSource(store, options.referenceId)).bytes)
  }
  options.progress?.('正在生成完整展板效果图…')
  const bytes = await generateBoardImage(
    {
      prompt: `${wholeBoardPrompt}\n画幅：A3 ${landscape ? '横向' : '竖向'}。\n用户要求：${brief}`,
      size: landscape ? '1536x1024' : '1024x1536',
      reference: images[0],
      additionalReferences: images.slice(1)
    },
    options.signal
  )
  options.signal.throwIfAborted()
  if (store.graph !== graph || store.state.currentPageId !== page)
    throw new Error('页面已切换，未插入生成效果图。')
  // Each additional concept gets its own board, so the chosen draft remains intact.
  let board = selected && graph.getNode(selected.id)
  if (!board || board.childIds.length || board.locked || landscape !== board.width > board.height) {
    createBoard(store, landscape)
    board = selectedBoard(store)
  }
  if (!board) throw new Error('无法创建展板。')
  const destination = board
  const figma = makeFigmaFromStore(store)
  const nodeId = store.recordEdit({ label: '生成完整展板效果图', restoresSelection: true }, () => {
    const image = figma.createImage(bytes)
    const node = graph.createNode('RECTANGLE', destination.id, {
      name: '展板方案',
      x: 0,
      y: 0,
      width: destination.width,
      height: destination.height,
      fills: [
        {
          type: 'IMAGE',
          imageHash: image.hash,
          imageScaleMode: 'FILL',
          color: { r: 1, g: 1, b: 1, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    store.select([node.id])
    return node.id
  })
  store.zoomToSelection()
  return { nodeId, text: '展板方案已放到画布。可以再做一版，或拆分这张的素材与文字。' }
}

export async function splitSelectedBoard(
  store: EditorStore,
  options: BoardJobOptions,
  nodeId = selectedImage(store).id
) {
  const prepared = await prepareBoardSplit(store, nodeId, options)
  const figma = makeFigmaFromStore(store)
  const result = store.recordEdit({ label: '拆分展板元素与文字', restoresSelection: true }, () => {
    const layers = prepared.commit(figma)
    store.select([layers.id])
    return layers
  })
  await ensureGraphFonts(store.graph, result.textIds, store.renderer)
  result.textIds.forEach((id) => store.runLayoutForNode(id))
  store.requestRender()
  return {
    nodeId: result.id,
    text: `已拆出 ${result.elements} 个图片元素和 ${result.textIds.length} 个文字层。${result.uncertainText ? `有 ${result.uncertainText} 处识别结果待校对。` : ''}${result.warning}`
  }
}

export async function regenerateSelectedElement(
  store: EditorStore,
  instruction: string,
  options: BoardJobOptions,
  nodeId = selectedImage(store).id,
  references: ImageAttachmentDraft[] = []
) {
  if (!instruction.trim()) throw new Error('请先填写所选元素的修改要求。')
  const source = await captureSource(store, nodeId)
  const additionalReferences = await Promise.all(
    references.map(async ({ file }) => (await prepareImageAttachment(file, 1536)).data)
  )
  const raster = await decodeRaster(source.bytes)
  let transparent = false
  for (let offset = 3; offset < raster.data.length; offset += 4) {
    if (raster.data[offset] < 250) {
      transparent = true
      break
    }
  }
  options.progress?.('正在重新生成所选元素，保留位置和大小…')
  const bytes = await generateBoardImage(
    {
      prompt: `只修改这个独立元素：${instruction}\n保持画幅、主体完整性和原来的透明区域。不要添加任何其他展板内容。`,
      reference: source.bytes,
      additionalReferences,
      transparent,
      size: source.node.width > source.node.height ? '1536x1024' : '1024x1536'
    },
    options.signal
  )
  options.signal.throwIfAborted()
  source.check()
  const figma = makeFigmaFromStore(store)
  store.recordEdit({ label: '重新生成所选元素' }, () => {
    const image = figma.createImage(bytes)
    store.graph.updateNode(source.node.id, {
      fills: source.node.fills.map((fill) =>
        fill.type === 'IMAGE' ? { ...fill, imageHash: image.hash } : fill
      )
    })
  })
  store.requestRender()
  return { nodeId, text: '已在原位更新所选图片。' }
}
