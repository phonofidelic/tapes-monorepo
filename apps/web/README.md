# web

The [Tapes](../../README.md) marketing / landing site, built with
[Next.js](https://nextjs.org).

## Develop

```sh
yarn workspace web dev        # http://localhost:3002
yarn workspace web dev:https  # https://localhost:3002 (Next's --experimental-https)
```

## Build

```sh
yarn workspace web build
yarn workspace web start        # serve the production build
```

No app-specific environment variables are required.
