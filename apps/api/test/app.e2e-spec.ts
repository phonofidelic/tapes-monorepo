import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// supertest is a CommonJS `export =` module; `import = require` keeps it
// callable under TS 6 without enabling esModuleInterop (which breaks the
// ts-jest transpilation of automerge-repo's ESM at runtime).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
