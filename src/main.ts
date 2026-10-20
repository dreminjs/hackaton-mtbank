import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app/app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { Express } from 'express';

const server: Express = express();
let isInitialized = false;

async function bootstrap() {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(server),
  );

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: '*',
  });

  const config = new DocumentBuilder()
    .setTitle('MTBank Junior API')
    .setDescription('Документация API для семейного банкинга МТБанк')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  app.getHttpAdapter().get('/api/swagger.json', (req: any, res: any) => {
    res.json(documentFactory());
  });

  SwaggerModule.setup('api', app, documentFactory, {
    customCssUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui-bundle.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2/swagger-ui-standalone-preset.js',
    ],
  });

  if (!process.env.VERCEL) {
    const port = process.env.PORT || 3000;
    await app.listen(port);
  } else {
    await app.init();
  }

  isInitialized = true;
  return app;
}

if (!process.env.VERCEL) {
  bootstrap();
}

export default async function handler(req: any, res: any) {
  if (!isInitialized) {
    await bootstrap();
  }
  return server(req, res);
}
