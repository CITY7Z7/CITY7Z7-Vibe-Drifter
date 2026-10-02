/**
 * @file kanban-module/src/storage/sqlite-adapter.ts
 * @description Реализация StorageAdapter на базе SQLite (better-sqlite3).
 *
 * Особенности:
 * - Все таблицы имеют префикс `kanban_` для предотвращения конфликтов с таблицами приложения-хозяина;
 * - Миграции идемпотентны (CREATE TABLE IF NOT EXISTS);
 * - Сохранение сложных полей (массивы, настройки, метаданные) в виде JSON-строк;
 * - Поддерживает как файловую базу данных, так и ':memory:' режим;
 * - Автоматически загружает 19 встроенных шаблонов из starter.json при первой инициализации.
 */

import Database from 'better-sqlite3';
import { StorageAdapter } from './types';
import { Board, BoardSettings, Task, ChatMessage, TaskTemplate } from '../core/types';
import starterTemplates from '../templates/starter.json';

export interface SQLiteAdapterOptions {
  filename?: string;
  readonly?: boolean;
}

export class SQLiteStorageAdapter implements StorageAdapter {
  private db: Database.Database | null = null;
  private filename: string;

  constructor(options: SQLiteAdapterOptions = {}) {
    this.filename = options.filename || ':memory:';
  }

  async init(): Promise<void> {
    if (!this.db) {
      this.db = new Database(this.filename);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
    }

    // 1. Метаданные модуля
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kanban_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 2. Доски
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kanban_boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        settings_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Создаем дефолтную доску, если досок еще нет
    const boardCountStmt = this.db.prepare('SELECT COUNT(*) as count FROM kanban_boards');
    const boardCount = (boardCountStmt.get() as { count: number }).count;
    if (boardCount === 0) {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO kanban_boards (id, name, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        'default',
        'Главная доска задач',
        JSON.stringify({
          maxParallel: 3,
          autoChain: true,
          recoverPolicy: 'fail',
          defaultExecutor: 'mock',
        }),
        now,
        now
      );
    }

    // 3. Задачи
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kanban_tasks (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        executor TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        labels_json TEXT NOT NULL,
        depends_on_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 1,
        timeout_ms INTEGER NOT NULL DEFAULT 30000,
        require_review INTEGER NOT NULL DEFAULT 0,
        result_json TEXT,
        error TEXT,
        log_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        meta_json TEXT NOT NULL,
        FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_kanban_tasks_board_id ON kanban_tasks(board_id);
      CREATE INDEX IF NOT EXISTS idx_kanban_tasks_status ON kanban_tasks(status);
    `);

    // 4. Шаблоны
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kanban_templates (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);

    // 5. История сообщений чата планировщика
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kanban_chat_messages (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        plan_preview_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_kanban_chat_board_id ON kanban_chat_messages(board_id);
    `);

    // Фиксация версии схемы
    const stmtMeta = this.db.prepare(
      `INSERT INTO kanban_meta (key, value) VALUES ('schema_version', '1.0.0') ON CONFLICT(key) DO UPDATE SET value = '1.0.0'`
    );
    stmtMeta.run();

    // Загрузка встроенных шаблонов, если таблица пуста
    const countTemplatesStmt = this.db.prepare('SELECT COUNT(*) as count FROM kanban_templates');
    const row = countTemplatesStmt.get() as { count: number };
    if (row.count === 0) {
      const insertTpl = this.db.prepare(`
        INSERT INTO kanban_templates (id, category, title, prompt, is_builtin, created_at)
        VALUES (@id, @category, @title, @prompt, 1, @created_at)
      `);
      const now = new Date().toISOString();
      const insertMany = this.db.transaction((items: typeof starterTemplates) => {
        for (const item of items) {
          insertTpl.run({
            id: String(item.id),
            category: item.category,
            title: item.title,
            prompt: item.prompt,
            created_at: now,
          });
        }
      });
      insertMany(starterTemplates as any);
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('SQLiteStorageAdapter не инициализирован. Вызовите await adapter.init() перед обращением к базе.');
    }
    return this.db;
  }

  // --- Доски ---

  async getBoard(id: string): Promise<Board | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM kanban_boards WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      settings: JSON.parse(row.settings_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listBoards(): Promise<Board[]> {
    const db = this.getDb();
    const rows = db.prepare('SELECT * FROM kanban_boards ORDER BY created_at DESC').all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      settings: JSON.parse(row.settings_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async createBoard(board: Board): Promise<Board> {
    const db = this.getDb();
    db.prepare(`
      INSERT INTO kanban_boards (id, name, settings_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      board.id,
      board.name,
      JSON.stringify(board.settings),
      board.createdAt,
      board.updatedAt
    );
    return board;
  }

  async updateBoard(
    id: string,
    updates: { name?: string; settings?: Partial<BoardSettings> }
  ): Promise<Board> {
    const db = this.getDb();
    const existing = await this.getBoard(id);
    if (!existing) {
      throw new Error(`Доска с id "${id}" не найдена.`);
    }

    const updated: Board = {
      ...existing,
      name: updates.name !== undefined ? updates.name : existing.name,
      settings: updates.settings !== undefined ? { ...existing.settings, ...updates.settings } : existing.settings,
      updatedAt: new Date().toISOString(),
    };

    db.prepare(`
      UPDATE kanban_boards
      SET name = ?, settings_json = ?, updated_at = ?
      WHERE id = ?
    `).run(updated.name, JSON.stringify(updated.settings), updated.updatedAt, id);

    return updated;
  }

  async deleteBoard(id: string): Promise<boolean> {
    const db = this.getDb();
    const res = db.prepare('DELETE FROM kanban_boards WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // --- Задачи ---

  private mapTaskFromDb(row: any): Task {
    return {
      id: row.id,
      boardId: row.board_id,
      title: row.title,
      prompt: row.prompt,
      status: row.status,
      executor: row.executor || undefined,
      priority: row.priority,
      labels: JSON.parse(row.labels_json || '[]'),
      dependsOn: JSON.parse(row.depends_on_json || '[]'),
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      timeoutMs: row.timeout_ms,
      requireReview: Boolean(row.require_review),
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      error: row.error || undefined,
      log: JSON.parse(row.log_json || '[]'),
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      finishedAt: row.finished_at || undefined,
      meta: JSON.parse(row.meta_json || '{}'),
    };
  }

  async getTask(id: string): Promise<Task | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapTaskFromDb(row);
  }

  async listTasks(boardId: string): Promise<Task[]> {
    const db = this.getDb();
    const rows = db.prepare('SELECT * FROM kanban_tasks WHERE board_id = ? ORDER BY priority DESC, created_at ASC').all(boardId) as any[];
    return rows.map((r) => this.mapTaskFromDb(r));
  }

  async createTask(task: Task): Promise<Task> {
    const db = this.getDb();
    db.prepare(`
      INSERT INTO kanban_tasks (
        id, board_id, title, prompt, status, executor, priority,
        labels_json, depends_on_json, attempts, max_attempts, timeout_ms,
        require_review, result_json, error, log_json, created_at,
        started_at, finished_at, meta_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `).run(
      task.id,
      task.boardId,
      task.title,
      task.prompt,
      task.status,
      task.executor || null,
      task.priority,
      JSON.stringify(task.labels),
      JSON.stringify(task.dependsOn),
      task.attempts,
      task.maxAttempts,
      task.timeoutMs,
      task.requireReview ? 1 : 0,
      task.result !== undefined ? JSON.stringify(task.result) : null,
      task.error || null,
      JSON.stringify(task.log),
      task.createdAt,
      task.startedAt || null,
      task.finishedAt || null,
      JSON.stringify(task.meta)
    );
    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const db = this.getDb();
    const existing = await this.getTask(id);
    if (!existing) {
      throw new Error(`Задача #${id} не найдена в хранилище.`);
    }

    const merged: Task = {
      ...existing,
      ...updates,
      labels: updates.labels !== undefined ? updates.labels : existing.labels,
      dependsOn: updates.dependsOn !== undefined ? updates.dependsOn : existing.dependsOn,
      log: updates.log !== undefined ? updates.log : existing.log,
      meta: updates.meta !== undefined ? updates.meta : existing.meta,
    };

    db.prepare(`
      UPDATE kanban_tasks SET
        title = ?,
        prompt = ?,
        status = ?,
        executor = ?,
        priority = ?,
        labels_json = ?,
        depends_on_json = ?,
        attempts = ?,
        max_attempts = ?,
        timeout_ms = ?,
        require_review = ?,
        result_json = ?,
        error = ?,
        log_json = ?,
        started_at = ?,
        finished_at = ?,
        meta_json = ?
      WHERE id = ?
    `).run(
      merged.title,
      merged.prompt,
      merged.status,
      merged.executor || null,
      merged.priority,
      JSON.stringify(merged.labels),
      JSON.stringify(merged.dependsOn),
      merged.attempts,
      merged.maxAttempts,
      merged.timeoutMs,
      merged.requireReview ? 1 : 0,
      merged.result !== undefined ? JSON.stringify(merged.result) : null,
      merged.error || null,
      JSON.stringify(merged.log),
      merged.startedAt || null,
      merged.finishedAt || null,
      JSON.stringify(merged.meta),
      id
    );

    return merged;
  }

  async deleteTask(id: string): Promise<boolean> {
    const db = this.getDb();
    const res = db.prepare('DELETE FROM kanban_tasks WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // --- Чат ---

  async listMessages(boardId: string): Promise<ChatMessage[]> {
    const db = this.getDb();
    const rows = db.prepare('SELECT * FROM kanban_chat_messages WHERE board_id = ? ORDER BY created_at ASC').all(boardId) as any[];
    return rows.map((r) => ({
      id: r.id,
      boardId: r.board_id,
      role: r.role,
      text: r.text,
      planPreview: r.plan_preview_json ? JSON.parse(r.plan_preview_json) : undefined,
      createdAt: r.created_at,
    }));
  }

  async addMessage(message: ChatMessage): Promise<ChatMessage> {
    const db = this.getDb();
    db.prepare(`
      INSERT INTO kanban_chat_messages (id, board_id, role, text, plan_preview_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.boardId,
      message.role,
      message.text,
      message.planPreview ? JSON.stringify(message.planPreview) : null,
      message.createdAt
    );
    return message;
  }

  // --- Шаблоны ---

  async listTemplates(): Promise<TaskTemplate[]> {
    const db = this.getDb();
    const rows = db.prepare('SELECT * FROM kanban_templates ORDER BY is_builtin DESC, created_at ASC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      prompt: r.prompt,
      isBuiltin: Boolean(r.is_builtin),
      createdAt: r.created_at,
    }));
  }

  async createTemplate(template: TaskTemplate): Promise<TaskTemplate> {
    const db = this.getDb();
    db.prepare(`
      INSERT INTO kanban_templates (id, category, title, prompt, is_builtin, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      template.id,
      template.category,
      template.title,
      template.prompt,
      template.isBuiltin ? 1 : 0,
      template.createdAt
    );
    return template;
  }
}
