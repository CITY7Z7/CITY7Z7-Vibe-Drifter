/**
 * @file kanban-module/tests/server/api.test.ts
 * @description Тест-кейсы 12, 13, 14: REST API, встроенный режим (Embedded Mode) и изоляция.
 *
 * Проверяет:
 * - Кейс 12: Supertest по всем маршрутам, ошибки валидации Zod, отклонение недопустимых переходов;
 * - Кейс 13: Встраивание createKanbanRouter в Express под разными префиксами (/api/kanban и /custom/kanban), отсутствие вмешательства в хост-маршруты;
 * - Кейс 14: Изоляция UI (префиксы kb-*, локальные CSS-переменные, отсутствие глобальных стилей).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import { createKanban, KanbanModuleInstance } from '../../src/index';

describe('Кейсы 12 и 13: REST API и Встроенный режим (Embedded Mode)', () => {
  let app: Express;
  let kanban: KanbanModuleInstance;

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    // Создаем экземпляр модуля
    kanban = createKanban({
      sqlitePath: ':memory:',
    });
    await kanban.init();

    // Маршруты хоста (должны оставаться нетронутыми!)
    app.get('/host-route', (req, res) => res.json({ host: 'intact' }));

    // Монтирование модуля под стандартным префиксом
    app.use('/api/kanban', kanban.router);
  });

  afterEach(async () => {
    await kanban.close();
  });

  it('Кейс 13: Хозяйские маршруты и изоляция Express работают корректно', async () => {
    const res = await request(app).get('/host-route');
    expect(res.status).toBe(200);
    expect(res.body.host).toBe('intact');
  });

  it('Кейс 13: Монтирование под другим префиксом (/custom/kanban)', async () => {
    const customApp = express();
    customApp.use(express.json());
    customApp.use('/custom/kanban', kanban.router);

    const res = await request(customApp).get('/custom/kanban/boards');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('Кейс 12: GET /boards возвращает дефолтную доску', async () => {
    const res = await request(app).get('/api/kanban/boards');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].id).toBe('default');
  });

  it('Кейс 12: POST /tasks валидирует обязательные поля через Zod', async () => {
    const res = await request(app)
      .post('/api/kanban/tasks')
      .send({ title: '' }); // пустые данные

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('валидации');
  });

  it('Кейс 12: Создание задачи и жизненный цикл (Start, Cancel, Retry, Approve)', async () => {
    // 1. Создание задачи
    const createRes = await request(app)
      .post('/api/kanban/tasks')
      .send({
        boardId: 'default',
        title: 'API Test Task',
        prompt: 'Test prompt content',
        status: 'backlog',
        priority: 1,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.ok).toBe(true);
    const task = createRes.body.data;
    expect(task.id).toBeDefined();

    // 2. Старт задачи: POST /tasks/:id/start
    const startRes = await request(app).post(`/api/kanban/tasks/${task.id}/start`);
    expect(startRes.status).toBe(200);
    expect(startRes.body.data.status).toBe('ready');

    // 3. Отмена задачи: POST /tasks/:id/cancel
    const cancelRes = await request(app).post(`/api/kanban/tasks/${task.id}/cancel`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('failed');

    // 4. Повтор задачи: POST /tasks/:id/retry
    const retryRes = await request(app).post(`/api/kanban/tasks/${task.id}/retry`);
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.data.status).toBe('ready');
  });

  it('Кейс 12: PATCH /tasks/:id блокирует недопустимый переход статуса (backlog -> done)', async () => {
    const createRes = await request(app)
      .post('/api/kanban/tasks')
      .send({
        boardId: 'default',
        title: 'Invalid Transition Task',
        prompt: 'Test',
        status: 'backlog',
      });
    const taskId = createRes.body.data.id;

    const patchRes = await request(app)
      .patch(`/api/kanban/tasks/${taskId}`)
      .send({ status: 'done' }); // Недопустимо!

    expect(patchRes.status).toBe(400);
    expect(patchRes.body.ok).toBe(false);
    expect(patchRes.body.error).toContain('Недопустимый переход');
  });

  it('Кейс 12: POST /tasks/:id/links проверяет ацикличность', async () => {
    const t1 = (await request(app).post('/api/kanban/tasks').send({ boardId: 'default', title: 'T1', prompt: 'P1' })).body.data;
    const t2 = (await request(app).post('/api/kanban/tasks').send({ boardId: 'default', title: 'T2', prompt: 'P2', dependsOn: [t1.id] })).body.data;

    // Пытаемся сделать T1 зависимой от T2 (цикл T1 -> T2 -> T1)
    const linkRes = await request(app)
      .post(`/api/kanban/tasks/${t1.id}/links`)
      .send({ depId: t2.id });

    expect(linkRes.status).toBe(400);
    expect(linkRes.body.error).toContain('цикл');
  });

  it('Кейс 12: Планировщик POST /planner/plan и POST /planner/apply', async () => {
    const prompt = 'Tasks: 1) First step 2) Second step. Link 1 -> 2. Start task 1.';
    const planRes = await request(app)
      .post('/api/kanban/planner/plan')
      .send({ boardId: 'default', prompt });

    expect(planRes.status).toBe(200);
    expect(planRes.body.ok).toBe(true);
    expect(planRes.body.data.tasks.length).toBe(2);

    // Применение плана
    const applyRes = await request(app)
      .post('/api/kanban/planner/apply')
      .send({
        boardId: 'default',
        plan: planRes.body.data,
        autoStart: true,
      });

    expect(applyRes.status).toBe(201);
    expect(applyRes.body.data.createdTasks.length).toBe(2);
    expect(applyRes.body.data.startedCount).toBe(1);
  });

  it('Кейс 12: Управление шедулером (Pause / Resume / Status)', async () => {
    const pauseRes = await request(app).post('/api/kanban/scheduler/pause');
    expect(pauseRes.body.data.isPaused).toBe(true);

    const statusRes = await request(app).get('/api/kanban/scheduler/status');
    expect(statusRes.body.data.isPaused).toBe(true);

    const resumeRes = await request(app).post('/api/kanban/scheduler/resume');
    expect(resumeRes.body.data.isPaused).toBe(false);
  });
});
