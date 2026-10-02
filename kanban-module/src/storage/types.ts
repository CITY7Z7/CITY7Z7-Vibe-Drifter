/**
 * @file kanban-module/src/storage/types.ts
 * @description Интерфейс адаптера хранилища (StorageAdapter).
 *
 * Абстрагирует сохранение состояния досок, задач, чата и шаблонов.
 * Позволяет хост-приложению использовать любую СУБД (SQLite, PostgreSQL, MySQL и др.)
 * или in-memory хранилище для тестов.
 */

import { Board, BoardSettings, Task, ChatMessage, TaskTemplate } from '../core/types';

export interface StorageAdapter {
  /**
   * Инициализация хранилища (создание таблиц/схем при необходимости).
   */
  init(): Promise<void>;

  /**
   * Закрытие соединения с хранилищем.
   */
  close(): Promise<void>;

  // --- Доски (Boards) ---
  getBoard(id: string): Promise<Board | null>;
  listBoards(): Promise<Board[]>;
  createBoard(board: Board): Promise<Board>;
  updateBoard(id: string, updates: { name?: string; settings?: Partial<BoardSettings> }): Promise<Board>;
  deleteBoard(id: string): Promise<boolean>;

  // --- Задачи (Tasks) ---
  getTask(id: string): Promise<Task | null>;
  listTasks(boardId: string): Promise<Task[]>;
  createTask(task: Task): Promise<Task>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task>;
  deleteTask(id: string): Promise<boolean>;

  // --- Сообщения чата планировщика ---
  listMessages(boardId: string): Promise<ChatMessage[]>;
  addMessage(message: ChatMessage): Promise<ChatMessage>;

  // --- Шаблоны (Templates) ---
  listTemplates(): Promise<TaskTemplate[]>;
  createTemplate(template: TaskTemplate): Promise<TaskTemplate>;
}
