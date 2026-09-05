/**
 * Lets Node resolve the extensionless relative imports the app's TypeScript is
 * written with (`./blobStore`), which are a bundler convention Node's ESM
 * resolver does not follow. Node itself strips the types.
 *
 * Only the host child process uses this; see registerTsExtensions.mjs and
 * hostProcess.ts. Nothing here changes how the app is built or shipped.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') && !specifier.endsWith('.ts')) {
      return next(`${specifier}.ts`, context)
    }
    throw error
  }
}
