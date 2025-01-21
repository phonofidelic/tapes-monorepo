import { Module } from '@nestjs/common'
import { SyncGateway } from './sync.gateway'

@Module({
  providers: [SyncGateway],
})
export class SyncModule {}
