/**
 * @file kanban-module/src/planner/types.ts
 * @description Интерфейсы адаптера планировщика задач (PlannerAdapter).
 */

import { PlanPreview, Task } from '../core/types';

export interface PlannerContext {
  boardId?: string;
  existingTasks?: Task[];
}

export interface PlannerAdapter {
  /**
   * Декомпозирует произвольную пользовательскую цель в граф связанных задач.
   * @param goal Свободный текст цели
   * @param context Контекст (текущая доска, существующие задачи)
   */
  decompose(goal: string, context?: PlannerContext): Promise<PlanPreview>;
}
