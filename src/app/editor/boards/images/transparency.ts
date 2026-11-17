/** Checks decoded alpha pixels, so an opaque PNG with a checkerboard is never called transparent. */
export async function requireTransparentPixels(bytes: Uint8Array): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('无法解码生成的透明 PNG。'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法检查 PNG 的透明区域。')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    for (let alpha = 3; alpha < pixels.length; alpha += 4) {
      if (pixels[alpha] < 255) return
    }
    throw new Error('图像 API 返回的 PNG 完全不透明，未将它当作透明文字素材插入画板。')
  } finally {
    URL.revokeObjectURL(url)
  }
}
