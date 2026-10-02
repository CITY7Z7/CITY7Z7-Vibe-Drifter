/**
 * @file server.ts
 * @description Главный HTTP-сервер full-stack приложения.
 *
 * Запускает Express на порту 3000:
 * - Инициализирует модуль Kanban-оркестратора задач;
 * - Монтирует роутер модуля по пути /api/kanban;
 * - В dev-режиме подключает Vite middlewares;
 * - В production раздает статические файлы из /dist.
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createKanban } from './kanban-module/src/index';
import { MockExecutor } from './kanban-module/src/executors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. Инициализация Kanban-модуля
  const kanban = createKanban({
    sqlitePath: path.resolve(__dirname, 'kanban-data.db'),
    executors: [
      new MockExecutor({
        id: 'mock',
        defaultDelayMs: 600,
      }),
    ],
  });

  await kanban.init();

  // 2. Монтирование API модуля
  app.use('/api/kanban', kanban.router);

  // 3. Подключение Vite middlewares (dev) или статики (prod)
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Kanban Server] Запущен на http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Kanban Server] Ошибка запуска сервера:', err);
  process.exit(1);
});
