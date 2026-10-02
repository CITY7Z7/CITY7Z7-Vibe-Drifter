/**
 * @file kanban-module/src/core/graph.ts
 * @description Чистая логика ориентированного ациклического графа (DAG) зависимостей задач.
 *
 * Обрабатывает:
 * - Валидацию связей (проверка на циклы, самосвязи, несуществующие узлы);
 * - Топологическую сортировку и ранжирование слоев для визуализации;
 * - Поиск предков (ancestors) и потомков (descendants);
 * - Валидацию допустимости ручных переходов статусов.
 */

import { Task, TaskStatus } from './types';

export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus, reason?: string) {
    super(
      reason ||
        `Недопустимый переход статуса карточки: "${from}" → "${to}". Разрешены только: backlog→ready (Start), in_progress→backlog (Cancel), review→done (Approve), review→ready (Доработка).`
    );
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Валидация допустимости ручного переноса задачи между колонками.
 *
 * Разрешенные переходы:
 * - `backlog` → `ready` (Запуск задачи)
 * - `in_progress` → `backlog` (Отмена задачи с возвратом в бэклог)
 * - `review` → `done` (Подтверждение/аппрув)
 * - `review` → `ready` (Возврат на доработку)
 */
export function validateManualTransition(currentStatus: TaskStatus, targetStatus: TaskStatus): void {
  if (currentStatus === targetStatus) {
    return; // Перемещение внутри той же колонки допустимо
  }

  const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
    backlog: ['ready'],
    ready: [],
    in_progress: ['backlog'],
    review: ['done', 'ready'],
    done: [],
    failed: [],
    blocked: [],
  };

  const allowed = allowedTransitions[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    throw new InvalidTransitionError(currentStatus, targetStatus);
  }
}

/**
 * Проверка допустимости изменения связей (dependsOn) у задачи.
 * Нельзя изменять связи у задач, которые уже выполняются или завершены.
 */
export function validateCanModifyDependencies(task: Task): void {
  if (task.status === 'in_progress') {
    throw new GraphValidationError(
      `Нельзя изменять зависимости задачи "${task.title}" (#${task.id}), так как она находится в процессе выполнения.`
    );
  }
  if (task.status === 'done') {
    throw new GraphValidationError(
      `Нельзя изменять зависимости задачи "${task.title}" (#${task.id}), так как она уже завершена.`
    );
  }
}

/**
 * Валидация добавления новой связи `fromId -> toId` (где toId зависит от fromId).
 *
 * @param fromId Идентификатор задачи-предшественника (A)
 * @param toId Идентификатор зависимой задачи (B, ждет A)
 * @param allTasks Все задачи доски
 */
export function validateNewLink(fromId: string, toId: string, allTasks: Task[]): void {
  if (fromId === toId) {
    throw new GraphValidationError(`Самосвязь запрещена: задача #${fromId} не может зависеть сама от себя.`);
  }

  const fromTask = allTasks.find((t) => t.id === fromId);
  const toTask = allTasks.find((t) => t.id === toId);

  if (!fromTask) {
    throw new GraphValidationError(`Задача-источник связи #${fromId} не найдена на доске.`);
  }
  if (!toTask) {
    throw new GraphValidationError(`Зависимая задача #${toId} не найдена на доске.`);
  }

  validateCanModifyDependencies(toTask);

  // Проверяем, не существует ли уже такая зависимость
  if (toTask.dependsOn.includes(fromId)) {
    return; // Связь уже есть
  }

  // Проверка на цикл:
  // Если добавить ребро fromId -> toId, цикл появится тогда и только тогда,
  // когда из toId уже есть путь в fromId.
  if (hasPath(toId, fromId, allTasks)) {
    throw new GraphValidationError(
      `Обнаружен цикл в графе зависимостей: добавление связи #${fromId} → #${toId} создаст циклическую зависимость.`
    );
  }
}

/**
 * Проверяет наличие ориентированного пути от startId к targetId в графе задач.
 * Направление ребра: задача T зависит от D (D -> T).
 * Путь от A к B означает, что A является предком B (A -> ... -> B).
 */
export function hasPath(startId: string, targetId: string, allTasks: Task[]): boolean {
  if (startId === targetId) return true;

  // Строим граф переходов: parent -> children
  // Задача child зависит от parent, если child.dependsOn содержит parent.
  const childrenMap = new Map<string, string[]>();
  for (const t of allTasks) {
    for (const depId of t.dependsOn) {
      const list = childrenMap.get(depId) || [];
      list.push(t.id);
      childrenMap.set(depId, list);
    }
  }

  const visited = new Set<string>();
  const queue: string[] = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === targetId) return true;

    const children = childrenMap.get(curr) || [];
    for (const child of children) {
      if (!visited.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }

  return false;
}

/**
 * Проверка всего графа задач на наличие циклов (топологическая проверка алгоритмом Кана).
 * Выбрасывает GraphValidationError в случае наличия цикла.
 */
export function validateGraphAcyclic(tasks: Task[]): void {
  const taskMap = new Map<string, Task>(tasks.map((t) => [t.id, t]));

  // Проверка на несуществующие зависимости
  for (const t of tasks) {
    for (const depId of t.dependsOn) {
      if (!taskMap.has(depId)) {
        throw new GraphValidationError(
          `Задача "${t.title}" (#${t.id}) ссылается на несуществующую зависимость #${depId}.`
        );
      }
      if (depId === t.id) {
        throw new GraphValidationError(
          `Задача "${t.title}" (#${t.id}) имеет недопустимую самосвязь.`
        );
      }
    }
  }

  // Алгоритм Кана для проверки на DAG
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>(); // parent -> list of children

  for (const t of tasks) {
    inDegree.set(t.id, t.dependsOn.length);
    adj.set(t.id, []);
  }

  for (const t of tasks) {
    for (const depId of t.dependsOn) {
      adj.get(depId)?.push(t.id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
    }
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visitedCount++;

    const children = adj.get(node) || [];
    for (const ch of children) {
      const newDeg = inDegree.get(ch)! - 1;
      inDegree.set(ch, newDeg);
      if (newDeg === 0) {
        queue.push(ch);
      }
    }
  }

  if (visitedCount < tasks.length) {
    throw new GraphValidationError('Обнаружен цикл в графе задач! Задачи образуют взаимную блокировку.');
  }
}

/**
 * Получить список всех прямых и косвенных потомков задачи (дети, внуки и т.д.).
 * Ребро идет от parent к child (child зависит от parent).
 */
export function getDescendants(taskId: string, allTasks: Task[]): Task[] {
  const childrenMap = new Map<string, Task[]>();
  for (const t of allTasks) {
    for (const depId of t.dependsOn) {
      const list = childrenMap.get(depId) || [];
      list.push(t);
      childrenMap.set(depId, list);
    }
  }

  const result: Task[] = [];
  const visited = new Set<string>();
  const queue: string[] = [taskId];
  visited.add(taskId);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const children = childrenMap.get(curr) || [];
    for (const child of children) {
      if (!visited.has(child.id)) {
        visited.add(child.id);
        result.push(child);
        queue.push(child.id);
      }
    }
  }

  return result;
}

/**
 * Получить список всех прямых и косвенных предков задачи (родители, дедушки и т.д.).
 */
export function getAncestors(taskId: string, allTasks: Task[]): Task[] {
  const taskMap = new Map<string, Task>(allTasks.map((t) => [t.id, t]));
  const target = taskMap.get(taskId);
  if (!target) return [];

  const result: Task[] = [];
  const visited = new Set<string>();
  const queue: string[] = [...target.dependsOn];
  for (const depId of target.dependsOn) visited.add(depId);

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const task = taskMap.get(currId);
    if (task) {
      result.push(task);
      for (const parentId of task.dependsOn) {
        if (!visited.has(parentId)) {
          visited.add(parentId);
          queue.push(parentId);
        }
      }
    }
  }

  return result;
}

/**
 * Топологическая сортировка задач и расчет слоев (rank) для слоистой визуализации графа на SVG.
 * Слой 0: задачи без зависимостей.
 * Слой k: max(слой_родителей) + 1.
 */
export interface GraphLayoutNode {
  task: Task;
  layer: number;
  orderInLayer: number;
}

export function computeGraphLayers(tasks: Task[]): {
  nodes: GraphLayoutNode[];
  layersCount: number;
} {
  const taskMap = new Map<string, Task>(tasks.map((t) => [t.id, t]));
  const layerMap = new Map<string, number>();

  // Мемоизированный подсчет глубины
  function getLayer(id: string, path = new Set<string>()): number {
    if (layerMap.has(id)) return layerMap.get(id)!;
    if (path.has(id)) return 0; // Защита от циклов

    path.add(id);
    const task = taskMap.get(id);
    if (!task || task.dependsOn.length === 0) {
      layerMap.set(id, 0);
      path.delete(id);
      return 0;
    }

    let maxParentLayer = -1;
    for (const depId of task.dependsOn) {
      maxParentLayer = Math.max(maxParentLayer, getLayer(depId, path));
    }

    const currentLayer = maxParentLayer + 1;
    layerMap.set(id, currentLayer);
    path.delete(id);
    return currentLayer;
  }

  for (const t of tasks) {
    getLayer(t.id);
  }

  // Группируем по слоям
  const layerBuckets = new Map<number, Task[]>();
  let maxLayer = 0;
  for (const t of tasks) {
    const l = layerMap.get(t.id) ?? 0;
    maxLayer = Math.max(maxLayer, l);
    const bucket = layerBuckets.get(l) || [];
    bucket.push(t);
    layerBuckets.set(l, bucket);
  }

  const nodes: GraphLayoutNode[] = [];
  for (let l = 0; l <= maxLayer; l++) {
    const list = layerBuckets.get(l) || [];
    // Сортируем внутри слоя по приоритету, затем по id
    list.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    list.forEach((task, idx) => {
      nodes.push({
        task,
        layer: l,
        orderInLayer: idx,
      });
    });
  }

  return {
    nodes,
    layersCount: maxLayer + 1,
  };
}
