/**
 * @file kanban-module/tests/storage/storage.test.ts
 * @description Тестирование адаптеров хранения данных (SQLiteStorageAdapter и MemoryStorageAdapter).
 *
 * Проверяет:
 * - Изоляцию таблиц: обязательный префикс `kanban_*`;
 * - Идемпотентность повторной инициализации init();
 * - CRUD-операции над досками, задачами, сообщениями чата и шаблонами;
 * - Автозагрузку 19 встроенных шаблонов.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageAdapter } from '../../src/storage/sqlite-adapter';
import { MemoryStorageAdapter } from '../../src/storage/memory-adapter';
import Database from 'better-sqlite3';

describe('Storage Adapters: SQLite и Memory', () => {
  describe('SQLiteStorageAdapter', () => {
    let adapter: SQLiteStorageAdapter;

    beforeEach(async () => {
      // Запуск в in-memory режиме SQLite
      adapter = new SQLiteStorageAdapter({ filename: ':memory:' });
      await adapter.init();
    });

    afterEach(async () => {
      await adapter.close();
    });

    it('создает таблицы исключительно с префиксом kanban_*', () => {
      // Проверяем список таблиц в SQLite master
      const db = (adapter as any).getDb() as Database.Database;
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];

      expect(tables.length).toBeGreaterThan(0);
      for (const t of tables) {
        expect(t.name.startsWith('kanban_')).toBe(true);
      }
    });

    it('повторный вызов init() идемпотентен и не ломает существующие данные', async () => {
      const board = await adapter.createBoard({
        id: 'b1',
        name: 'Persistent Board',
        settings: { maxParallel: 4, autoChain: true, recoverPolicy: 'fail' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Повторный init()
      await adapter.init();

      const fetched = await adapter.getBoard('b1');
      expect(fetched?.name).toBe('Persistent Board');
    });

    it('автоматически наполняет таблицу шаблонов 19 встроенными шаблонами', async () => {
      const templates = await adapter.listTemplates();
      expect(templates.length).toBe(19);
      expect(templates.every((t) => t.isBuiltin)).toBe(true);
    });

    it('выполняет полный CRUD для сущности Task', async () => {
      await adapter.createBoard({
        id: 'board-crud',
        name: 'CRUD Board',
        settings: { maxParallel: 3, autoChain: true, recoverPolicy: 'fail' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const task = await adapter.createTask({
        id: 'task-1',
        boardId: 'board-crud',
        title: 'Initial Title',
        prompt: 'Initial Prompt',
        status: 'backlog',
        priority: 1,
        labels: ['feature', 'backend'],
        dependsOn: [],
        attempts: 0,
        maxAttempts: 2,
        timeoutMs: 15000,
        requireReview: false,
        log: ['created'],
        createdAt: new Date().toISOString(),
        meta: { testKey: 'val' },
      });

      expect(task.title).toBe('Initial Title');

      // Update
      const updated = await adapter.updateTask('task-1', {
        title: 'Updated Title',
        status: 'ready',
        log: ['created', 'updated to ready'],
      });
      expect(updated.title).toBe('Updated Title');
      expect(updated.status).toBe('ready');
      expect(updated.log.length).toBe(2);

      // List
      const list = await adapter.listTasks('board-crud');
      expect(list.length).toBe(1);

      // Delete
      const deleted = await adapter.deleteTask('task-1');
      expect(deleted).toBe(true);
      const afterDel = await adapter.getTask('task-1');
      expect(afterDel).toBeNull();
    });
  });

  describe('MemoryStorageAdapter', () => {
    let memAdapter: MemoryStorageAdapter;

    beforeEach(async () => {
      memAdapter = new MemoryStorageAdapter();
      await memAdapter.init();
    });

    it('корректно хранит сообщения чата', async () => {
      await memAdapter.addMessage({
        id: 'm1',
        boardId: 'b-mem',
        role: 'user',
        text: 'Hello planner',
        createdAt: new Date().toISOString(),
      });

      const msgs = await memAdapter.listMessages('b-mem');
      expect(msgs.length).toBe(1);
      expect(msgs[0].text).toBe('Hello planner');
    });
  });
});
