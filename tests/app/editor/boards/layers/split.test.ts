import 'fake-indexeddb/auto'
import { expect, spyOn, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'

import * as generation from '@/app/editor/boards/images/generate'
import * as extraction from '@/app/editor/boards/layers/extract'
import * as raster from '@/app/editor/boards/layers/raster'
import { prepareBoardSplit } from '@/app/editor/boards/layers/split'
import * as text from '@/app/editor/boards/layers/text'
import * as fonts from '@/app/editor/fonts'
import { createEditorStore } from '@/app/editor/session/create'

const png = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0
])

test('commits real editable text plus independent images in one undo step and restores the original on undo', async () => {
  const store = createEditorStore()
  const figma = new FigmaAPI(store.graph)
  const source = figma.createRectangle()
  source.fills = [{ type: 'IMAGE', imageHash: figma.createImage(png).hash, scaleMode: 'FILL' }]
  source.resize(3508, 4961)
  const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([20, 30, 40, 255]) }
  let imageCount = 0
  const spies = [
    spyOn(store, 'renderExportImage').mockResolvedValue(png),
    spyOn(fonts, 'listFonts').mockResolvedValue([{ family: 'Microsoft YaHei', faces: [] }]),
    spyOn(generation, 'generateBoardImage').mockResolvedValue(png),
    spyOn(raster, 'decodeRaster').mockResolvedValue(pixels),
    spyOn(raster, 'encodeRaster').mockImplementation(
      async () => new Uint8Array([...png, ++imageCount])
    ),
    spyOn(extraction, 'extractLayers').mockResolvedValue({
      foreground: [{ ...pixels, x: 0, y: 0 }],
      background: pixels
    }),
    spyOn(text, 'recognizeBoardText').mockResolvedValue([
      {
        text: '山海之间',
        x: 100,
        y: 100,
        width: 600,
        height: 100,
        fontSize: 60,
        fontFamily: 'Microsoft YaHei',
        fontWeight: 700,
        color: '#c02030',
        align: 'LEFT',
        decorative: true,
        uncertain: false
      }
    ])
  ]
  try {
    const prepared = await prepareBoardSplit(store, source.id, {
      signal: new AbortController().signal
    })
    const result = store.recordEdit({ label: 'Split' }, () => prepared.commit(figma))
    const group = store.graph.getNode(result.id)
    const children = group?.childIds.map((id) => store.graph.getNode(id)) ?? []
    expect(children.map((node) => node?.type)).toEqual(['RECTANGLE', 'RECTANGLE', 'TEXT'])
    expect(children[2]?.text).toBe('山海之间')
    expect(children[2]?.fontWeight).toBe(700)
    expect(children[2]?.fontFamily).toBe('Microsoft YaHei')
    expect(children[1]?.locked).toBe(false)
    expect(store.graph.getNode(source.id)?.visible).toBe(false)
    store.undo.undo()
    expect(store.graph.getNode(source.id)?.visible).toBe(true)
    expect(store.graph.getNode(result.id)).toBeUndefined()
    store.undo.redo()
    expect(store.graph.getNode(result.id)?.childIds.length).toBe(3)
  } finally {
    spies.forEach((spy) => spy.mockRestore())
    store.dispose()
  }
})
