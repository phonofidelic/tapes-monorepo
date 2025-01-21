import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  // SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Server, WebSocket } from 'ws'
import { Repo } from '@automerge/automerge-repo'
import { NodeWSServerAdapter } from '@automerge/automerge-repo-network-websocket'
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs'
import { Logger } from '@nestjs/common'
import { IncomingMessage } from 'http'

@WebSocketGateway(433, {
  serveClient: false,
})
export class SyncGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(SyncGateway.name)

  @WebSocketServer()
  server: Server
  readyResolvers: ((value: any) => void)[] = []
  isReady = false
  repo: Repo

  afterInit(wss: Server) {
    this.repo = new Repo({
      // @ts-ignore
      network: [new NodeWSServerAdapter(this.server)],
      storage: new NodeFSStorageAdapter('./data'),
      // @ts-ignore
      peerId: `storage-server-test`,
      sharePolicy: async () => false,
    })
    this.isReady = true
    this.logger.log('Initialized')
  }

  async ready() {
    if (this.isReady) {
      return true
    }

    return new Promise((resolve) => {
      this.readyResolvers.push(resolve)
    })
  }

  handleConnection(client: WebSocket, message: IncomingMessage) {
    // @ts-ignore
    // client.on('upgrade', (request, socket, head) => {
    //   console.log('upgrade')
    //   this.server.handleUpgrade(request, socket, head, (ws) => {
    //     this.server.emit('connection', ws, request)
    //   })
    // })

    // console.log('*** message:', message.headers)
    // const webSocketKey = message.headers['sec-websocket-key']
    // const webSocketAcceptKey = createHash('sha1')
    //   .update(webSocketKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    //   .digest('base64')
    // console.log('*** webSocketAcceptKey:', webSocketAcceptKey)

    this.logger.log(`Client connected`)
  }

  // handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer) {
  //   console.log('*** upgrade', request, socket, head)
  //   this.server.handleUpgrade(request, socket, head, (ws) => {
  //     this.server.emit('connection', ws, request)
  //   })
  // }

  handleDisconnect(client: any) {
    this.logger.log(`Client disconnected`)
  }

  // @SubscribeMessage('ping')
  // handleMessage(client: any, data: any) {
  //   this.logger.log(`Message received from client id: ${client.id}`)
  //   this.logger.debug(`Payload: ${data}`)
  //   return {
  //     event: 'pong',
  //     data: 'Wrong data that will make the test fail',
  //   }
  // }

  // @SubscribeMessage('events')
  // handleUpgrade(client: Socket, payload: any): string {
  //   console.log('upgrade', payload)
  //   // this.server.on('upgrade', (request, socket, head) => {
  //   //   this.server.handleUpgrade(request, socket, head, (ws) => {
  //   //     this.server.emit('connection', ws, request)
  //   //   })
  //   //   console.log('upgrade', request, socket, head)
  //   // })
  //   return 'Hello world!'
  // }

  // @SubscribeMessage('sync')
  // handleMessage(client: Socket, payload: any): string {
  //   return 'Hello world!'
  // }

  // abortHandshake(
  //   socket: {
  //     once: (arg0: string, arg1: any) => void
  //     destroy: any
  //     end: (arg0: string) => void
  //   },
  //   code: string | number,
  //   message?: string | ArrayBuffer | DataView<ArrayBufferLike> | undefined,
  //   headers?: { [x: string]: any },
  // ) {
  //   //
  //   // The socket is writable unless the user destroyed or ended it before calling
  //   // `server.handleUpgrade()` or in the `verifyClient` function, which is a user
  //   // error. Handling this does not make much sense as the worst that can happen
  //   // is that some of the data written by the user might be discarded due to the
  //   // call to `socket.end()` below, which triggers an `'error'` event that in
  //   // turn causes the socket to be destroyed.
  //   //
  //   message = message || http.STATUS_CODES[code] || ''
  //   headers = {
  //     Connection: 'close',
  //     'Content-Type': 'text/html',
  //     'Content-Length': Buffer.byteLength(message),
  //     ...headers,
  //   }

  //   socket.once('finish', socket.destroy)

  //   socket.end(
  //     `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\n` +
  //       Object.keys(headers)
  //         .map((h) => `${h}: ${headers[h]}`)
  //         .join('\r\n') +
  //       '\r\n\r\n' +
  //       message,
  //   )
  // }
}
