/**
 * @file demo/server.ts
 * @description Серверная часть демо-песочницы.
 *
 * Демонстрирует, как host-приложение подключает модуль:
 * 1. Вызывает createKanban({ ... })
 * 2. Инициализирует модуль await kanban.init()
 * 3. Монтирует роутер app.use('/api/kanban', kanban.router)
 */

import express from 'express';
import { createKanban } from '../kanban-module/src/index';
import { MockExecutor } from '../kanban-module/src/executors';
import path from 'path';

export async function createDemoServer() {
  const app = express();
  app.use(express.json());

  // Настройка Kanban-модуля
  const kanban = createKanban({
    sqlitePath: path.resolve(process.cwd(), 'kanban-demo.db'),
    executors: [
      new MockExecutor({
        id: 'mock',
        defaultDelayMs: 600, // 600ms для комфортной наглядности в UI
      }),
    ],
  });

  await kanban.init();

  // Монтирование роутера в приложение
  app.use('/api/kanban', kanban.router);

  return { app, kanban };
}
