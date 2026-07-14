import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createProxyMiddleware } from 'http-proxy-middleware';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { proxyRoutes } from './proxy.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Logging — jeder Request wird geloggt
  app.use(morgan('short'));

  // Rate Limiting — max 100 Requests pro Minute pro IP
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 100,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests, try again later' },
    }),
  );

  // Proxy — Requests an Services weiterleiten
  for (const route of proxyRoutes) {
    app.use(
      route.path,
      createProxyMiddleware({
        target: route.target,
        changeOrigin: true,
      }),
    );
  }

  await app.listen(3000);
  console.log('API Gateway running on http://localhost:3000');
  for (const route of proxyRoutes) {
    console.log(`  ${route.path} → ${route.target}`);
  }
}

bootstrap();
