export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export async function decodeRaster(
  bytes: Uint8Array,
  width?: number,
  height?: number
): Promise<Raster> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice()]))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width ?? bitmap.width
    canvas.height = height ?? bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法读取图片像素。')
    context.imageSmoothingEnabled = width === undefined
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return context.getImageData(0, 0, canvas.width, canvas.height)
  } finally {
    bitmap.close()
  }
}

export async function encodeRaster(raster: Raster): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = raster.width
  canvas.height = raster.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建透明图层。')
  context.putImageData(new ImageData(raster.data.slice(), raster.width, raster.height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('无法导出 PNG 图层。'))),
      'image/png'
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}
