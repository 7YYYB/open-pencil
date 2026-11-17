import { abortReason } from '@/app/runtime/abort'

import type { Raster } from './raster'
import type { SegmentedLayers } from './segment'

/** Image processing stays off the UI thread; Stop terminates the worker immediately. */
export function extractLayers(
  source: Raster,
  map: Raster,
  signal: AbortSignal
): Promise<SegmentedLayers> {
  signal.throwIfAborted()
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', stop)
      worker.terminate()
    }
    const stop = () => {
      cleanup()
      reject(abortReason(signal))
    }
    worker.onmessage = ({ data }: MessageEvent<{ result?: SegmentedLayers; error?: string }>) => {
      cleanup()
      if (data.result) resolve(data.result)
      else reject(new Error(data.error ?? '分割像素失败。'))
    }
    worker.onerror = () => {
      cleanup()
      reject(new Error('图层拆分进程异常，请重试。'))
    }
    signal.addEventListener('abort', stop, { once: true })
    worker.postMessage({ source, map }, [])
  })
}
