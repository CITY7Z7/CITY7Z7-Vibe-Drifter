/**
 * @file kanban-module/src/core/events.ts
 * @description Типизированная шина событий для реактивного обновления UI и трансляции SSE.
 */

import { Task, Board } from './types';

export type KanbanEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.log'
  | 'board.updated'
  | 'scheduler.state';

export interface TaskLogEventData {
  boardId: string;
  taskId: string;
  line: string;
  timestamp: string;
}

export interface SchedulerStateEventData {
  boardId: string;
  isPaused: boolean;
  runningTaskIds: string[];
  maxParallel: number;
}

export interface KanbanEventMap {
  'task.created': { task: Task };
  'task.updated': { task: Task; previousStatus?: string };
  'task.deleted': { boardId: string; taskId: string };
  'task.log': TaskLogEventData;
  'board.updated': { board: Board };
  'scheduler.state': SchedulerStateEventData;
}

export type KanbanEventListener<T extends KanbanEventType> = (data: KanbanEventMap[T]) => void;

/**
 * Легковесный менеджер подписок на события Kanban.
 */
export class KanbanEventEmitter {
  private listeners: Map<KanbanEventType, Set<(data: any) => void>> = new Map();

  /**
   * Подписаться на конкретный тип события.
   */
  on<T extends KanbanEventType>(event: T, listener: KanbanEventListener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(listener);

    // Функция отписки
    return () => {
      set.delete(listener);
    };
  }

  /**
   * Опубликовать событие подписчикам.
   */
  emit<T extends KanbanEventType>(event: T, data: KanbanEventMap[T]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(data);
      } catch (err) {
        console.error(`[KanbanEventEmitter] Ошибка в обработчике события ${event}:`, err);
      }
    }
  }

  /**
   * Удалить всех слушателей.
   */
  clear(): void {
    this.listeners.clear();
  }
}
