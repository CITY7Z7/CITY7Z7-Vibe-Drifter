/**
 * @file kanban-module/src/core/types.ts
 * @description Основные типы доменной модели Kanban-оркестратора задач.
 *
 * Архитектура ядра спроектирована как чистый TypeScript без привязки к фреймворкам
 * (React, Express, внешние СУБД). Это обеспечивает легкую инъекцию логики
 * в любой сторонний проект согласно INTEGRATION.md.
 */

/**
 * Допустимые статусы жизненного цикла задачи.
 *
 * - `backlog`: Задача создана, не готова к выполнению (находится в очереди планирования).
 * - `ready`: Задача активирована (запущена) пользователем или цепочкой, ожидает завершения зависимостей и свободного слота шедулера.
 * - `in_progress`: Задача передана зарегистрированному исполнителю (TaskExecutor) и в данный момент исполняется.
 * - `review`: Выполнение завершено успешно, но задача требует явного ручного подтверждения (requireReview = true).
 * - `done`: Задача успешно завершена, результаты зафиксированы, разблокирует зависимые задачи.
 * - `failed`: Выполнение задачи завершилось ошибкой, таймаутом или отменой пользователем.
 * - `blocked`: Задача не может быть запущена, так как одна из ее прямых или косвенных зависимостей завершилась ошибкой.
 */
export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'failed'
  | 'blocked';

/**
 * Политика восстановления задач после перезапуска процесса/сервера:
 * - `fail`: задачи в статусе `in_progress` переводятся в `failed` с ошибкой 'interrupted' (безопасно для идемпотентных операций).
 * - `requeue`: задачи в статусе `in_progress` возвращаются в статус `ready` для повторного запуска.
 */
export type RecoverPolicy = 'fail' | 'requeue';

/**
 * Настройки конфигурации доски задач.
 */
export interface BoardSettings {
  /** Максимальное количество одновременно выполняемых задач (по умолчанию 3) */
  maxParallel: number;
  /** Автоматический перевод зависимых задач в статус ready при запуске цепочки (по умолчанию true) */
  autoChain: boolean;
  /** Политика восстановления задач при перезапуске сервера (по умолчанию 'fail') */
  recoverPolicy: RecoverPolicy;
  /** Идентификатор исполнителя по умолчанию для задач без явно указанного executor */
  defaultExecutor?: string;
}

/**
 * Модель канбан-доски (Board).
 */
export interface Board {
  id: string;
  name: string;
  settings: BoardSettings;
  createdAt: string;
  updatedAt: string;
}

/**
 * Модель задачи оркестратора (Task).
 */
export interface Task {
  /** Уникальный идентификатор задачи */
  id: string;
  /** Идентификатор доски, к которой относится задача */
  boardId: string;
  /** Краткий заголовок задачи для отображения на карточке */
  title: string;
  /** Инструкция или промпт для исполнителя задачи */
  prompt: string;
  /** Текущий статус задачи */
  status: TaskStatus;
  /** Ключ исполнителя (например, 'mock', 'http', 'shell'), если не указан — берется defaultExecutor доски */
  executor?: string;
  /** Приоритет выполнения (чем выше число, тем раньше шедулер берет задачу при равных условиях) */
  priority: number;
  /** Метки/теги для фильтрации и категоризации */
  labels: string[];
  /** Идентификаторы задач, от завершения (статуса done) которых зависит данная задача (A -> B: B зависит от A) */
  dependsOn: string[];
  /** Количество совершенных попыток выполнения */
  attempts: number;
  /** Максимально разрешенное количество попыток (по умолчанию 1) */
  maxAttempts: number;
  /** Таймаут выполнения задачи в миллисекундах (по умолчанию 30000 = 30с) */
  timeoutMs: number;
  /** Требуется ли ручной аппрув перед переходом в статус done */
  requireReview: boolean;
  /** Результат успешного выполнения задачи (JSON-сериализуемый объект) */
  result?: unknown;
  /** Текст ошибки или причина отмены/сбоя */
  error?: string;
  /** Хронологический журнал событий и логов выполнения задачи */
  log: string[];
  /** Дата и время создания (ISO-строка) */
  createdAt: string;
  /** Дата и время фактического запуска исполнителем (ISO-строка) */
  startedAt?: string;
  /** Дата и время завершения (ISO-строка) */
  finishedAt?: string;
  /** Произвольные метаданные для нужд приложения-хозяина */
  meta: Record<string, unknown>;
}

/**
 * Контекст выполнения, передаваемый исполнителю (TaskExecutor.run).
 */
export interface ExecutionContext {
  /** Сигнал отмены для прерывания долгих асинхронных операций */
  signal: AbortSignal;
  /** Метод для добавления строки в журнал задачи */
  log: (msg: string) => void;
  /** Карта результатов зависимых задач: taskId -> { output: unknown } */
  deps: Record<string, { output: unknown }>;
  /** Метод для передачи процента прогресса (0-100) */
  progress: (pct: number) => void;
}

/**
 * Результат, возвращаемый исполнителем задачи.
 */
export interface ExecutionResult {
  /** Успешность выполнения */
  ok: boolean;
  /** Выходные данные / артефакт выполнения */
  output?: unknown;
  /** Описание ошибки в случае сбоя */
  error?: string;
  /** Флаг, запрашивающий ручной пересмотр результата (перевод в review) */
  needsReview?: boolean;
}

/**
 * Интерфейс исполнителя задачи (TaskExecutor).
 */
export interface TaskExecutor {
  /** Уникальный идентификатор типа исполнителя ('mock', 'http', 'shell' и др.) */
  readonly id: string;
  /**
   * Выполняет переданную задачу с заданным контекстом.
   * @param task Объект задачи
   * @param ctx Контекст исполнения (сигнал отмены, логгирование, входные данные зависимостей)
   */
  run(task: Task, ctx: ExecutionContext): Promise<ExecutionResult>;
}

/**
 * Структура связи между задачами в графе (from -> to означает to зависит от from).
 */
export interface TaskLink {
  from: string;
  to: string;
}

/**
 * Превью плана декомпозиции цели, сгенерированное планировщиком (парсер или LLM).
 */
export interface PlanPreview {
  /** Список разобранных задач */
  tasks: Array<{
    id: string; // Номер или временный ID (например "1", "2")
    title: string;
    prompt: string;
    labels?: string[];
  }>;
  /** Список направленных ребер графа (от родителя к потомку) */
  links: Array<{
    from: string;
    to: string;
  }>;
  /** Список идентификаторов задач, которые должны быть запущены сразу */
  start: string[];
  /** Предупреждения (например: обнаружен цикл, неизвестный номер задачи) */
  warnings: string[];
}

/**
 * Запись сообщения в чате планировщика.
 */
export interface ChatMessage {
  id: string;
  boardId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  planPreview?: PlanPreview;
  createdAt: string;
}

/**
 * Шаблон для быстрого создания графа задач.
 */
export interface TaskTemplate {
  id: string;
  category: 'greenfield' | 'modernization' | 'testing' | 'features' | 'devops' | 'custom';
  title: string;
  prompt: string;
  isBuiltin?: boolean;
  createdAt: string;
}
