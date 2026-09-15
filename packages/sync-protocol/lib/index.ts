/**
 * What a guest and a host must agree on to open a sync socket.
 *
 * This package exists because the two sides run in different bundles. Guests
 * are renderer code in `@tapes-monorepo/core`. The host is the Electron main
 * process, which cannot import core: core's entry is the React app, so the main
 * bundle would depend on nothing in that graph ever gaining a module-scope side
 * effect. Anything both sides have to agree on goes here instead of being
 * copied into each.
 *
 * Keep this package free of React, Node and browser APIs. It is plain
 * TypeScript so that either side can import it.
 */

export * from './deviceLabel'
export * from './hostClient'
