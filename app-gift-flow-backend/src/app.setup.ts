import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppConfig } from './config/config';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { requestIdMiddleware } from './common/request-id.middleware';

/** Dùng chung giữa main.ts và e2e test để hành vi y hệt production. */
export function configureApp(app: INestApplication, cfg: AppConfig): void {
  const http = app.getHttpAdapter().getInstance();
  if (cfg.isProd) http.set('trust proxy', 1); // sau Caddy/Nginx -> rate limit theo IP thật
  http.disable('x-powered-by');

  app.use(requestIdMiddleware);
  app.use(helmet());
  // App mobile không dựa vào CORS để bảo mật; chỉ mở cho origin cấu hình (web admin/staging).
  app.enableCors({ origin: cfg.corsOrigins.length ? cfg.corsOrigins : false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication) {
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('GiftFlow AI API')
      .setDescription('Backend cho app GiftFlow AI - API v1')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'docs/openapi.json' });
  return doc;
}
