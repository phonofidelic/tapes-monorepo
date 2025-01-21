import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { WsAdapter } from '@nestjs/platform-ws'
import { readFileSync } from 'fs'
import helmet from 'helmet'

const createOptions =
  process.env.NODE_ENV === 'development'
    ? {
        httpsOptions: {
          key: readFileSync('./localhost-key.pem'),
          cert: readFileSync('./localhost.pem'),
        },
      }
    : {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, createOptions)
  app.use(helmet())
  app.useWebSocketAdapter(new WsAdapter())
  await app.listen(process.env.PORT ?? 3031)
}
bootstrap()
