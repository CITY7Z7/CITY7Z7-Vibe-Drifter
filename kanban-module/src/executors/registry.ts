/**
 * @file kanban-module/src/executors/registry.ts
 * @description Реестр исполнителей задач (ExecutorRegistry).
 */

import { TaskExecutor } from '../core/types';
import { MockExecutor } from './mock-executor';

export class ExecutorRegistry {
  private executors = new Map<string, TaskExecutor>();

  constructor(initialExecutors: TaskExecutor[] = []) {
    // По умолчанию всегда регистрируем базовый MockExecutor
    this.register(new MockExecutor());

    for (const executor of initialExecutors) {
      this.register(executor);
    }
  }

  register(executor: TaskExecutor): void {
    this.executors.set(executor.id, executor);
  }

  get(id: string): TaskExecutor | undefined {
    return this.executors.get(id);
  }

  has(id: string): boolean {
    return this.executors.has(id);
  }

  list(): string[] {
    return Array.from(this.executors.keys());
  }
}
