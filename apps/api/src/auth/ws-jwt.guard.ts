import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Socket } from 'net'
import { Observable } from 'rxjs'
import { WebSocket } from 'ws'

@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    if (context.getType() !== 'ws') {
      return true
    }

    const client: WebSocket = context.switchToWs().getClient()
    return WsJwtGuard.validateClient(client)
  }

  static validateClient(client: WebSocket): boolean {
    console.log('*** client:', client)
    // TODO: Implement auth guard for websocket connections
    // const { authorization } = client.

    return true
  }
}
