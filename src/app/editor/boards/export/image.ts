import { exportBounds, rasterSize } from '@open-pencil/core/io/formats/raster'
import { imageHeader } from '@open-pencil/scene-graph/images'

import type { EditorStore } from '@/app/editor/active-store'

import { jpegAt300PPI, pngAt300PPI } from './density'

type BoardExportHost = Pick<EditorStore, 'graph' | 'renderExportImage'> & {
  state: Pick<EditorStore['state'], 'currentPageId'>
}

/** Renders the actual board box at 1×, then writes density without resizing its pixels. */
export async function renderBoardImage(
  store: BoardExportHost,
  boardId: string,
  format: 'png' | 'jpg'
): Promise<Uint8Array<ArrayBuffer>> {
  const bounds = exportBounds(store.graph, [boardId], true)
  if (!bounds) throw new Error('展板没有可导出的可见内容。')
  const expected = rasterSize(bounds, 1)
  const bytes = await store.renderExportImage(
    [boardId],
    1,
    format === 'png' ? 'PNG' : 'JPG',
    store.state.currentPageId,
    { useAbsoluteBounds: true }
  )
  if (!bytes) throw new Error('展板导出失败，未生成图片。')
  const header = imageHeader(bytes)
  if (
    !header ||
    header.type !== (format === 'png' ? 'image/png' : 'image/jpeg') ||
    header.width !== expected.width ||
    header.height !== expected.height
  ) {
    throw new Error(`导出像素与展板尺寸不符，应为 ${expected.width} × ${expected.height} px。`)
  }
  return format === 'png' ? pngAt300PPI(bytes) : jpegAt300PPI(bytes)
}
