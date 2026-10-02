/**
 * @file kanban-module/src/core/scheduler.ts
 * @description Ядро шедулера и оркестратора задач (Scheduler).
 *
 * Отвечает за:
 * - Вычисление готовности задач к выполнению (все зависимости в статусе 'done');
 * - Параллельное выполнение задач с ограничением maxParallel;
 * - Автоматический запуск последующих задач по цепочке при завершении задачи (autoChain);
 * - Управление жизненным циклом (Start, Cancel, Retry, Approve, Reject);
 * - Каскадную блокировку зависимых задач при сбое (статус 'blocked') и их разблокировку при Retry;
 * - Восстановление состояния после перезапуска (recoverPolicy: 'fail' | 'requeue');
 * - Глобальную паузу / возобновление шедулера;
 * - Поставку контекста исполнения (AbortSignal, log, deps, progress).
 */

import {
  Task,
  TaskStatus,
  Board,
  ExecutionContext,
  ExecutionResult,
} from './types';
import { StorageAdapter } from '../storage/types';
import { ExecutorRegistry } from '../executors/registry';
import { KanbanEventEmitter } from './events';
import { getDescendants, getAncestors } from './graph';

export interface SchedulerOptions {
  storage: StorageAdapter;
  executors: ExecutorRegistry;
  events: KanbanEventEmitter;
}

export class Scheduler {
  private storage: StorageAdapter;
  private executors: ExecutorRegistry;
  private events: KanbanEventEmitter;

  /** Флаг паузы шедулера (если true — новые задачи не стартуют) */
  private isPaused = false;

  /** Активные контроллеры отмены запущенных задач: taskId -> AbortController */
  private runningControllers = new Map<string, AbortController>();

  /** Идентификаторы задач, которые в текущий момент исполняются: taskId -> Task */
  private runningTasks = new Map<string, Task>();

  /** Защита от гонок при вычислении тиков шедулера */
  private isTicking = false;
  private pendingTickRequested = false;

  constructor(options: SchedulerOptions) {
    this.storage = options.storage;
    this.executors = options.executors;
    this.events = options.events;
  }

  /**
   * Восстановление состояния при старте сервиса.
   * Обрабатывает зависшие задачи 'in_progress' согласно политике recoverPolicy доски.
   */
  async recover(): Promise<void> {
    const boards = await this.storage.listBoards();
    for (const board of boards) {
      const tasks = await this.storage.listTasks(board.id);
      const policy = board.settings.recoverPolicy || 'fail';

      for (const task of tasks) {
        if (task.status === 'in_progress') {
          if (policy === 'fail') {
            await this.storage.updateTask(task.id, {
              status: 'failed',
              error: 'interrupted (сервер был перезапущен во время выполнения задачи)',
              finishedAt: new Date().toISOString(),
              log: [...task.log, `[Scheduler] Процесс прерван перезапуском сервера (recoverPolicy: fail).`],
            });
            // Каскадно блокируем потомков
            await this.cascadeBlockDescendants(task.id, board.id);
          } else {
            // requeue: возвращаем в ready
            await this.storage.updateTask(task.id, {
              status: 'ready',
              log: [...task.log, `[Scheduler] Задача возвращена в очередь ready после перезапуска (recoverPolicy: requeue).`],
            });
          }
        }
      }
    }
  }

  /**
   * Поставить шедулер на паузу.
   * Уже запущенные задачи продолжают выполняться, новые не берутся в работу.
   */
  pause(): void {
    this.isPaused = true;
    this.broadcastSchedulerState();
  }

  /**
   * Снять шедулер с паузы и запустить очередной цикл проверки очереди.
   */
  resume(): void {
    this.isPaused = false;
    this.broadcastSchedulerState();
    this.tick();
  }

  /**
   * Проверить состояние паузы.
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Получить список идентификаторов выполняющихся в данный момент задач.
   */
  getRunningTaskIds(): string[] {
    return Array.from(this.runningTasks.keys());
  }

  /**
   * Оповестить подписчиков о текущем состоянии шедулера.
   */
  private broadcastSchedulerState(boardId = 'default'): void {
    this.events.emit('scheduler.state', {
      boardId,
      isPaused: this.isPaused,
      runningTaskIds: this.getRunningTaskIds(),
      maxParallel: 3,
    });
  }

  /**
   * Запуск задачи пользователем (Start).
   *
   * Переводит саму задачу из backlog в ready.
   * Если autoChain = true, также переводит всех ее потомков из backlog в ready.
   * Если у цепочки есть предшественники в backlog, задача честно ждет их и UI показывает это.
   */
  async startTask(taskId: string): Promise<Task> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Задача #${taskId} не найдена.`);
    }

    const board = await this.storage.getBoard(task.boardId);
    if (!board) {
      throw new Error(`Доска задачи #${task.boardId} не найдена.`);
    }

    const allTasks = await this.storage.listTasks(board.id);

    // Переводим саму задачу в ready (если она в backlog)
    let updatedTask = task;
    if (task.status === 'backlog') {
      updatedTask = await this.storage.updateTask(task.id, {
        status: 'ready',
        log: [...task.log, `[Scheduler] Задача переведена в статус ready (запущена).`],
      });
      this.events.emit('task.updated', { task: updatedTask, previousStatus: 'backlog' });
    }

    // Если включен autoChain, переводим потомков из backlog в ready
    if (board.settings.autoChain) {
      const descendants = getDescendants(taskId, allTasks);
      for (const desc of descendants) {
        if (desc.status === 'backlog') {
          const uDesc = await this.storage.updateTask(desc.id, {
            status: 'ready',
            log: [...desc.log, `[Scheduler] Авто-цепочка: задача переведена в статус ready вслед за #${taskId}.`],
          });
          this.events.emit('task.updated', { task: uDesc, previousStatus: 'backlog' });
        }
      }
    }

    // Запускаем шедулер для взятия задач в работу
    this.tick();

    return updatedTask;
  }

  /**
   * Отмена задачи (Cancel).
   *
   * Если задача in_progress — посылает AbortSignal исполнителю,
   * переводит в failed (cancelled) и блокирует потомков.
   */
  async cancelTask(taskId: string): Promise<Task> {
    const task = await this.storage.getTask(taskId);
    if (!task) throw new Error(`Задача #${taskId} не найдена.`);

    // Если задача исполняется прямо сейчас, посылаем сигнал отмены
    const controller = this.runningControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.runningControllers.delete(taskId);
    }
    this.runningTasks.delete(taskId);

    const updated = await this.storage.updateTask(taskId, {
      status: 'failed',
      error: 'cancelled (отменено пользователем)',
      finishedAt: new Date().toISOString(),
      log: [...task.log, `[Scheduler] Задача отменена пользователем.`],
    });

    this.events.emit('task.updated', { task: updated, previousStatus: task.status });

    // Каскадно блокируем потомков
    await this.cascadeBlockDescendants(taskId, task.boardId);

    // Запускаем пересчет очереди
    this.tick();

    return updated;
  }

  /**
   * Повторный запуск упавшей задачи (Retry).
   *
   * Переводит задачу в ready, сбрасывает ошибку,
   * а всех заблокированных потомков (blocked) возвращает в ready!
   */
  async retryTask(taskId: string): Promise<Task> {
    const task = await this.storage.getTask(taskId);
    if (!task) throw new Error(`Задача #${taskId} не найдена.`);

    const allTasks = await this.storage.listTasks(task.boardId);

    const updated = await this.storage.updateTask(taskId, {
      status: 'ready',
      error: undefined,
      attempts: 0,
      log: [...task.log, `[Scheduler] Повторный запуск задачи (Retry).`],
    });

    this.events.emit('task.updated', { task: updated, previousStatus: task.status });

    // Разблокируем заблокированных потомков: переводим blocked -> ready
    const descendants = getDescendants(taskId, allTasks);
    for (const desc of descendants) {
      if (desc.status === 'blocked') {
        const uDesc = await this.storage.updateTask(desc.id, {
          status: 'ready',
          error: undefined,
          log: [...desc.log, `[Scheduler] Задача разблокирована после перезапуска предка #${taskId}.`],
        });
        this.events.emit('task.updated', { task: uDesc, previousStatus: 'blocked' });
      }
    }

    this.tick();
    return updated;
  }

  /**
   * Подтверждение ручного ревью (Approve).
   *
   * Переводит задачу из review в done и запускает зависимые задачи.
   */
  async approveTask(taskId: string): Promise<Task> {
    const task = await this.storage.getTask(taskId);
    if (!task) throw new Error(`Задача #${taskId} не найдена.`);

    if (task.status !== 'review') {
      throw new Error(`Задача #${taskId} не находится в статусе review.`);
    }

    const updated = await this.storage.updateTask(taskId, {
      status: 'done',
      finishedAt: new Date().toISOString(),
      log: [...task.log, `[Scheduler] Ручной пересмотр пройден: задача одобрена (Approved).`],
    });

    this.events.emit('task.updated', { task: updated, previousStatus: 'review' });

    // Запускаем зависимые задачи
    this.tick();

    return updated;
  }

  /**
   * Отклонение ручного ревью / возврат на доработку (Reject).
   *
   * Переводит задачу из review обратно в ready с комментарием.
   */
  async rejectTask(taskId: string, comment = 'Требуется доработка'): Promise<Task> {
    const task = await this.storage.getTask(taskId);
    if (!task) throw new Error(`Задача #${taskId} не найдена.`);

    if (task.status !== 'review') {
      throw new Error(`Задача #${taskId} не находится в статусе review.`);
    }

    const updated = await this.storage.updateTask(taskId, {
      status: 'ready',
      log: [...task.log, `[Scheduler] Задача возвращена на доработку. Причина: ${comment}`],
    });

    this.events.emit('task.updated', { task: updated, previousStatus: 'review' });

    this.tick();
    return updated;
  }

  /**
   * Каскадный перевод потомков упавшей задачи в статус 'blocked'.
   */
  private async cascadeBlockDescendants(failedTaskId: string, boardId: string): Promise<void> {
    const allTasks = await this.storage.listTasks(boardId);
    const descendants = getDescendants(failedTaskId, allTasks);

    for (const desc of descendants) {
      if (desc.status === 'ready' || desc.status === 'backlog') {
        const uDesc = await this.storage.updateTask(desc.id, {
          status: 'blocked',
          error: `Заблокирована из-за сбоя в зависимой задаче #${failedTaskId}`,
          log: [...desc.log, `[Scheduler] Задача заблокирована из-за сбоя в #${failedTaskId}.`],
        });
        this.events.emit('task.updated', { task: uDesc, previousStatus: desc.status });
      }
    }
  }

  /**
   * Главный цикл шедулера (Tick).
   *
   * Проверяет очередь готовых задач для всех досок,
   * фильтрует по готовности зависимостей, сортирует по приоритету и запускает исполнителей.
   */
  tick(): void {
    if (this.isTicking) {
      this.pendingTickRequested = true;
      return;
    }

    this.isTicking = true;
    this.executeTick()
      .catch((err) => {
        console.error('[Scheduler] Критическая ошибка в tick:', err);
      })
      .finally(() => {
        this.isTicking = false;
        if (this.pendingTickRequested) {
          this.pendingTickRequested = false;
          this.tick();
        }
      });
  }

  private async executeTick(): Promise<void> {
    if (this.isPaused) {
      return;
    }

    const boards = await this.storage.listBoards();
    for (const board of boards) {
      await this.processBoard(board);
    }

    this.broadcastSchedulerState();
  }

  private async processBoard(board: Board): Promise<void> {
    const maxParallel = board.settings.maxParallel || 3;
    const allTasks = await this.storage.listTasks(board.id);
    const taskMap = new Map<string, Task>(allTasks.map((t) => [t.id, t]));

    // Подсчет запущенных задач данной доски
    let runningOnBoard = allTasks.filter((t) => t.status === 'in_progress').length;
    let availableSlots = maxParallel - runningOnBoard;

    if (availableSlots <= 0) {
      return; // Все слоты заняты
    }

    // Ищем кандидатов со статусом 'ready'
    const readyTasks = allTasks.filter((t) => t.status === 'ready');
    if (readyTasks.length === 0) {
      return;
    }

    // Проверяем готовность зависимостей для каждой ready-задачи
    const runnableTasks: Task[] = [];

    for (const task of readyTasks) {
      let isRunnable = true;
      let hasFailedAncestor = false;
      let failedDepId: string | null = null;

      for (const depId of task.dependsOn) {
        const depTask = taskMap.get(depId);
        if (!depTask) {
          continue;
        }

        // Если зависимость упала или заблокирована — текущая задача блокируется!
        if (depTask.status === 'failed' || depTask.status === 'blocked') {
          hasFailedAncestor = true;
          failedDepId = depId;
          break;
        }

        // Если зависимость еще не выполнена (не done) — задача пока не готова
        if (depTask.status !== 'done') {
          isRunnable = false;
        }
      }

      if (hasFailedAncestor) {
        // Каскадно блокируем текущую задачу
        const u = await this.storage.updateTask(task.id, {
          status: 'blocked',
          error: `Зависимость #${failedDepId} завершилась со сбоем.`,
          log: [...task.log, `[Scheduler] Задача заблокирована, так как зависимость #${failedDepId} упала.`],
        });
        this.events.emit('task.updated', { task: u, previousStatus: 'ready' });
        continue;
      }

      if (isRunnable) {
        runnableTasks.push(task);
      }
    }

    // Сортировка кандидатов: сначала более высокий приоритет, затем более раннее создание
    runnableTasks.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));

    // Запуск доступных задач в пределах свободных слотов
    const tasksToLaunch = runnableTasks.slice(0, availableSlots);

    for (const task of tasksToLaunch) {
      // Запускаем асинхронно параллельно
      this.launchTask(task, board);
    }
  }

  /**
   * Непосредственный запуск задачи на исполнителе.
   */
  private async launchTask(task: Task, board: Board): Promise<void> {
    const executorKey = task.executor || board.settings.defaultExecutor || 'mock';
    const executor = this.executors.get(executorKey);

    if (!executor) {
      const errText = `Исполнитель "${executorKey}" не найден в реестре исполнителей.`;
      const failed = await this.storage.updateTask(task.id, {
        status: 'failed',
        error: errText,
        finishedAt: new Date().toISOString(),
        log: [...task.log, `[Scheduler] Ошибка: ${errText}`],
      });
      this.events.emit('task.updated', { task: failed, previousStatus: task.status });
      await this.cascadeBlockDescendants(task.id, board.id);
      return;
    }

    const abortController = new AbortController();
    this.runningControllers.set(task.id, abortController);

    // Подготовка контекста и входных зависимостей (deps)
    const allTasks = await this.storage.listTasks(board.id);
    const taskMap = new Map<string, Task>(allTasks.map((t) => [t.id, t]));
    const depsOutput: Record<string, { output: unknown }> = {};

    for (const depId of task.dependsOn) {
      const depTask = taskMap.get(depId);
      if (depTask && depTask.result !== undefined) {
        depsOutput[depId] = { output: depTask.result };
      }
    }

    // Переводим задачу в in_progress
    const startedAt = new Date().toISOString();
    const attempts = task.attempts + 1;

    let inProgressTask = await this.storage.updateTask(task.id, {
      status: 'in_progress',
      startedAt,
      attempts,
      log: [...task.log, `[Scheduler] Старт выполнения (попытка ${attempts}/${task.maxAttempts}) через исполнитель "${executorKey}".`],
    });

    this.runningTasks.set(task.id, inProgressTask);
    this.events.emit('task.updated', { task: inProgressTask, previousStatus: 'ready' });
    this.broadcastSchedulerState(board.id);

    // Настраиваем ExecutionContext
    const ctx: ExecutionContext = {
      signal: abortController.signal,
      log: (line: string) => {
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] ${line}`;
        // Добавляем в текущую задачу
        inProgressTask.log.push(formatted);
        this.storage.updateTask(task.id, { log: inProgressTask.log }).catch(() => {});
        this.events.emit('task.log', {
          boardId: board.id,
          taskId: task.id,
          line: formatted,
          timestamp,
        });
      },
      deps: depsOutput,
      progress: (pct: number) => {
        const meta = { ...inProgressTask.meta, progress: Math.min(100, Math.max(0, pct)) };
        inProgressTask.meta = meta;
        this.storage.updateTask(task.id, { meta }).catch(() => {});
        this.events.emit('task.updated', { task: inProgressTask });
      },
    };

    // Таймаут выполнения
    let timeoutTimer: NodeJS.Timeout | null = null;
    if (task.timeoutMs && task.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        ctx.log(`[Scheduler] Превышен таймаут задачи (${task.timeoutMs}ms) — отмена.`);
        abortController.abort();
      }, task.timeoutMs);
    }

    // Вызов исполнителя
    try {
      const result: ExecutionResult = await executor.run(inProgressTask, ctx);

      if (timeoutTimer) clearTimeout(timeoutTimer);
      this.runningControllers.delete(task.id);
      this.runningTasks.delete(task.id);

      if (result.ok) {
        // Успешное выполнение
        const requireReview = Boolean(task.requireReview || result.needsReview);
        const finalStatus: TaskStatus = requireReview ? 'review' : 'done';
        const finishedAt = new Date().toISOString();

        const finishedTask = await this.storage.updateTask(task.id, {
          status: finalStatus,
          result: result.output,
          finishedAt,
          log: [
            ...inProgressTask.log,
            requireReview
              ? `[Scheduler] Задача выполнена и ожидает подтверждения (Review).`
              : `[Scheduler] Задача успешно завершена (Done).`,
          ],
        });

        this.events.emit('task.updated', { task: finishedTask, previousStatus: 'in_progress' });

        // Важнейший момент: при переходе в done мгновенно запускаем следующих по цепочке!
        this.tick();
      } else {
        // Сбой выполнения
        const failureError = abortController.signal.aborted
          ? 'cancelled (отменено пользователем)'
          : (result.error || 'Ошибка исполнения.');
        await this.handleTaskFailure(inProgressTask, board, failureError);
      }
    } catch (err: any) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      this.runningControllers.delete(task.id);
      this.runningTasks.delete(task.id);

      const errorMessage = abortController.signal.aborted
        ? 'cancelled (отменено или прервано по таймауту)'
        : (err.message || 'Необработанное исключение исполнителя.');

      await this.handleTaskFailure(inProgressTask, board, errorMessage);
    }
  }

  /**
   * Обработка сбоя задачи: проверка повторных попыток (maxAttempts) или каскадная блокировка.
   */
  private async handleTaskFailure(task: Task, board: Board, error: string): Promise<void> {
    if (task.attempts < task.maxAttempts) {
      // Есть доступные попытки повтора — возвращаем в ready
      const retryTask = await this.storage.updateTask(task.id, {
        status: 'ready',
        error: `Попытка ${task.attempts} неудачна: ${error}`,
        log: [
          ...task.log,
          `[Scheduler] Попытка ${task.attempts} упала. Авто-повтор (${task.attempts + 1}/${task.maxAttempts})...`,
        ],
      });
      this.events.emit('task.updated', { task: retryTask, previousStatus: 'in_progress' });
      this.tick();
    } else {
      // Попытки исчерпаны — финальный статус failed
      const failedTask = await this.storage.updateTask(task.id, {
        status: 'failed',
        error,
        finishedAt: new Date().toISOString(),
        log: [...task.log, `[Scheduler] Выполнение завершилось ошибкой: ${error}`],
      });
      this.events.emit('task.updated', { task: failedTask, previousStatus: 'in_progress' });

      // Каскадно блокируем всех потомков
      await this.cascadeBlockDescendants(task.id, board.id);

      // Запускаем пересчет очереди
      this.tick();
    }
  }
}
