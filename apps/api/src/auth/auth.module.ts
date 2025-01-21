import { Module } from '@nestjs/common'
import { WsJwtGuard } from './ws-jwt.guard'

@Module({
  providers: [
    {
      provide: 'WS_JWT_GUARD',
      useClass: WsJwtGuard,
    },
  ],
})
export class AuthModule {}
