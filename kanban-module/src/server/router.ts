/**
 * @file kanban-module/src/server/router.ts
 * @description Фабрика Express Router (createKanbanRouter) для интеграции в сервер приложения-хозяина.
 *
 * Архитектурные требования:
 * - Роутер НЕ вызывает app.listen() и не имеет собственного порта (монтируется в сервер хозяина);
 * - Все маршруты могут быть защищены middleware авторизации (options.auth);
 * - Строгая валидация входящих данных через Zod;
 * - Унифицированный формат ошибок и ответов;
 * - Поддерживает SSE эндпоинт GET /events.
 */

import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { StorageAdapter } from '../storage/types';
import { Scheduler } from '../core/scheduler';
import { KanbanEventEmitter } from '../core/events';
import { UnifiedPlanner } from '../planner/planner';
import { SSEManager } from './sse';
import {
  validateManualTransition,
  validateNewLink,
  validateGraphAcyclic,
} from '../core/graph';
import { Board, Task, TaskStatus } from '../core/types';

export interface KanbanSystemInstance {
  storage: StorageAdapter;
  scheduler: Scheduler;
  events: KanbanEventEmitter;
  planner: UnifiedPlanner;
}

export interface KanbanRouterOptions {
  auth?: RequestHandler;
  apiBase?: string;
}

export function createKanbanRouter(
  kanban: KanbanSystemInstance,
  options: KanbanRouterOptions = {}
): Router {
  const router = Router();
  const sse = new SSEManager(kanban.events);

  // Опциональный middleware авторизации хозяина
  if (options.auth) {
    router.use(options.auth);
  }

  // --- SSE Поток событий ---
  router.get('/events', (req: Request, res: Response) => {
    sse.handleConnection(req, res);
  });

  // --- Управление Досками (Boards) ---

  // GET /boards
  router.get('/boards', async (req: Request, res: Response, next: NextFunction) => {
    try {
      let boards = await kanban.storage.listBoards();
      // Если досок нет — создаем дефолтную для мгновенной готовности к работе
      if (boards.length === 0) {
        const defaultBoard: Board = {
          id: 'default',
          name: 'Главная доска задач',
          settings: {
            maxParallel: 3,
            autoChain: true,
            recoverPolicy: 'fail',
            defaultExecutor: 'mock',
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await kanban.storage.createBoard(defaultBoard);
        boards = [defaultBoard];
      }
      res.json({ ok: true, data: boards });
    } catch (err) {
      next(err);
    }
  });

  // POST /boards
  const CreateBoardSchema = z.object({
    name: z.string().min(1, 'Имя доски не может быть пустым').max(100),
    settings: z
      .object({
        maxParallel: z.number().int().min(1).max(20).default(3),
        autoChain: z.boolean().default(true),
        recoverPolicy: z.enum(['fail', 'requeue']).default('fail'),
        defaultExecutor: z.string().optional(),
      })
      .optional(),
  });

  router.post('/boards', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateBoardSchema.parse(req.body);
      const newBoard: Board = {
        id: `board-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: parsed.name,
        settings: {
          maxParallel: parsed.settings?.maxParallel ?? 3,
          autoChain: parsed.settings?.autoChain ?? true,
          recoverPolicy: parsed.settings?.recoverPolicy ?? 'fail',
          defaultExecutor: parsed.settings?.defaultExecutor || 'mock',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const created = await kanban.storage.createBoard(newBoard);
      kanban.events.emit('board.updated', { board: created });
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      next(err);
    }
  });

  // GET /boards/:id
  router.get('/boards/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const board = await kanban.storage.getBoard(req.params.id);
      if (!board) {
        return res.status(404).json({ ok: false, error: 'Доска не найдена' });
      }
      const tasks = await kanban.storage.listTasks(board.id);
      res.json({ ok: true, data: { board, tasks } });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /boards/:id
  const UpdateBoardSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    settings: z
      .object({
        maxParallel: z.number().int().min(1).max(20).optional(),
        autoChain: z.boolean().optional(),
        recoverPolicy: z.enum(['fail', 'requeue']).optional(),
        defaultExecutor: z.string().optional(),
      })
      .optional(),
  });

  router.patch('/boards/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateBoardSchema.parse(req.body);
      const updated = await kanban.storage.updateBoard(req.params.id, parsed);
      kanban.events.emit('board.updated', { board: updated });
      res.json({ ok: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /boards/:id
  router.delete('/boards/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await kanban.storage.deleteBoard(req.params.id);
      if (!deleted) {
        return res.status(404).json({ ok: false, error: 'Доска не найдена' });
      }
      res.json({ ok: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  });

  // GET /boards/:id/tasks
  router.get('/boards/:id/tasks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tasks = await kanban.storage.listTasks(req.params.id);
      res.json({ ok: true, data: tasks });
    } catch (err) {
      next(err);
    }
  });

  // --- Управление Задачами (Tasks) ---

  const CreateTaskSchema = z.object({
    boardId: z.string().min(1, 'boardId обязателен'),
    title: z.string().min(1, 'Заголовок задачи обязателен').max(150),
    prompt: z.string().min(1, 'Инструкция для задачи обязательна'),
    status: z
      .enum(['backlog', 'ready', 'in_progress', 'review', 'done', 'failed', 'blocked'])
      .default('backlog'),
    executor: z.string().optional(),
    priority: z.number().int().default(0),
    labels: z.array(z.string()).default([]),
    dependsOn: z.array(z.string()).default([]),
    maxAttempts: z.number().int().min(1).default(1),
    timeoutMs: z.number().int().min(100).default(30000),
    requireReview: z.boolean().default(false),
    meta: z.record(z.string(), z.unknown()).default({}),
  });

  // POST /tasks
  router.post('/tasks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateTaskSchema.parse(req.body);
      const allTasks = await kanban.storage.listTasks(body.boardId);

      const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const newTask: Task = {
        id: taskId,
        boardId: body.boardId,
        title: body.title,
        prompt: body.prompt,
        status: body.status,
        executor: body.executor,
        priority: body.priority,
        labels: body.labels,
        dependsOn: body.dependsOn,
        attempts: 0,
        maxAttempts: body.maxAttempts,
        timeoutMs: body.timeoutMs,
        requireReview: body.requireReview,
        log: [`[${new Date().toISOString()}] Задача создана.`],
        createdAt: new Date().toISOString(),
        meta: body.meta,
      };

      // Проверка ацикличности перед созданием
      validateGraphAcyclic([...allTasks, newTask]);

      const created = await kanban.storage.createTask(newTask);
      kanban.events.emit('task.created', { task: created });

      // Если создана в статусе ready — запускаем шедулер
      if (created.status === 'ready') {
        kanban.scheduler.tick();
      }

      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /tasks/:id
  const UpdateTaskSchema = z.object({
    title: z.string().min(1).max(150).optional(),
    prompt: z.string().min(1).optional(),
    status: z.enum(['backlog', 'ready', 'in_progress', 'review', 'done', 'failed', 'blocked']).optional(),
    executor: z.string().optional(),
    priority: z.number().int().optional(),
    labels: z.array(z.string()).optional(),
    dependsOn: z.array(z.string()).optional(),
    maxAttempts: z.number().int().min(1).optional(),
    timeoutMs: z.number().int().min(100).optional(),
    requireReview: z.boolean().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  });

  router.patch('/tasks/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateTaskSchema.parse(req.body);
      const existing = await kanban.storage.getTask(req.params.id);
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'Задача не найдена' });
      }

      // Если меняется статус — проверяем допустимость ручного перехода!
      if (parsed.status && parsed.status !== existing.status) {
        validateManualTransition(existing.status, parsed.status);

        // Перенаправляем на методы шедулера для соблюдения бизнес-логики:
        if (existing.status === 'backlog' && parsed.status === 'ready') {
          const started = await kanban.scheduler.startTask(existing.id);
          return res.json({ ok: true, data: started });
        }
        if (existing.status === 'in_progress' && parsed.status === 'backlog') {
          const cancelled = await kanban.scheduler.cancelTask(existing.id);
          return res.json({ ok: true, data: cancelled });
        }
        if (existing.status === 'review' && parsed.status === 'done') {
          const approved = await kanban.scheduler.approveTask(existing.id);
          return res.json({ ok: true, data: approved });
        }
        if (existing.status === 'review' && parsed.status === 'ready') {
          const rejected = await kanban.scheduler.rejectTask(existing.id, 'Ручной перенос в Ready');
          return res.json({ ok: true, data: rejected });
        }
      }

      // Если меняются зависимости — проверяем граф
      if (parsed.dependsOn) {
        const allTasks = await kanban.storage.listTasks(existing.boardId);
        const updatedList = allTasks.map((t) => (t.id === existing.id ? { ...t, dependsOn: parsed.dependsOn! } : t));
        validateGraphAcyclic(updatedList);
      }

      const updated = await kanban.storage.updateTask(existing.id, parsed);
      kanban.events.emit('task.updated', { task: updated });

      res.json({ ok: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /tasks/:id
  router.delete('/tasks/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = await kanban.storage.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ ok: false, error: 'Задача не найдена' });
      }

      // Если задача выполняется, сначала отменяем
      if (task.status === 'in_progress') {
        await kanban.scheduler.cancelTask(task.id);
      }

      // Удаляем ссылки на эту задачу у других задач
      const allTasks = await kanban.storage.listTasks(task.boardId);
      for (const t of allTasks) {
        if (t.dependsOn.includes(task.id)) {
          const newDeps = t.dependsOn.filter((d) => d !== task.id);
          await kanban.storage.updateTask(t.id, { dependsOn: newDeps });
        }
      }

      await kanban.storage.deleteTask(task.id);
      kanban.events.emit('task.deleted', { boardId: task.boardId, taskId: task.id });

      res.json({ ok: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  });

  // --- Связи (Links) ---

  // POST /tasks/:id/links (добавить зависимость: задача id зависит от depId)
  router.post('/tasks/:id/links', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { depId } = req.body;
      if (!depId) {
        return res.status(400).json({ ok: false, error: 'depId обязателен' });
      }

      const task = await kanban.storage.getTask(req.params.id);
      if (!task) return res.status(404).json({ ok: false, error: 'Задача не найдена' });

      const allTasks = await kanban.storage.listTasks(task.boardId);
      // Валидация новой связи
      validateNewLink(depId, task.id, allTasks);

      if (!task.dependsOn.includes(depId)) {
        const newDeps = [...task.dependsOn, depId];
        const updated = await kanban.storage.updateTask(task.id, { dependsOn: newDeps });
        kanban.events.emit('task.updated', { task: updated });
        return res.json({ ok: true, data: updated });
      }

      res.json({ ok: true, data: task });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /tasks/:id/links/:depId
  router.delete('/tasks/:id/links/:depId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = await kanban.storage.getTask(req.params.id);
      if (!task) return res.status(404).json({ ok: false, error: 'Задача не найдена' });

      const depId = req.params.depId;
      const newDeps = task.dependsOn.filter((d) => d !== depId);
      const updated = await kanban.storage.updateTask(task.id, { dependsOn: newDeps });
      kanban.events.emit('task.updated', { task: updated });

      res.json({ ok: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // --- Действия жизненного цикла задач ---

  // POST /tasks/:id/start
  router.post('/tasks/:id/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await kanban.scheduler.startTask(req.params.id);
      res.json({ ok: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /tasks/:id/cancel
  router.post('/tasks/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await kanban.scheduler.cancelTask(req.params.id);
      res.json({ ok: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /tasks/:id/retry
  router.post('/tasks/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await kanban.scheduler.retryTask(req.params.id);
      res.json({ ok: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /tasks/:id/approve
  router.post('/tasks/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await kanban.scheduler.approveTask(req.params.id);
      res.json({ ok: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /tasks/:id/reject
  router.post('/tasks/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const comment = (req.body && req.body.comment) || 'Требуется доработка';
      const updated = await kanban.scheduler.rejectTask(req.params.id, comment);
      res.json({ ok: true, data: updated });
    } catch (err) {
      next(err);
    }
  });

  // --- Планировщик (Planner) ---

  // POST /planner/plan
  const PlanRequestSchema = z.object({
    boardId: z.string().min(1),
    prompt: z.string().min(1, 'Текст запроса обязателен'),
  });

  router.post('/planner/plan', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { boardId, prompt } = PlanRequestSchema.parse(req.body);
      const existingTasks = await kanban.storage.listTasks(boardId);

      const preview = await kanban.planner.plan(prompt, { boardId, existingTasks });

      // Сохраняем сообщение в истории чата
      await kanban.storage.addMessage({
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        boardId,
        role: 'user',
        text: prompt,
        createdAt: new Date().toISOString(),
      });

      await kanban.storage.addMessage({
        id: `msg-${Date.now() + 1}-${Math.random().toString(36).substring(2, 5)}`,
        boardId,
        role: 'assistant',
        text: `Сформирован план из ${preview.tasks.length} задач со связями (${preview.links.length} ребер).`,
        planPreview: preview,
        createdAt: new Date().toISOString(),
      });

      res.json({ ok: true, data: preview });
    } catch (err) {
      next(err);
    }
  });

  // POST /planner/apply (применение сформированного плана)
  const ApplyPlanSchema = z.object({
    boardId: z.string().min(1),
    plan: z.object({
      tasks: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          prompt: z.string(),
          labels: z.array(z.string()).optional(),
        })
      ),
      links: z.array(z.object({ from: z.string(), to: z.string() })),
      start: z.array(z.string()),
    }),
    autoStart: z.boolean().default(false),
  });

  router.post('/planner/apply', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { boardId, plan, autoStart } = ApplyPlanSchema.parse(req.body);

      // Маппинг временных ID плана на постоянные UUID задач
      const idMap = new Map<string, string>();
      const createdTasks: Task[] = [];
      const now = new Date().toISOString();

      // 1. Создаем задачи в статусе backlog
      for (const t of plan.tasks) {
        const permanentId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        idMap.set(t.id, permanentId);
      }

      // Собираем зависимости (dependsOn) для каждой задачи
      // Ребро from -> to означает, что задача to ждет задачу from (to зависит от from)
      const depsMap = new Map<string, string[]>();
      for (const l of plan.links) {
        const realFrom = idMap.get(l.from);
        const realTo = idMap.get(l.to);
        if (realFrom && realTo) {
          const list = depsMap.get(realTo) || [];
          list.push(realFrom);
          depsMap.set(realTo, list);
        }
      }

      for (const t of plan.tasks) {
        const permId = idMap.get(t.id)!;
        const taskDeps = depsMap.get(permId) || [];

        const taskObj: Task = {
          id: permId,
          boardId,
          title: t.title,
          prompt: t.prompt,
          status: 'backlog',
          priority: 0,
          labels: t.labels || [],
          dependsOn: taskDeps,
          attempts: 0,
          maxAttempts: 1,
          timeoutMs: 30000,
          requireReview: false,
          log: [`[${now}] Задача создана из плана планировщика.`],
          createdAt: now,
          meta: { originalPlanId: t.id },
        };

        const created = await kanban.storage.createTask(taskObj);
        createdTasks.push(created);
        kanban.events.emit('task.created', { task: created });
      }

      // 2. Если autoStart или указаны задачи для старта:
      const tasksToStart = plan.start.map((planId) => idMap.get(planId)).filter(Boolean) as string[];

      if (autoStart || tasksToStart.length > 0) {
        for (const sId of tasksToStart) {
          await kanban.scheduler.startTask(sId);
        }
      }

      res.status(201).json({ ok: true, data: { createdTasks, startedCount: tasksToStart.length } });
    } catch (err) {
      next(err);
    }
  });

  // --- Чат планировщика ---

  router.get('/boards/:id/chat', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const messages = await kanban.storage.listMessages(req.params.id);
      res.json({ ok: true, data: messages });
    } catch (err) {
      next(err);
    }
  });

  router.post('/boards/:id/chat', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { text, role = 'user' } = req.body;
      if (!text) return res.status(400).json({ ok: false, error: 'text обязателен' });

      const msg = await kanban.storage.addMessage({
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        boardId: req.params.id,
        role,
        text,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json({ ok: true, data: msg });
    } catch (err) {
      next(err);
    }
  });

  // --- Шедулер (Scheduler) ---

  // POST /scheduler/pause
  router.post('/scheduler/pause', (req: Request, res: Response) => {
    kanban.scheduler.pause();
    res.json({ ok: true, data: { isPaused: true } });
  });

  // POST /scheduler/resume
  router.post('/scheduler/resume', (req: Request, res: Response) => {
    kanban.scheduler.resume();
    res.json({ ok: true, data: { isPaused: false } });
  });

  // GET /scheduler/status
  router.get('/scheduler/status', (req: Request, res: Response) => {
    res.json({
      ok: true,
      data: {
        isPaused: kanban.scheduler.getIsPaused(),
        runningTaskIds: kanban.scheduler.getRunningTaskIds(),
      },
    });
  });

  // --- Шаблоны (Templates) ---

  // GET /templates
  router.get('/templates', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const templates = await kanban.storage.listTemplates();
      res.json({ ok: true, data: templates });
    } catch (err) {
      next(err);
    }
  });

  // POST /templates
  const CreateTemplateSchema = z.object({
    category: z.enum(['greenfield', 'modernization', 'testing', 'features', 'devops', 'custom']),
    title: z.string().min(1).max(100),
    prompt: z.string().min(1),
  });

  router.post('/templates', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateTemplateSchema.parse(req.body);
      const created = await kanban.storage.createTemplate({
        id: `tpl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        category: body.category,
        title: body.title,
        prompt: body.prompt,
        isBuiltin: false,
        createdAt: new Date().toISOString(),
      });
      res.status(201).json({ ok: true, data: created });
    } catch (err) {
      next(err);
    }
  });

  // Единый middleware обработки ошибок
  router.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err.name === 'ZodError') {
      return res.status(400).json({
        ok: false,
        error: 'Ошибка валидации входящих данных',
        details: err.errors,
      });
    }

    if (err.name === 'GraphValidationError' || err.name === 'InvalidTransitionError') {
      return res.status(400).json({
        ok: false,
        error: err.message,
      });
    }

    console.error('[KanbanRouter Error]', err);
    res.status(500).json({
      ok: false,
      error: err.message || 'Внутренняя ошибка сервера Kanban-оркестратора',
    });
  });

  return router;
}
