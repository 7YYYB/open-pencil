/** PNG stores integer pixels per metre: 11,811 is 300 ppi to its supported precision. */
const PNG_PHYS_300 = Uint8Array.from([
  0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 46, 35, 0, 0, 46, 35, 1, 120, 165, 63, 118
])
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const
const PNG_IHDR = 0x49484452
const PNG_PHYS = 0x70485973
const PNG_IEND = 0x49454e44

/** JFIF 1.02, dots per inch, 300 × 300, with no embedded thumbnail. */
const JPEG_JFIF_300 = Uint8Array.from([
  255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 2, 1, 1, 44, 1, 44, 0, 0
])
const JFIF_IDENTIFIER = [74, 70, 73, 70, 0] as const

function join(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

/** Replaces only physical-size metadata; the IHDR and every compressed pixel chunk stay intact. */
export function pngAt300PPI(source: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!PNG_SIGNATURE.every((byte, index) => source[index] === byte)) {
    throw new Error('导出结果不是有效的 PNG 图片。')
  }
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  const parts = [source.subarray(0, 8)]
  let offset = 8
  while (offset + 12 <= source.length) {
    const length = view.getUint32(offset)
    const type = view.getUint32(offset + 4)
    const end = offset + length + 12
    if (end > source.length || (offset === 8 && (type !== PNG_IHDR || length !== 13))) break
    if (type !== PNG_PHYS) parts.push(source.subarray(offset, end))
    if (type === PNG_IHDR) parts.push(PNG_PHYS_300)
    if (type === PNG_IEND) {
      parts.push(source.subarray(end))
      return join(parts)
    }
    offset = end
  }
  throw new Error('PNG 导出数据不完整，未保存文件。')
}

/** Updates or adds JFIF density without touching any JPEG scan or quantization data. */
export function jpegAt300PPI(source: Uint8Array): Uint8Array<ArrayBuffer> {
  if (source[0] !== 0xff || source[1] !== 0xd8) {
    throw new Error('导出结果不是有效的 JPG 图片。')
  }
  const bytes = new Uint8Array(source)
  const view = new DataView(bytes.buffer)
  let foundJFIF = false
  let offset = 2
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) break
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    // A scan starts the compressed pixels; no marker inside them is metadata.
    if (marker === 0xda) {
      return foundJFIF ? bytes : join([bytes.subarray(0, 2), JPEG_JFIF_300, bytes.subarray(2)])
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = view.getUint16(offset)
    const data = offset + 2
    if (length < 2 || offset + length > bytes.length) break
    if (
      marker === 0xe0 &&
      length >= 16 &&
      JFIF_IDENTIFIER.every((byte, index) => bytes[data + index] === byte)
    ) {
      bytes[data + 7] = 1
      view.setUint16(data + 8, 300)
      view.setUint16(data + 10, 300)
      foundJFIF = true
    }
    offset += length
  }
  throw new Error('JPG 导出数据不完整，未保存文件。')
}
