/**
 * @file kanban-module/src/executors/mock-executor.ts
 * @description Мок-исполнитель задач для демонстрации и автоматических тестов.
 *
 * Особенности:
 * - Поддерживает точную регулировку задержки выполнения (через task.meta.delayMs или конструктор);
 * - Позволяет симулировать ошибки выполнения (task.meta.shouldFail = true или маркер [FAIL] в тексте);
 * - Генерирует промежуточный прогресс (25%, 50%, 75%, 100%) и журнал логов;
 * - Мгновенно прерывается при срабатывании ctx.signal.abort();
 * - Передает агрегированные результаты предшественников (ctx.deps) в выходные данные.
 */

import { Task, ExecutionContext, ExecutionResult, TaskExecutor } from '../core/types';

export interface MockExecutorOptions {
  id?: string;
  defaultDelayMs?: number;
}

export class MockExecutor implements TaskExecutor {
  readonly id: string;
  private defaultDelayMs: number;

  constructor(options: MockExecutorOptions = {}) {
    this.id = options.id || 'mock';
    this.defaultDelayMs = options.defaultDelayMs !== undefined ? options.defaultDelayMs : 800;
  }

  async run(task: Task, ctx: ExecutionContext): Promise<ExecutionResult> {
    const delay =
      typeof task.meta?.delayMs === 'number'
        ? task.meta.delayMs
        : this.defaultDelayMs;

    const shouldFail =
      Boolean(task.meta?.shouldFail) ||
      task.prompt.includes('[FAIL]') ||
      task.title.includes('[FAIL]');

    ctx.log(`[${this.id}] Запуск выполнения задачи "${task.title}" (планируемая длительность: ${delay}ms)`);
    ctx.progress(10);

    const stepMs = Math.max(10, Math.floor(delay / 4));

    // Имитация пошаговой работы с проверкой AbortSignal
    for (let pct = 25; pct <= 100; pct += 25) {
      if (ctx.signal.aborted) {
        ctx.log(`[${this.id}] Выполнение задачи прервано сигналом отмены.`);
        return {
          ok: false,
          error: 'cancelled (отменено пользователем)',
        };
      }

      await this.sleep(stepMs, ctx.signal);
      ctx.progress(pct);
      ctx.log(`[${this.id}] Выполнен шаг (${pct}%): обработка подзадач...`);
    }

    if (shouldFail) {
      ctx.log(`[${this.id}] Ошибка: задача завершилась сбоем (симуляция ошибки).`);
      return {
        ok: false,
        error: typeof task.meta?.errorMessage === 'string' ? task.meta.errorMessage : 'Симулированная ошибка исполнителя.',
      };
    }

    const needsReview = Boolean(task.requireReview || task.meta?.needsReview);

    ctx.log(`[${this.id}] Задача успешно выполнена!`);

    return {
      ok: true,
      needsReview,
      output: {
        taskId: task.id,
        title: task.title,
        status: 'completed',
        completedAt: new Date().toISOString(),
        receivedDependencies: Object.keys(ctx.deps),
      },
    };
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error('Operation aborted'));
      }

      const timer = setTimeout(() => {
        resolve();
      }, ms);

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve(); // Выходим из сна для возврата результата отмены
          },
          { once: true }
        );
      }
    });
  }
}
