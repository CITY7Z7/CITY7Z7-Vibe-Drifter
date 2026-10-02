/**
 * @file kanban-module/src/storage/memory-adapter.ts
 * @description In-memory реализация StorageAdapter для быстрых изолированных тестов.
 */

import { StorageAdapter } from './types';
import { Board, BoardSettings, Task, ChatMessage, TaskTemplate } from '../core/types';
import starterTemplates from '../templates/starter.json';

export class MemoryStorageAdapter implements StorageAdapter {
  private boards = new Map<string, Board>();
  private tasks = new Map<string, Task>();
  private messages = new Map<string, ChatMessage>();
  private templates = new Map<string, TaskTemplate>();

  async init(): Promise<void> {
    // Заполняем шаблонами из starter.json
    const now = new Date().toISOString();
    for (const item of starterTemplates) {
      this.templates.set(String(item.id), {
        id: String(item.id),
        category: item.category as any,
        title: item.title,
        prompt: item.prompt,
        isBuiltin: true,
        createdAt: now,
      });
    }
  }

  async close(): Promise<void> {
    this.boards.clear();
    this.tasks.clear();
    this.messages.clear();
    this.templates.clear();
  }

  // --- Boards ---
  async getBoard(id: string): Promise<Board | null> {
    const b = this.boards.get(id);
    return b ? JSON.parse(JSON.stringify(b)) : null;
  }

  async listBoards(): Promise<Board[]> {
    return Array.from(this.boards.values()).map((b) => JSON.parse(JSON.stringify(b)));
  }

  async createBoard(board: Board): Promise<Board> {
    this.boards.set(board.id, JSON.parse(JSON.stringify(board)));
    return board;
  }

  async updateBoard(
    id: string,
    updates: { name?: string; settings?: Partial<BoardSettings> }
  ): Promise<Board> {
    const existing = this.boards.get(id);
    if (!existing) throw new Error(`Доска #${id} не найдена.`);
    const updated: Board = {
      ...existing,
      name: updates.name !== undefined ? updates.name : existing.name,
      settings: updates.settings !== undefined ? { ...existing.settings, ...updates.settings } : existing.settings,
      updatedAt: new Date().toISOString(),
    };
    this.boards.set(id, JSON.parse(JSON.stringify(updated)));
    return updated;
  }

  async deleteBoard(id: string): Promise<boolean> {
    const exists = this.boards.has(id);
    if (exists) {
      this.boards.delete(id);
      // Удаляем связанные задачи
      for (const [tId, t] of this.tasks.entries()) {
        if (t.boardId === id) this.tasks.delete(tId);
      }
      // Удаляем связанные сообщения
      for (const [mId, m] of this.messages.entries()) {
        if (m.boardId === id) this.messages.delete(mId);
      }
    }
    return exists;
  }

  // --- Tasks ---
  async getTask(id: string): Promise<Task | null> {
    const t = this.tasks.get(id);
    return t ? JSON.parse(JSON.stringify(t)) : null;
  }

  async listTasks(boardId: string): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.boardId === boardId)
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
      .map((t) => JSON.parse(JSON.stringify(t)));
  }

  async createTask(task: Task): Promise<Task> {
    this.tasks.set(task.id, JSON.parse(JSON.stringify(task)));
    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing) throw new Error(`Задача #${id} не найдена.`);
    const merged: Task = {
      ...existing,
      ...updates,
      labels: updates.labels ? [...updates.labels] : existing.labels,
      dependsOn: updates.dependsOn ? [...updates.dependsOn] : existing.dependsOn,
      log: updates.log ? [...updates.log] : existing.log,
      meta: updates.meta ? { ...existing.meta, ...updates.meta } : existing.meta,
    };
    this.tasks.set(id, JSON.parse(JSON.stringify(merged)));
    return merged;
  }

  async deleteTask(id: string): Promise<boolean> {
    return this.tasks.delete(id);
  }

  // --- Messages ---
  async listMessages(boardId: string): Promise<ChatMessage[]> {
    return Array.from(this.messages.values())
      .filter((m) => m.boardId === boardId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((m) => JSON.parse(JSON.stringify(m)));
  }

  async addMessage(message: ChatMessage): Promise<ChatMessage> {
    this.messages.set(message.id, JSON.parse(JSON.stringify(message)));
    return message;
  }

  // --- Templates ---
  async listTemplates(): Promise<TaskTemplate[]> {
    return Array.from(this.templates.values()).map((t) => JSON.parse(JSON.stringify(t)));
  }

  async createTemplate(template: TaskTemplate): Promise<TaskTemplate> {
    this.templates.set(template.id, JSON.parse(JSON.stringify(template)));
    return template;
  }
}
