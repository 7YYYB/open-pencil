import { expect, test } from 'bun:test'
import { crc32 } from 'node:zlib'

import { getCanvasKit } from '@open-pencil/core/canvaskit'
import { createCanvasKitRasterCodec } from '@open-pencil/core/io/formats/raster'
import { SceneGraph } from '@open-pencil/scene-graph'
import { imageHeader } from '@open-pencil/scene-graph/images'
import { expectDefined } from '@open-pencil/test-support/assert'

import type { EditorStore } from '@/app/editor/active-store'
import { jpegAt300PPI, pngAt300PPI } from '@/app/editor/boards/export/density'
import { renderBoardImage } from '@/app/editor/boards/export/image'

async function raster(format: 'png' | 'jpg') {
  const codec = createCanvasKitRasterCodec(await getCanvasKit())
  const data = new Uint8Array(64 * 32 * 4)
  for (let index = 0; index < 64 * 32; index++) {
    data.set([index % 256, 127, 255, 255], index * 4)
  }
  const image = { width: 64, height: 32, data }
  const bytes = expectDefined(format === 'png' ? codec.encodePNG(image) : codec.encodeJPG(image))
  return { codec, bytes }
}

test('PNG files contain valid 300 ppi pHYs metadata without changing their pixels', async () => {
  const { codec, bytes } = await raster('png')
  const output = pngAt300PPI(bytes)
  const view = new DataView(output.buffer)
  expect(new TextDecoder().decode(output.subarray(37, 41))).toBe('pHYs')
  expect([view.getUint32(41), view.getUint32(45), output[49]]).toEqual([11811, 11811, 1])
  expect(view.getUint32(50)).toBe(crc32(output.subarray(37, 50)))
  expect(output.subarray(0, 33)).toEqual(bytes.subarray(0, 33))
  expect(output.subarray(54)).toEqual(bytes.subarray(33))
  expect(codec.decode(output)?.data).toEqual(codec.decode(bytes)?.data)

  // An old density is replaced, so readers never have two conflicting pHYs chunks.
  const previous = output.slice()
  const previousView = new DataView(previous.buffer)
  previousView.setUint32(41, 2835)
  previousView.setUint32(45, 2835)
  previousView.setUint32(50, crc32(previous.subarray(37, 50)))
  expect(pngAt300PPI(previous)).toEqual(output)
})

test('JPG files set the JFIF unit and both densities while preserving compressed data', async () => {
  const { codec, bytes } = await raster('jpg')
  expect(new TextDecoder().decode(bytes.subarray(6, 11))).toBe('JFIF\0')
  const output = jpegAt300PPI(bytes)
  const view = new DataView(output.buffer)
  expect([output[13], view.getUint16(14), view.getUint16(16)]).toEqual([1, 300, 300])
  expect(output.subarray(18)).toEqual(bytes.subarray(18))
  const restored = output.slice()
  restored.set(bytes.subarray(13, 18), 13)
  expect(restored).toEqual(bytes)
  expect(codec.decode(output)?.data).toEqual(codec.decode(bytes)?.data)
  expect(jpegAt300PPI(output)).toEqual(output)
})

test('a JPG without JFIF gets its density segment without reencoding', async () => {
  const { codec, bytes } = await raster('jpg')
  const end = 4 + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(4)
  const noJFIF = Uint8Array.from([...bytes.subarray(0, 2), ...bytes.subarray(end)])
  const output = jpegAt300PPI(noJFIF)
  expect(output.subarray(20)).toEqual(noJFIF.subarray(2))
  const view = new DataView(output.buffer)
  expect([output[13], view.getUint16(14), view.getUint16(16)]).toEqual([1, 300, 300])
  expect(codec.decode(output)?.data).toEqual(codec.decode(bytes)?.data)
})

test('board export renders its actual bounds at 1× and refuses a wrong pixel size', async () => {
  const { bytes } = await raster('png')
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const board = graph.createNode('FRAME', page.id, { width: 64, height: 32 })
  const calls: Parameters<EditorStore['renderExportImage']>[] = []
  const host = {
    graph,
    state: { currentPageId: page.id },
    renderExportImage: async (...args: Parameters<EditorStore['renderExportImage']>) => {
      calls.push(args)
      return new Uint8Array(bytes)
    }
  }
  const output = await renderBoardImage(host, board.id, 'png')
  expect(calls).toEqual([[[board.id], 1, 'PNG', page.id, { useAbsoluteBounds: true }]])
  expect(imageHeader(output)).toMatchObject({ width: 64, height: 32 })
  graph.updateNode(board.id, { width: 3508, height: 4961 })
  await expect(renderBoardImage(host, board.id, 'png')).rejects.toThrow('3508 × 4961 px')
})

test('incomplete image files are never reported as a successful 300 ppi export', async () => {
  const { bytes: png } = await raster('png')
  const { bytes: jpg } = await raster('jpg')
  expect(() => pngAt300PPI(png.subarray(0, 33))).toThrow('不完整')
  expect(() => jpegAt300PPI(jpg.subarray(0, 20))).toThrow('不完整')
})
