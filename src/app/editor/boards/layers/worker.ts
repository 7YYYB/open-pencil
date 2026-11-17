import type { Raster } from './raster'
import { splitRaster } from './segment'

self.onmessage = ({ data }: MessageEvent<{ source: Raster; map: Raster }>) => {
  try {
    const result = splitRaster(data.source, data.map)
    // Worker messages use transfer options, not Window's targetOrigin.
    self.postMessage({ result }, { transfer: [] })
  } catch (error) {
    self.postMessage(
      { error: error instanceof Error ? error.message : '分割像素失败。' },
      { transfer: [] }
    )
  }
}
