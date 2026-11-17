import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { graphOf } from '@open-pencil/core/figma-api'

import type { EditorStore } from '@/app/editor/active-store'
import { generateBoardImage } from '@/app/editor/boards/images/generate'
import { listFonts } from '@/app/editor/fonts'

import { extractLayers } from './extract'
import { backgroundPrompt, removeTextPrompt, segmentationPrompt } from './prompts'
import { decodeRaster, encodeRaster } from './raster'
import { captureSource } from './source'
import { recognizeBoardText } from './text'

export interface BoardJobOptions {
  signal: AbortSignal
  progress?: (text: string) => void
  fontFamily?: string
}

/** All remote work is prepared before a single undoable document mutation. */
export async function prepareBoardSplit(
  store: EditorStore,
  sourceId: string,
  options: BoardJobOptions
) {
  const { signal, progress = () => undefined } = options
  const source = await captureSource(store, sourceId)
  const size = source.node.width >= source.node.height ? '1536x1024' : '1024x1536'
  const families = (await listFonts()).map((font) => font.family)
  progress('1/5 识别文字、字体层级与位置…')
  const blocks = await recognizeBoardText(source.bytes, families, signal)
  signal.throwIfAborted()
  let artwork = source.bytes
  if (blocks.length) {
    progress('2/5 清除原图文字，保留插画与排版位置…')
    artwork = await generateBoardImage(
      { prompt: removeTextPrompt, size, reference: source.bytes },
      signal
    )
  }
  progress('3/5 生成实例分割图…')
  const segmentation = await generateBoardImage(
    { prompt: segmentationPrompt, size, reference: artwork },
    signal
  )
  signal.throwIfAborted()
  const pixels = await decodeRaster(artwork)
  const map = await decodeRaster(segmentation, pixels.width, pixels.height)
  progress('4/5 提取独立透明元素…')
  const extracted = await extractLayers(pixels, map, signal)
  const foreground = await Promise.all(
    extracted.foreground.map(async (layer) => ({
      ...layer,
      bytes: await encodeRaster(layer)
    }))
  )
  const residual = await encodeRaster(extracted.background)
  let background = residual
  let warning = ''
  progress('5/5 补全背景，准备可编辑文字层…')
  try {
    const generated = await generateBoardImage(
      {
        prompt: backgroundPrompt,
        size,
        reference: artwork,
        additionalReferences: [residual]
      },
      signal
    )
    background = await encodeRaster(await decodeRaster(generated, pixels.width, pixels.height))
  } catch (error) {
    signal.throwIfAborted()
    warning = `背景补全未完成，已保留透明残余背景。${error instanceof Error ? error.message : ''}`
  }
  signal.throwIfAborted()
  source.check()
  const fallbackFont =
    options.fontFamily ||
    families.find((family) => /Microsoft YaHei|微软雅黑|Noto Sans CJK|思源黑体/.test(family)) ||
    families[0] ||
    'Inter'
  return {
    commit(figma: FigmaAPI) {
      signal.throwIfAborted()
      source.check()
      const graph = graphOf(figma)
      if (graph !== store.graph || !source.node.parentId) throw new Error('文档已切换。')
      const node = source.node
      const parentId = source.node.parentId
      const originalIndex = graph.getNode(parentId)?.childIds.indexOf(node.id) ?? -1
      const group = graph.createNode('GROUP', parentId, {
        name: `${node.name} · 可编辑图层`,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        opacity: node.opacity,
        fills: [],
        clipsContent: false
      })
      if (originalIndex >= 0) graph.insertChildAt(group.id, parentId, originalIndex + 1)
      const addImage = (
        bytes: Uint8Array,
        name: string,
        x: number,
        y: number,
        width: number,
        height: number
      ) => {
        const image = figma.createImage(bytes)
        return graph.createNode('RECTANGLE', group.id, {
          name,
          x,
          y,
          width,
          height,
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
      }
      const sx = node.width / pixels.width,
        sy = node.height / pixels.height
      addImage(background, warning ? '背景 · 待补全' : '背景', 0, 0, node.width, node.height)
      foreground.forEach((layer, index) =>
        addImage(
          layer.bytes,
          `独立元素 ${index + 1}`,
          layer.x * sx,
          layer.y * sy,
          layer.width * sx,
          layer.height * sy
        )
      )
      const textIds: string[] = []
      for (const block of blocks) {
        const hex = Number.parseInt(block.color.slice(1), 16)
        const text = graph.createNode('TEXT', group.id, {
          name: `${block.uncertain ? '待校对 · ' : ''}${block.text.slice(0, 24)}`,
          x: (block.x * node.width) / 1000,
          y: (block.y * node.height) / 1000,
          width: (block.width * node.width) / 1000,
          height: (block.height * node.height) / 1000,
          text: block.text,
          fontFamily:
            options.fontFamily ||
            (families.includes(block.fontFamily) ? block.fontFamily : fallbackFont),
          fontSize: (block.fontSize * node.height) / 1000,
          fontWeight: block.fontWeight,
          textAlignHorizontal: block.align,
          textAutoResize: 'HEIGHT',
          fills: [
            {
              type: 'SOLID',
              color: {
                r: ((hex >> 16) & 255) / 255,
                g: ((hex >> 8) & 255) / 255,
                b: (hex & 255) / 255,
                a: 1
              },
              opacity: 1,
              visible: true
            }
          ]
        })
        textIds.push(text.id)
      }
      graph.updateNode(node.id, { visible: false })
      return {
        id: group.id,
        elements: foreground.length,
        textIds,
        uncertainText: blocks.filter((block) => block.uncertain).length,
        warning
      }
    }
  }
}
