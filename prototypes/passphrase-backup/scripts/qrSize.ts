/**
 * THROWAWAY (TAP-218). Prints how big the backup QR code is for each KDF, at
 * each error correction level, so the size claim in the README is checked.
 */

import QRCode from 'qrcode'
import { toCompact } from '../src/format'
import type { KdfParams } from '../src/kdf'
import { generatePersonKey, wrapPersonKey } from '../src/wrap'

const settings: KdfParams[] = [
  { kdf: 'pbkdf2-sha256', iterations: 100_000 },
  { kdf: 'argon2id', memoryKiB: 8 * 1024, iterations: 1, parallelism: 1 },
]
const key = await generatePersonKey()
for (const kdf of settings) {
  const compact = toCompact(await wrapPersonKey(key, 'a b c d', kdf))
  const sizes = (['L', 'M', 'Q', 'H'] as const).map((level) => {
    const qr = QRCode.create(compact, { errorCorrectionLevel: level })
    return `${level}: v${qr.version} (${qr.modules.size}x${qr.modules.size})`
  })
  console.log(
    `${kdf.kdf.padEnd(14)} ${compact.length} chars  ${sizes.join('  ')}`,
  )
}
