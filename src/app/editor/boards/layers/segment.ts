import type { Raster } from './raster'

interface Region {
  id: number
  color: number
  area: number
  left: number
  top: number
  right: number
  bottom: number
}

export interface RasterLayer extends Raster {
  x: number
  y: number
}

export interface SegmentedLayers {
  foreground: RasterLayer[]
  background: Raster
}

function distance(a: number[], b: number[]) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

function magenta(r: number, g: number, b: number) {
  return r >= 180 && b >= 180 && g < 110
}

function quantizeMap(map: Raster) {
  const { width, height } = map
  const pixels = width * height
  const histogram = new Map<number, { color: number[]; count: number }>()
  let backgroundPixels = 0
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4
    const r = map.data[offset],
      g = map.data[offset + 1],
      b = map.data[offset + 2]
    if (magenta(r, g, b)) {
      backgroundPixels++
      continue
    }
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)
    const entry = histogram.get(key)
    if (entry) entry.count++
    else histogram.set(key, { color: [r, g, b], count: 1 })
  }
  if (backgroundPixels < pixels * 0.005) {
    throw new Error('生图接口没有返回有效的洋红背景分割图。原图已保留，可重试拆分。')
  }
  const palette: number[][] = []
  for (const entry of [...histogram.values()].sort((a, b) => b.count - a.count)) {
    if (entry.count < Math.max(3, pixels * 0.00003)) continue
    if (!palette.some((color) => distance(color, entry.color) < 42 ** 2)) palette.push(entry.color)
    if (palette.length >= 48) break
  }
  const colors = new Int16Array(pixels).fill(-1)
  let explained = backgroundPixels
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4
    const color = [map.data[offset], map.data[offset + 1], map.data[offset + 2]]
    if (magenta(color[0], color[1], color[2])) continue
    let closest = -1,
      best = 65 ** 2
    for (let p = 0; p < palette.length; p++) {
      const d = distance(color, palette[p])
      if (d < best) {
        closest = p
        best = d
      }
    }
    colors[i] = closest
    if (closest >= 0) explained++
  }
  if (explained < pixels * 0.85) throw new Error('分割图包含过多纹理，无法可靠拆分。请重试。')
  return colors
}

function connectedRegions(colors: Int16Array, width: number, height: number) {
  const pixels = width * height
  const labels = new Int32Array(pixels).fill(-1)
  const queue = new Int32Array(pixels)
  const regions: Region[] = []
  for (let start = 0; start < pixels; start++) {
    if (colors[start] < 0 || labels[start] >= 0) continue
    const id = regions.length
    const region = {
      id,
      color: colors[start],
      area: 0,
      left: width,
      top: height,
      right: 0,
      bottom: 0
    }
    let head = 0,
      tail = 1
    queue[0] = start
    labels[start] = id
    while (head < tail) {
      const pixel = queue[head++]
      const x = pixel % width,
        y = Math.floor(pixel / width)
      region.area++
      region.left = Math.min(region.left, x)
      region.top = Math.min(region.top, y)
      region.right = Math.max(region.right, x + 1)
      region.bottom = Math.max(region.bottom, y + 1)
      for (const next of [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y < height - 1 ? pixel + width : -1
      ]) {
        if (next < 0 || labels[next] >= 0 || colors[next] !== region.color) continue
        labels[next] = id
        queue[tail++] = next
      }
    }
    regions.push(region)
  }
  return { labels, regions }
}

function containsRegion(a: Region, b: Region) {
  return a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom
}

function relatedRegions(a: Region, b: Region, gap: number) {
  if (containsRegion(a, b) || containsRegion(b, a)) return true
  return (
    a.color === b.color &&
    a.left <= b.right + gap &&
    b.left <= a.right + gap &&
    a.top <= b.bottom + gap &&
    b.top <= a.bottom + gap
  )
}

function groupRegions(regions: Region[], width: number, height: number) {
  const pixels = width * height
  const minArea = Math.max(4, Math.round(pixels * 0.00004))
  const kept = regions.filter((region) => region.area >= minArea)
  if (kept.length > 1500) throw new Error('分割图碎片过多，请重试拆分。')
  const roots = new Map(kept.map((region) => [region.id, region.id]))
  const root = (id: number): number => {
    let current = id
    while (roots.get(current) !== current && roots.has(current))
      current = roots.get(current) ?? current
    return current
  }
  const gap = Math.max(2, Math.round(Math.min(width, height) * 0.006))
  // Nearby fragments of the same object join; distant same-color objects remain selectable.
  for (let a = 0; a < kept.length; a++) {
    for (let b = a + 1; b < kept.length; b++) {
      const left = kept[a],
        right = kept[b]
      if (relatedRegions(left, right, gap)) roots.set(root(right.id), root(left.id))
    }
  }
  const groups = new Map<number, Region>()
  for (const region of kept) {
    const id = root(region.id)
    const group = groups.get(id)
    if (group) {
      group.left = Math.min(group.left, region.left)
      group.top = Math.min(group.top, region.top)
      group.right = Math.max(group.right, region.right)
      group.bottom = Math.max(group.bottom, region.bottom)
      group.area += region.area
    } else groups.set(id, { ...region, id })
  }
  if (!groups.size || groups.size > 100) throw new Error('无法得到清晰的物体分组，请重试拆分。')
  return { groups, roots, root }
}

/** Canvas-style color masks: cluster near colors, split distant components, retain original pixels. */
export function splitRaster(source: Raster, map: Raster): SegmentedLayers {
  const { width, height } = source
  if (map.width !== width || map.height !== height) throw new Error('分割图尺寸与原图不一致。')
  const pixels = width * height
  const { labels, regions } = connectedRegions(quantizeMap(map), width, height)
  const { groups, roots, root } = groupRegions(regions, width, height)
  const foreground = [...groups.values()]
    .sort((a, b) => b.area - a.area)
    .map((group) => ({
      ...group,
      x: group.left,
      y: group.top,
      width: group.right - group.left,
      height: group.bottom - group.top,
      data: new Uint8ClampedArray((group.right - group.left) * (group.bottom - group.top) * 4)
    }))
  const byId = new Map(foreground.map((layer) => [layer.id, layer]))
  const background = { width, height, data: source.data.slice() }
  for (let i = 0; i < pixels; i++) {
    const label = labels[i]
    if (!roots.has(label)) continue
    const layer = byId.get(root(label))
    if (!layer) continue
    const x = i % width,
      y = Math.floor(i / width)
    const target = ((y - layer.y) * layer.width + x - layer.x) * 4
    layer.data.set(source.data.subarray(i * 4, i * 4 + 4), target)
    background.data[i * 4 + 3] = 0
  }
  return { foreground, background }
}
