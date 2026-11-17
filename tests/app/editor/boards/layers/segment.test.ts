import { expect, test } from 'bun:test'

import type { Raster } from '@/app/editor/boards/layers/raster'
import { splitRaster } from '@/app/editor/boards/layers/segment'

function solid(width: number, height: number, color: number[]): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(color, i * 4)
  return { width, height, data }
}

function box(raster: Raster, x: number, y: number, width: number, height: number, color: number[]) {
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) raster.data.set(color, (row * raster.width + col) * 4)
  }
}

test('separates distant instances of the same mask color and reconstructs original source pixels', () => {
  const source = solid(60, 40, [240, 230, 220, 255])
  const map = solid(60, 40, [255, 0, 255, 255])
  box(source, 3, 4, 10, 9, [12, 80, 200, 255])
  box(source, 40, 20, 10, 10, [190, 20, 40, 255])
  box(map, 3, 4, 10, 9, [255, 0, 0, 255])
  box(map, 40, 20, 10, 10, [250, 2, 0, 255])
  const result = splitRaster(source, map)
  expect(result.foreground.length).toBe(2)
  const reconstructed = result.background.data.slice()
  for (const layer of result.foreground) {
    for (let y = 0; y < layer.height; y++)
      for (let x = 0; x < layer.width; x++) {
        const from = (y * layer.width + x) * 4
        if (layer.data[from + 3])
          reconstructed.set(
            layer.data.subarray(from, from + 4),
            ((y + layer.y) * source.width + x + layer.x) * 4
          )
      }
  }
  expect(reconstructed).toEqual(source.data)
  expect(result.background.data[(4 * 60 + 3) * 4 + 3]).toBe(0)
})

test('keeps background gaps transparent inside an irregular object bounding box', () => {
  const source = solid(20, 20, [80, 70, 60, 255])
  const map = solid(20, 20, [255, 0, 255, 255])
  box(map, 3, 3, 3, 10, [0, 150, 200, 255])
  box(map, 3, 10, 10, 3, [0, 150, 200, 255])
  const result = splitRaster(source, map)
  expect(result.foreground.length).toBe(1)
  expect(result.foreground[0].data[(1 * 10 + 8) * 4 + 3]).toBe(0)
})

test('rejects an ordinary image instead of silently treating it as a segmentation map', () => {
  const photo = solid(30, 30, [180, 100, 70, 255])
  expect(() => splitRaster(photo, photo)).toThrow('分割图')
})
