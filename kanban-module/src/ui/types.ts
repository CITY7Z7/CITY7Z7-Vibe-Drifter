/**
 * @file kanban-module/src/ui/types.ts
 * @description Вспомогательные типы данных для UI-компонентов Kanban.
 */

import { Task, Board, TaskTemplate, PlanPreview, ChatMessage } from '../core/types';
import { Locale } from './i18n';

export type ActiveTab = 'board' | 'graph';
export type ThemeMode = 'dark' | 'light';

export interface KanbanBoardProps {
  /** Базовый URL для REST API (по умолчанию '/api/kanban') */
  apiBase?: string;
  /** Начальный язык интерфейса (по умолчанию 'ru') */
  initialLocale?: Locale;
  /** Начальная тема оформления (по умолчанию 'dark') */
  initialTheme?: ThemeMode;
  /** Пользовательский заголовок в шапке (опционально) */
  customTitle?: string;
  /** Дополнительный CSS-класс для корневого контейнера */
  className?: string;
}

export interface DragItem {
  taskId: string;
  sourceStatus: string;
}
