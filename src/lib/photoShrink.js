// Shrinks a photo on the phone before it is uploaded: the long side becomes at
// most MAX_EDGE pixels and the result is a JPEG (usually 300 to 500 KB instead
// of 3 to 8 MB). Sharp enough to read a model number or see a stain.
export const MAX_EDGE = 1600
export const JPEG_QUALITY = 0.8

// The size to draw at: same shape, long side capped, never enlarged.
export function fitWithin(width, height, maxEdge = MAX_EDGE) {
  const longSide = Math.max(width, height)
  if (!longSide || longSide <= maxEdge) return { width, height }
  const scale = maxEdge / longSide
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function decode(file) {
  // 'from-image' applies the photo's rotation so a portrait shot is not
  // uploaded on its side.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() }
    } catch {
      // Fall through to the <img> route below.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('unreadable'))
      el.src = url
    })
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Returns a JPEG Blob. Throws a plain-language Error if the file cannot be read
// as a picture (so the screen can say which photo, and carry on with the rest).
export async function shrinkImage(file) {
  let decoded
  try {
    decoded = await decode(file)
  } catch {
    throw new Error("That photo couldn't be read. Try taking it again.")
  }
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    // JPEG has no transparency; paint white first so a PNG does not go black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(decoded.source, 0, 0, width, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) throw new Error('empty')
    return blob
  } catch {
    throw new Error("That photo couldn't be prepared. Try taking it again.")
  } finally {
    decoded.close()
  }
}
