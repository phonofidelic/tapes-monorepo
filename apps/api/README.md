# api

A standalone [NestJS](https://nestjs.com/) **Automerge sync server** for
[Tapes](../../README.md). It provides an alternative/remote sync backend to the
sync server embedded in the desktop host (`electron-client`).

- `src/sync/sync.gateway.ts` — a WebSocket gateway backed by an Automerge repo
  (`@automerge/automerge-repo`) with filesystem storage (`NodeFSStorageAdapter`,
  writing to `./data`).
- `src/auth/` — a JWT WebSocket guard. **Currently disabled** (the `AuthModule`
  import is commented out in `src/app.module.ts`).
- `src/main.ts` — bootstraps Nest with `helmet` and the `ws` adapter.

## Develop

```sh
yarn workspace api dev   # nest start --watch, https://localhost:3031
```

The server listens on `PORT` (default `3031`).

### Dev HTTPS certificate

In development (`NODE_ENV=development`) the API serves over HTTPS and reads
`localhost-key.pem` and `localhost-cert.pem` from this directory. Generate them
with:

```sh
yarn workspace api cert
```

## Environment variables

| Variable   | Purpose                                    |
| ---------- | ------------------------------------------ |
| `NODE_ENV` | `development` enables the HTTPS/cert path. |
| `PORT`     | HTTP(S) port. Defaults to `3031`.          |

See [`.env.example`](./.env.example).

## Tests

```sh
yarn workspace api test   # jest
```

> **Note:** the Jest suite currently has a pre-existing compile failure and is
> excluded from CI (which runs only the `@tapes-monorepo/core` unit tests).
