/**
 * @file kanban-module/src/index.ts
 * @description Главная точка входа эталонной реализации Kanban-оркестратора задач.
 *
 * Предоставляет функцию `createKanban(config)` для быстрой инициализации оркестратора
 * с готовым Express Router, Scheduler, хранилищем, шиной событий и планировщиком.
 */

import { StorageAdapter } from './storage/types';
import { SQLiteStorageAdapter } from './storage/sqlite-adapter';
import { ExecutorRegistry } from './executors/registry';
import { TaskExecutor } from './core/types';
import { Scheduler } from './core/scheduler';
import { KanbanEventEmitter } from './core/events';
import { UnifiedPlanner } from './planner/planner';
import { PlannerAdapter } from './planner/types';
import { createKanbanRouter, KanbanRouterOptions } from './server/router';
import { Router } from 'express';

export interface CreateKanbanConfig {
  /** Пользовательский адаптер хранилища (по умолчанию SQLiteStorageAdapter(':memory:')) */
  storage?: StorageAdapter;
  /** Пользовательский путь к базе SQLite (если storage не указан явно) */
  sqlitePath?: string;
  /** Пользовательские исполнители задач */
  executors?: TaskExecutor[];
  /** Пользовательский LLM-адаптер для разбора свободных целей */
  plannerAdapter?: PlannerAdapter;
  /** Опции для Express Router (auth middleware, apiBase) */
  routerOptions?: KanbanRouterOptions;
}

export interface KanbanModuleInstance {
  storage: StorageAdapter;
  executors: ExecutorRegistry;
  scheduler: Scheduler;
  events: KanbanEventEmitter;
  planner: UnifiedPlanner;
  router: Router;
  init: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Фабрика инициализации модуля Kanban-оркестратора.
 */
export function createKanban(config: CreateKanbanConfig = {}): KanbanModuleInstance {
  // 1. Инициализация шины событий
  const events = new KanbanEventEmitter();

  // 2. Инициализация хранилища (по умолчанию SQLite)
  const storage =
    config.storage ||
    new SQLiteStorageAdapter({
      filename: config.sqlitePath || ':memory:',
    });

  // 3. Инициализация реестра исполнителей
  const executors = new ExecutorRegistry(config.executors || []);

  // 4. Инициализация шедулера
  const scheduler = new Scheduler({
    storage,
    executors,
    events,
  });

  // 5. Инициализация планировщика
  const planner = new UnifiedPlanner(config.plannerAdapter);

  const systemInstance = {
    storage,
    executors,
    scheduler,
    events,
    planner,
  };

  // 6. Создание Express Router
  const router = createKanbanRouter(systemInstance, config.routerOptions);

  return {
    storage,
    executors,
    scheduler,
    events,
    planner,
    router,
    async init() {
      await storage.init();
      await scheduler.recover();
    },
    async close() {
      await storage.close();
      events.clear();
    },
  };
}

// Экспорт всех подсистем для модульного использования
export * from './core';
export * from './storage';
export * from './executors';
export * from './planner';
export * from './server';
export * from './templates';
