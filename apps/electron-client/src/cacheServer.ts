/**
 * Adapted from https://stackoverflow.com/a/29046869
 */
import http from 'http'
import { readFile } from 'fs/promises'
import path from 'path'

const isValidExtension = (
  ext: string,
  mimeType: Record<string, string>,
): ext is (typeof mimeType)[typeof ext] => {
  return Object.keys(mimeType).includes(ext)
}

export function cacheServer(cachePath: string) {
  // TODO: Make dynamic based on available port?
  const port = 9000

  const supportedMimeTypeMap = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
  } as const

  http
    .createServer(
      async (request: http.IncomingMessage, response: http.ServerResponse) => {
        console.log(`${request.method} ${request.url}`)

        if (!request.url) {
          response.writeHead(400, { 'Content-Type': 'text/plain' })
          response.end('Bad Request')
          return
        }

        const filename = request.url.replace('/', '')

        const ext = path.parse(filename)
          .ext as keyof typeof supportedMimeTypeMap
        if (!isValidExtension(ext, supportedMimeTypeMap)) {
          response.writeHead(400, { 'Content-Type': 'text/plain' })
          response.end('Bad Request')
          return
        }

        const data = await readFile(path.resolve(cachePath, filename))

        if (!data) {
          response.writeHead(404, { 'Content-Type': 'text/plain' })
          response.end(`File ${filename} not found!`)
        }

        if (data) {
          response.writeHead(200, {
            'Content-Type': supportedMimeTypeMap[ext] || 'audio/wav',
          })
          response.end(data)
        }
      },
    )
    .listen(port)

  console.log(`Server listening on port ${port}`)
}
