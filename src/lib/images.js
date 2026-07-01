// Client-side image processing for free-tier (no Firebase Storage).
// Resizes + compresses an image File and returns a data URL we can embed
// directly in a Firestore document.
//
// Firestore doc limit is 1 MB. Base64 inflates by ~33%, so we aim for the
// raw image to stay under ~700 KB. The presets below land well below that
// for typical inputs, and we auto-retry at lower quality if needed.

const MAX_BYTES_AFTER_BASE64 = 900 * 1024 // safety margin under 1 MB doc cap

export const PRESETS = {
  MESSAGE_IMAGE: { maxSide: 1280, quality: 0.82, mime: 'image/jpeg' },
  AVATAR:        { maxSide: 256,  quality: 0.9,  mime: 'image/jpeg' },
  BANNER:        { maxSide: 1500, quality: 0.85, mime: 'image/jpeg' },
  EMOJI:         { maxSide: 128,  quality: 0.95, mime: 'image/png'  }, // preserve transparency
}

const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
  img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
  img.src = url
})

/**
 * Resize & compress a File to a data URL.
 * If the encoded result exceeds ~900 KB, retries at lower quality.
 */
export async function resizeToDataURL(file, preset = PRESETS.MESSAGE_IMAGE) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('Not an image file.')
  }

  const img = await loadImage(file)
  const scale = Math.min(1, preset.maxSide / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)

  let quality = preset.quality
  let url = canvas.toDataURL(preset.mime, quality)
  while (url.length > MAX_BYTES_AFTER_BASE64 && quality > 0.4 && preset.mime === 'image/jpeg') {
    quality -= 0.12
    url = canvas.toDataURL(preset.mime, quality)
  }
  if (url.length > MAX_BYTES_AFTER_BASE64) {
    throw new Error('Image too large even after compression — try a smaller image.')
  }

  return {
    dataURL: url,
    width: w,
    height: h,
    approxBytes: Math.floor(url.length * 0.75), // base64 → bytes
  }
}
