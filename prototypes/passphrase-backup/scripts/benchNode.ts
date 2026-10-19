/**
 * THROWAWAY (TAP-218). Times the benchmark settings in Node on this machine.
 * This is a rough baseline only. It is NOT a phone measurement: a desktop or
 * server CPU is several times faster, and Node's PBKDF2 is native OpenSSL.
 */

import os from 'os'
import { BENCH_SETTINGS, summarize } from '../src/bench'
import { deriveBytes, describeKdf } from '../src/kdf'

const runs = Number(process.argv[2] ?? 5)
console.log(
  `Node ${process.version}, ${os.cpus()[0]?.model ?? 'unknown CPU'}, ${os.cpus().length} cores`,
)
console.log(`${runs} runs each. NOT a phone measurement.\n`)

for (const setting of BENCH_SETTINGS) {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const start = performance.now()
    await deriveBytes('correct horse battery staple', salt, setting.params)
    times.push(performance.now() - start)
  }
  const s = summarize(times)
  const label = `${describeKdf(setting.params)}${setting.proposed ? ' (proposed)' : ''}`
  console.log(
    `${label.padEnd(48)} median ${String(s.median).padStart(5)} ms  min ${s.min}  max ${s.max}`,
  )
}
