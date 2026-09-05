import type http from 'http'

/**
 * Response helpers shared by every route the embedded server exposes: the blob
 * routes and the event routes.
 *
 * They share an origin, a port and a pairing token, so they must also send the
 * same CORS headers. A guest that could reach one route and not the other
 * would fail in a way no single route's code explains.
 */

export const CORS_HEADERS: Record<string, string> = {
  // Safe as a wildcard only because authorization is a bearer token and never
  // a cookie: a hostile page can send the request but cannot mint the token.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,range',
  'Access-Control-Expose-Headers':
    'content-length,content-range,accept-ranges,etag',
  'Access-Control-Max-Age': '86400',
}

export function sendJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

export function sendStatus(response: http.ServerResponse, status: number) {
  response.writeHead(status, CORS_HEADERS)
  response.end()
}
