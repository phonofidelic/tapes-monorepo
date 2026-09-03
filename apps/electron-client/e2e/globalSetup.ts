import { ensurePackagedApp } from './electronApp'

/**
 * Packaging happens here rather than in a `beforeAll` because it takes minutes
 * — asar, ad-hoc signing, staged resources — and a hook is bounded by the test
 * timeout. Global setup is not, so the run's first test starts against an app
 * that already exists.
 */
export default async function globalSetup() {
  await ensurePackagedApp()
}
