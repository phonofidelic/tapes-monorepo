# api

A standalone [NestJS](https://nestjs.com/) Automerge sync server for
[Tapes](../../README.md). It is an alternative remote backend to the sync server
embedded in the desktop host. A client points at it by entering its url in
Settings.

What is in it:

- `src/sync/sync.gateway.ts` is a WebSocket gateway backed by an Automerge repo.
  It stores documents on the filesystem under `./data`.
- `src/auth/` is a JWT WebSocket guard. It is **currently disabled**. The module
  import is commented out in `src/app.module.ts`.
- `src/main.ts` bootstraps Nest with helmet and the `ws` WebSocket adapter.

## Develop

```sh
yarn workspace api dev   # nest start --watch, https://localhost:3031
```

The server listens on `PORT`, which defaults to `3031`.

### Dev HTTPS certificate

With `NODE_ENV=development` the server serves over HTTPS. It reads
`localhost-key.pem` and `localhost-cert.pem` from this directory. Generate them
with:

```sh
yarn workspace api cert
```

## Environment variables

| Variable   | Purpose                                                    |
| ---------- | ---------------------------------------------------------- |
| `NODE_ENV` | `development` turns on HTTPS and reads the dev cert files. |
| `PORT`     | The port to listen on. Defaults to `3031`.                 |

See [`.env.example`](./.env.example).

## Tests

```sh
yarn workspace api test       # jest unit tests
yarn workspace api test:e2e   # jest e2e tests
```

The Jest suite has a pre-existing compile failure and is excluded from CI. The
CI unit test step runs core, electron-client and web-client only.
