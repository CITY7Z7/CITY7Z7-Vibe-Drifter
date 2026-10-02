/**
 * @file kanban-module/tests/core/scheduler.test.ts
 * @description Тестирование ядра шедулера и оркестрации (Тест-кейсы 2–10).
 *
 * Проверяет:
 * - Кейс 2: Цепочка 1 -> 2 -> 3 (строгая последовательность);
 * - Кейс 3: Веер 1 -> 2, 1 -> 3, 1 -> 4 (одновременный параллельный запуск с проверкой timestamps);
 * - Кейс 4: Схождение 2 -> 5, 3 -> 5, 4 -> 5 (запуск 5 строго после всех трех);
 * - Кейс 5: Лимит параллелизма (maxParallel = 2);
 * - Кейс 6: Сбой задачи, каскадный статус blocked, и восстановление через Retry;
 * - Кейс 7: Незапущенный предок (карточка ждет в ready, молча не запускается);
 * - Кейс 8: Отмена выполнения (Cancel) и срабатывание AbortSignal;
 * - Кейс 9: Ручной пересмотр (Review) и запуск зависимых по Approve;
 * - Кейс 10: Восстановление после перезапуска (recoverPolicy: fail / requeue).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Scheduler } from '../../src/core/scheduler';
import { MemoryStorageAdapter } from '../../src/storage/memory-adapter';
import { ExecutorRegistry } from '../../src/executors/registry';
import { MockExecutor } from '../../src/executors/mock-executor';
import { KanbanEventEmitter } from '../../src/core/events';
import { Board, Task } from '../../src/core/types';

describe('Шедулер оркестратора: Тест-кейсы 2–10', () => {
  let storage: MemoryStorageAdapter;
  let executors: ExecutorRegistry;
  let events: KanbanEventEmitter;
  let scheduler: Scheduler;
  let testBoard: Board;

  beforeEach(async () => {
    storage = new MemoryStorageAdapter();
    await storage.init();

    // Регистрируем MockExecutor с быстрой задержкой 60ms
    executors = new ExecutorRegistry([new MockExecutor({ defaultDelayMs: 60 })]);
    events = new KanbanEventEmitter();

    scheduler = new Scheduler({
      storage,
      executors,
      events,
    });

    testBoard = {
      id: 'board-1',
      name: 'Test Board',
      settings: {
        maxParallel: 3,
        autoChain: true,
        recoverPolicy: 'fail',
        defaultExecutor: 'mock',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.createBoard(testBoard);
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  function makeTask(id: string, dependsOn: string[] = [], extra: Partial<Task> = {}): Task {
    return {
      id,
      boardId: testBoard.id,
      title: `Task ${id}`,
      prompt: `Prompt for ${id}`,
      status: 'backlog',
      priority: 0,
      labels: [],
      dependsOn,
      attempts: 0,
      maxAttempts: 1,
      timeoutMs: 30000,
      requireReview: false,
      log: [],
      createdAt: new Date().toISOString(),
      meta: {},
      ...extra,
    };
  }

  // --- Кейс 2: Цепочка ---
  it('Кейс 2: Цепочка 1 → 2 → 3 выполняется строго по порядку', async () => {
    const t1 = await storage.createTask(makeTask('1'));
    const t2 = await storage.createTask(makeTask('2', ['1']));
    const t3 = await storage.createTask(makeTask('3', ['2']));

    // Запускаем первую задачу
    await scheduler.startTask(t1.id);

    // Дожидаемся завершения всей цепочки (3 задачи по ~60ms)
    await sleep(350);

    const r1 = await storage.getTask('1');
    const r2 = await storage.getTask('2');
    const r3 = await storage.getTask('3');

    expect(r1?.status).toBe('done');
    expect(r2?.status).toBe('done');
    expect(r3?.status).toBe('done');

    const t1Finish = new Date(r1!.finishedAt!).getTime();
    const t2Start = new Date(r2!.startedAt!).getTime();
    const t2Finish = new Date(r2!.finishedAt!).getTime();
    const t3Start = new Date(r3!.startedAt!).getTime();

    // t2 стартует после или в момент завершения t1
    expect(t2Start).toBeGreaterThanOrEqual(t1Finish - 20);
    // t3 стартует после или в момент завершения t2
    expect(t3Start).toBeGreaterThanOrEqual(t2Finish - 20);
  });

  // --- Кейс 3: Веер ---
  it('Кейс 3: Веер 1 → 2, 1 → 3, 1 → 4 — карточки 2, 3, 4 стартуют одновременно после 1', async () => {
    const t1 = await storage.createTask(makeTask('1'));
    const t2 = await storage.createTask(makeTask('2', ['1']));
    const t3 = await storage.createTask(makeTask('3', ['1']));
    const t4 = await storage.createTask(makeTask('4', ['1']));

    await scheduler.startTask(t1.id);

    // Дожидаемся завершения
    await sleep(300);

    const r1 = await storage.getTask('1');
    const r2 = await storage.getTask('2');
    const r3 = await storage.getTask('3');
    const r4 = await storage.getTask('4');

    expect(r1?.status).toBe('done');
    expect(r2?.status).toBe('done');
    expect(r3?.status).toBe('done');
    expect(r4?.status).toBe('done');

    const s2 = new Date(r2!.startedAt!).getTime();
    const s3 = new Date(r3!.startedAt!).getTime();
    const s4 = new Date(r4!.startedAt!).getTime();

    // Временные метки старта 2, 3, 4 различаются не более чем на 50мс (параллельный запуск)
    expect(Math.abs(s2 - s3)).toBeLessThanOrEqual(50);
    expect(Math.abs(s3 - s4)).toBeLessThanOrEqual(50);
  });

  // --- Кейс 4: Схождение ---
  it('Кейс 4: Схождение 2 → 5, 3 → 5, 4 → 5 — карточка 5 стартует только после завершения всех трех', async () => {
    // 2, 3, 4 имеют разные задержки: 40ms, 80ms, 120ms
    const t2 = await storage.createTask(makeTask('2', [], { meta: { delayMs: 40 } }));
    const t3 = await storage.createTask(makeTask('3', [], { meta: { delayMs: 80 } }));
    const t4 = await storage.createTask(makeTask('4', [], { meta: { delayMs: 120 } }));
    const t5 = await storage.createTask(makeTask('5', ['2', '3', '4']));

    await scheduler.startTask(t2.id);
    await scheduler.startTask(t3.id);
    await scheduler.startTask(t4.id);
    await scheduler.startTask(t5.id);

    // Через 60ms: t2 завершена, но t3 и t4 еще выполняются -> t5 обязана оставаться в ready
    await sleep(65);
    let r5 = await storage.getTask('5');
    expect(r5?.status).toBe('ready');

    // Через еще 140ms все 2, 3, 4 закончатся и t5 стартует и завершится
    await sleep(180);
    r5 = await storage.getTask('5');
    const r4 = await storage.getTask('4');

    expect(r5?.status).toBe('done');
    const t4Finish = new Date(r4!.finishedAt!).getTime();
    const t5Start = new Date(r5!.startedAt!).getTime();
    expect(t5Start).toBeGreaterThanOrEqual(t4Finish - 15);
  });

  // --- Кейс 5: Лимит параллелизма ---
  it('Кейс 5: При maxParallel = 2 одновременно выполняется не больше двух карточек', async () => {
    await storage.updateBoard(testBoard.id, { settings: { maxParallel: 2 } });

    // Создаем 4 независимые задачи с задержкой 100ms
    const t1 = await storage.createTask(makeTask('1', [], { meta: { delayMs: 100 } }));
    const t2 = await storage.createTask(makeTask('2', [], { meta: { delayMs: 100 } }));
    const t3 = await storage.createTask(makeTask('3', [], { meta: { delayMs: 100 } }));
    const t4 = await storage.createTask(makeTask('4', [], { meta: { delayMs: 100 } }));

    await scheduler.startTask(t1.id);
    await scheduler.startTask(t2.id);
    await scheduler.startTask(t3.id);
    await scheduler.startTask(t4.id);

    // Сразу после старта проверяем: только 2 задачи в статусе in_progress
    await sleep(25);
    const tasksAfterStart = await storage.listTasks(testBoard.id);
    const inProgressCount = tasksAfterStart.filter((t) => t.status === 'in_progress').length;
    expect(inProgressCount).toBe(2);

    // Ожидаем завершения всех 4 задач
    await sleep(250);
    const allDone = (await storage.listTasks(testBoard.id)).every((t) => t.status === 'done');
    expect(allDone).toBe(true);
  });

  // --- Кейс 6: Сбой и Retry ---
  it('Кейс 6: Падение карточки 2 переводит потомков в blocked; Retry возвращает их в ready', async () => {
    const t1 = await storage.createTask(makeTask('1'));
    // t2 сконфигурирована упасть
    const t2 = await storage.createTask(makeTask('2', ['1'], { meta: { shouldFail: true } }));
    const t3 = await storage.createTask(makeTask('3', ['2']));

    await scheduler.startTask(t1.id);
    await sleep(200);

    const r2 = await storage.getTask('2');
    const r3 = await storage.getTask('3');

    expect(r2?.status).toBe('failed');
    expect(r3?.status).toBe('blocked');

    // Исправляем ошибку в t2 и делаем Retry
    await storage.updateTask('2', { meta: { shouldFail: false } });
    await scheduler.retryTask('2');
    await sleep(30);

    // Проверяем: t2 в in_progress, а t3 возвращена из blocked в ready!
    let r2After = await storage.getTask('2');
    let r3After = await storage.getTask('3');
    expect(r2After?.status).toBe('in_progress'); // Шедулер сразу взял ее
    expect(r3After?.status).toBe('ready');

    // Дожидаемся завершения повторной цепочки
    await sleep(200);
    r2After = await storage.getTask('2');
    r3After = await storage.getTask('3');

    expect(r2After?.status).toBe('done');
    expect(r3After?.status).toBe('done');
  });

  // --- Кейс 7: Незапущенный предок ---
  it('Кейс 7: Start карточки с предком в backlog оставляет её в ready и молча не запускает', async () => {
    // 1 в backlog
    const t1 = await storage.createTask(makeTask('1'));
    // 2 зависит от 1
    const t2 = await storage.createTask(makeTask('2', ['1']));

    // Запускаем ТОЛЬКО задачу 2 (не запуская предка 1)
    await scheduler.startTask(t2.id);
    await sleep(60);

    const r1 = await storage.getTask('1');
    const r2 = await storage.getTask('2');

    expect(r1?.status).toBe('backlog');
    expect(r2?.status).toBe('ready'); // Задача 2 готова, но ждет завершения задачи 1
  });

  // --- Кейс 8: Отмена (Cancel) ---
  it('Кейс 8: Cancel для in_progress вызывает AbortSignal, карточка становится failed (cancelled)', async () => {
    const t1 = await storage.createTask(makeTask('1', [], { meta: { delayMs: 400 } }));

    await scheduler.startTask(t1.id);
    await sleep(30);

    let r1 = await storage.getTask('1');
    expect(r1?.status).toBe('in_progress');

    // Отменяем задачу в полете
    await scheduler.cancelTask(t1.id);

    r1 = await storage.getTask('1');
    expect(r1?.status).toBe('failed');
    expect(r1?.error).toContain('cancelled');
  });

  // --- Кейс 9: Review и Approve ---
  it('Кейс 9: Карточка с requireReview останавливается в review, Approve переводит в done и запускает потомков', async () => {
    const t1 = await storage.createTask(makeTask('1', [], { requireReview: true }));
    const t2 = await storage.createTask(makeTask('2', ['1']));

    await scheduler.startTask(t1.id);
    await sleep(120);

    let r1 = await storage.getTask('1');
    let r2 = await storage.getTask('2');

    // t1 должна остановиться в review
    expect(r1?.status).toBe('review');
    // t2 ждет завершения t1 и пока в ready
    expect(r2?.status).toBe('ready');

    // Одобряем задачу 1
    await scheduler.approveTask(t1.id);

    // Дожидаемся, пока одобрение разблокирует t2
    await sleep(120);

    r1 = await storage.getTask('1');
    r2 = await storage.getTask('2');

    expect(r1?.status).toBe('done');
    expect(r2?.status).toBe('done');
  });

  // --- Кейс 10: Перезапуск и recoverPolicy ---
  it('Кейс 10: При recoverPolicy = fail карточки in_progress становятся failed (interrupted); при requeue возвращаются в ready', async () => {
    // 1. Тест политики fail
    const t1 = await storage.createTask(makeTask('1', [], { status: 'in_progress' }));
    await scheduler.recover();

    let r1 = await storage.getTask('1');
    expect(r1?.status).toBe('failed');
    expect(r1?.error).toContain('interrupted');

    // 2. Тест политики requeue
    await storage.updateBoard(testBoard.id, { settings: { recoverPolicy: 'requeue' } });
    const t2 = await storage.createTask(makeTask('2', [], { status: 'in_progress' }));
    await scheduler.recover();

    let r2 = await storage.getTask('2');
    expect(r2?.status).toBe('ready');
  });
});
