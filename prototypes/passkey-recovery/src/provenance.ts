/**
 * THROWAWAY PROTOTYPE (TAP-217). Not production code.
 *
 * Re-exports the provenance package from source. The prototype is not a
 * workspace, and the host plugin runs inside the Vite config, so a relative
 * import is the one path that works in the browser, the config and tsc.
 */

export * from '../../../packages/provenance/lib/index'
