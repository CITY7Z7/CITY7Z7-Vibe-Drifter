/**
 * @file kanban-module/src/server/sse.ts
 * @description Управление соединениями Server-Sent Events (SSE).
 *
 * Особенности:
 * - Нативная реализация без сторонних библиотек;
 * - Keep-alive пинг (heartbeat) каждые 15 секунд для предотвращения закрытия прокси/браузером;
 * - Корректная очистка при дисконнекте клиента (req.on('close'));
 * - Автоматическая трансляция событий из KanbanEventEmitter.
 */

import { Response, Request } from 'express';
import { KanbanEventEmitter, KanbanEventType } from '../core/events';

export class SSEManager {
  private clients = new Set<Response>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(private events: KanbanEventEmitter) {
    this.initEventListeners();
    this.startHeartbeat();
  }

  private initEventListeners(): void {
    const eventTypes: KanbanEventType[] = [
      'task.created',
      'task.updated',
      'task.deleted',
      'task.log',
      'board.updated',
      'scheduler.state',
    ];

    for (const type of eventTypes) {
      this.events.on(type, (data) => {
        this.broadcast(type, data);
      });
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const res of this.clients) {
        try {
          res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          this.clients.delete(res);
        }
      }
    }, 15000);
  }

  /**
   * Подключение нового HTTP-клиента к SSE-потоку.
   */
  handleConnection(req: Request, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Отправляем начальное приветственное сообщение
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    this.clients.add(res);

    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  /**
   * Отправка типизированного события всем подключенным клиентам.
   */
  broadcast(eventType: string, data: unknown): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  /**
   * Завершение работы менеджера.
   */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const res of this.clients) {
      try {
        res.end();
      } catch {}
    }
    this.clients.clear();
  }
}
