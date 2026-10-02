/**
 * @file kanban-module/src/executors/http-executor.ts
 * @description HTTP POST Webhook исполнитель задач.
 *
 * Отправляет POST-запрос на указанный URL сервиса хозяина с информацией о задаче,
 * зависимостях и метаданных. Поддерживает AbortSignal и строгие таймауты.
 */

import { Task, ExecutionContext, ExecutionResult, TaskExecutor } from '../core/types';

export interface HttpExecutorOptions {
  id?: string;
  defaultEndpointUrl?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class HttpExecutor implements TaskExecutor {
  readonly id: string;
  private defaultEndpointUrl?: string;
  private defaultHeaders: Record<string, string>;
  private defaultTimeoutMs: number;

  constructor(options: HttpExecutorOptions = {}) {
    this.id = options.id || 'http';
    this.defaultEndpointUrl = options.defaultEndpointUrl;
    this.defaultHeaders = options.headers || { 'Content-Type': 'application/json' };
    this.defaultTimeoutMs = options.timeoutMs || 30000;
  }

  async run(task: Task, ctx: ExecutionContext): Promise<ExecutionResult> {
    const url =
      (typeof task.meta?.webhookUrl === 'string' && task.meta.webhookUrl) ||
      this.defaultEndpointUrl;

    if (!url) {
      return {
        ok: false,
        error: `Не указан URL для webhook (task.meta.webhookUrl или defaultEndpointUrl).`,
      };
    }

    ctx.log(`[${this.id}] Отправка POST-запроса на webhook: ${url}`);
    ctx.progress(20);

    const payload = {
      event: 'kanban.task.execute',
      task: {
        id: task.id,
        boardId: task.boardId,
        title: task.title,
        prompt: task.prompt,
        priority: task.priority,
        labels: task.labels,
        meta: task.meta,
      },
      deps: ctx.deps,
      timestamp: new Date().toISOString(),
    };

    // Комбинируем AbortSignal из контекста и таймаут
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, task.timeoutMs || this.defaultTimeoutMs);

    const onAbort = () => controller.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.defaultHeaders,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      ctx.progress(80);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Неизвестная ошибка HTTP');
        ctx.log(`[${this.id}] Ошибка ответа HTTP ${response.status}: ${errorText}`);
        return {
          ok: false,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json().catch(() => ({}));
      ctx.progress(100);
      ctx.log(`[${this.id}] Webhook успешно ответил (HTTP ${response.status}).`);

      return {
        ok: true,
        output: data,
        needsReview: Boolean(data.needsReview || task.requireReview),
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (ctx.signal.aborted) {
        ctx.log(`[${this.id}] Запрос отменен пользователем.`);
        return { ok: false, error: 'Запрос отменен пользователем.' };
      }
      if (err.name === 'AbortError') {
        ctx.log(`[${this.id}] Превышен таймаут выполнения webhook.`);
        return { ok: false, error: 'Превышен таймаут ответа webhook.' };
      }
      ctx.log(`[${this.id}] Сетевая ошибка webhook: ${err.message}`);
      return { ok: false, error: err.message };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  }
}
