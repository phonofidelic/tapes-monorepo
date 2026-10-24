import jsQR from 'jsqr'

/**
 * Reads a QR code from a camera frame or a photo. jsQR rather than the
 * browser's BarcodeDetector, which iOS Safari does not have.
 */

/** Photos are shrunk to this many pixels on their long side before decoding. */
const MAX_PHOTO_SIDE = 1600

export function decodeQr(image: ImageData): string | undefined {
  return (
    jsQR(image.data, image.width, image.height, {
      inversionAttempts: 'attemptBoth',
    })?.data || undefined
  )
}

/** Draws a video frame or an image onto a canvas and reads it back. */
export function frameData(
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData | undefined {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return undefined
  }
  context.drawImage(source, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

/** The QR code in a photo, or undefined when none can be read. */
export async function decodeQrFromImage(
  file: Blob,
): Promise<string | undefined> {
  const bitmap = await createImageBitmap(file)
  try {
    // A phone photo is 12 megapixels. Decoding all of them is slow and gains
    // nothing for a code that fills a good part of the frame.
    const scale = Math.min(
      1,
      MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height),
    )
    const data = frameData(
      bitmap,
      Math.round(bitmap.width * scale),
      Math.round(bitmap.height * scale),
    )
    return data && decodeQr(data)
  } finally {
    bitmap.close()
  }
}
