/**
 * @file kanban-module/src/executors/shell-executor.ts
 * @description Shell-исполнитель системных команд.
 *
 * ТРЕБОВАНИЕ БЕЗОПАСНОСТИ:
 * По умолчанию ВЫКЛЮЧЕН (enabled = false).
 * Может быть включен приложением-хозяином ТОЛЬКО с явно заданным белым списком
 * разрешенных команд (allowlist) и ограничением рабочей директории (cwd).
 */

import { spawn } from 'child_process';
import { Task, ExecutionContext, ExecutionResult, TaskExecutor } from '../core/types';

export interface ShellExecutorOptions {
  id?: string;
  /** Флаг активности. По умолчанию ВСЕГДА false! */
  enabled?: boolean;
  /** Белый список разрешенных префиксов команд */
  allowedCommands?: string[];
  /** Рабочая директория по умолчанию */
  cwd?: string;
  /** Максимальное время выполнения в ms */
  maxTimeoutMs?: number;
}

export class ShellExecutor implements TaskExecutor {
  readonly id: string;
  readonly enabled: boolean;
  private allowedCommands: string[];
  private cwd: string;
  private maxTimeoutMs: number;

  constructor(options: ShellExecutorOptions = {}) {
    this.id = options.id || 'shell';
    // По умолчанию категорически выключен
    this.enabled = options.enabled === true;
    this.allowedCommands = options.allowedCommands || [];
    this.cwd = options.cwd || process.cwd();
    this.maxTimeoutMs = options.maxTimeoutMs || 60000;
  }

  async run(task: Task, ctx: ExecutionContext): Promise<ExecutionResult> {
    if (!this.enabled) {
      return {
        ok: false,
        error: 'Shell-исполнитель выключен в конфигурации безопасности модуля. Включите его явно через config.executors.',
      };
    }

    const command = (typeof task.meta?.command === 'string' && task.meta.command) || task.prompt.trim();

    // Проверка allowlist
    const isAllowed = this.allowedCommands.some((prefix) => command.startsWith(prefix));
    if (!isAllowed) {
      return {
        ok: false,
        error: `Команда "${command}" не входит в белый список разрешенных команд (allowedCommands).`,
      };
    }

    ctx.log(`[${this.id}] Запуск команды в shell: ${command}`);
    ctx.progress(10);

    return new Promise((resolve) => {
      const child = spawn(command, {
        shell: true,
        cwd: (task.meta?.cwd as string) || this.cwd,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        ctx.log(text.trim());
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        ctx.log(`[STDERR] ${text.trim()}`);
      });

      const onAbort = () => {
        child.kill('SIGTERM');
        ctx.log(`[${this.id}] Процесс прерван сигналом отмены.`);
        resolve({
          ok: false,
          error: 'Процесс отменен пользователем.',
        });
      };

      if (ctx.signal.aborted) {
        onAbort();
        return;
      }

      ctx.signal.addEventListener('abort', onAbort, { once: true });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        ctx.log(`[${this.id}] Превышен максимальный таймаут команды.`);
        resolve({
          ok: false,
          error: 'Превышен лимит времени выполнения команды.',
        });
      }, task.timeoutMs || this.maxTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);

        ctx.progress(100);
        if (code === 0) {
          ctx.log(`[${this.id}] Команда завершена успешно (код 0).`);
          resolve({
            ok: true,
            output: { stdout: stdout.trim(), exitCode: code },
            needsReview: task.requireReview,
          });
        } else {
          ctx.log(`[${this.id}] Команда завершилась с ненулевым кодом: ${code}`);
          resolve({
            ok: false,
            error: stderr.trim() || `Команда завершилась с кодом ${code}`,
            output: { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code },
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onAbort);
        resolve({
          ok: false,
          error: `Ошибка запуска процесса: ${err.message}`,
        });
      });
    });
  }
}
