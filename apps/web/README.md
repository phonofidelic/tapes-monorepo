# web

The [Tapes](../../README.md) marketing and landing site, built with
[Next.js](https://nextjs.org). It is not part of the recording app. Visitors
read it in a browser.

## Develop

```sh
yarn workspace web dev        # http://localhost:3002
yarn workspace web dev:https  # https://localhost:3002, using Next's experimental HTTPS
```

## Build

```sh
yarn workspace web build
yarn workspace web start        # serve the production build
```

No app-specific environment variables are required.
