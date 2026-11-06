import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { loadConfig } from './config/config';

async function bootstrap() {
  const cfg = loadConfig(); // fail-fast nếu thiếu/không an toàn
  const app = await NestFactory.create(AppModule.forRoot(cfg), { bodyParser: true });
  configureApp(app, cfg);
  if (cfg.docsEnabled) setupSwagger(app);
  await app.listen(cfg.port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `GiftFlow API :${cfg.port} env=${cfg.nodeEnv} db=${cfg.dbType} ai=${cfg.aiProvider}${cfg.docsEnabled ? ' docs=/docs' : ''}`,
  );
}
bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
