/**
 * @file kanban-module/tests/core/graph.test.ts
 * @description Тест-кейс 1: Валидация ориентированного ациклического графа (DAG).
 *
 * Проверяет:
 * - Отклонение самосвязи (A -> A);
 * - Отклонение ссылки на несуществующую карточку;
 * - Отклонение циклов любой длины (A -> B -> C -> A);
 * - Запрет изменения связей у выполняющихся (in_progress) и завершенных (done) задач;
 * - Валидацию допустимых ручных переходов статусов.
 */

import { describe, it, expect } from 'vitest';
import {
  validateNewLink,
  validateGraphAcyclic,
  validateManualTransition,
  hasPath,
  computeGraphLayers,
  GraphValidationError,
  InvalidTransitionError,
} from '../../src/core/graph';
import { Task } from '../../src/core/types';

function createDummyTask(id: string, dependsOn: string[] = [], status: Task['status'] = 'backlog'): Task {
  return {
    id,
    boardId: 'test-board',
    title: `Task ${id}`,
    prompt: `Do task ${id}`,
    status,
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
  };
}

describe('Кейс 1: Граф зависимостей и валидация циклов', () => {
  it('отклоняет самосвязь (задача не может зависеть от самой себя)', () => {
    const taskA = createDummyTask('A');
    expect(() => {
      validateNewLink('A', 'A', [taskA]);
    }).toThrow(GraphValidationError);
  });

  it('отклоняет связь с несуществующей карточкой', () => {
    const taskA = createDummyTask('A');
    expect(() => {
      validateNewLink('NON_EXISTENT', 'A', [taskA]);
    }).toThrow(GraphValidationError);

    expect(() => {
      validateNewLink('A', 'NON_EXISTENT', [taskA]);
    }).toThrow(GraphValidationError);
  });

  it('отклоняет создание прямого цикла из двух задач (A -> B -> A)', () => {
    const taskA = createDummyTask('A');
    const taskB = createDummyTask('B', ['A']); // B зависит от A
    const all = [taskA, taskB];

    // Попытка сделать так, чтобы A зависела от B (B -> A)
    expect(() => {
      validateNewLink('B', 'A', all);
    }).toThrow(GraphValidationError);
  });

  it('отклоняет создание длинного цикла (A → B → C → A)', () => {
    const taskA = createDummyTask('A');
    const taskB = createDummyTask('B', ['A']); // A -> B
    const taskC = createDummyTask('C', ['B']); // B -> C
    const all = [taskA, taskB, taskC];

    // Проверяем путь
    expect(hasPath('A', 'C', all)).toBe(true);

    // Попытка добавить ребро C -> A (A зависит от C) должна быть отклонена
    expect(() => {
      validateNewLink('C', 'A', all);
    }).toThrow(GraphValidationError);
  });

  it('запрещает менять связи у карточек в статусе in_progress и done', () => {
    const taskDone = createDummyTask('DONE', [], 'done');
    const taskInProgress = createDummyTask('IN_PROG', [], 'in_progress');
    const taskA = createDummyTask('A');

    expect(() => {
      validateNewLink('A', 'DONE', [taskA, taskDone]);
    }).toThrow(GraphValidationError);

    expect(() => {
      validateNewLink('A', 'IN_PROG', [taskA, taskInProgress]);
    }).toThrow(GraphValidationError);
  });

  it('функция validateGraphAcyclic успешно пропускает валидный DAG', () => {
    const t1 = createDummyTask('1');
    const t2 = createDummyTask('2', ['1']);
    const t3 = createDummyTask('3', ['1']);
    const t4 = createDummyTask('4', ['2', '3']);

    expect(() => {
      validateGraphAcyclic([t1, t2, t3, t4]);
    }).not.toThrow();
  });

  it('функция validateGraphAcyclic обнаруживает цикл в полном наборе задач', () => {
    const t1 = createDummyTask('1', ['3']);
    const t2 = createDummyTask('2', ['1']);
    const t3 = createDummyTask('3', ['2']);

    expect(() => {
      validateGraphAcyclic([t1, t2, t3]);
    }).toThrow(GraphValidationError);
  });

  it('корректно рассчитывает топологические слои (computeGraphLayers)', () => {
    const t1 = createDummyTask('1');
    const t2 = createDummyTask('2', ['1']);
    const t3 = createDummyTask('3', ['1']);
    const t4 = createDummyTask('4', ['2', '3']);

    const { nodes, layersCount } = computeGraphLayers([t1, t2, t3, t4]);
    expect(layersCount).toBe(3); // Слой 0: t1, Слой 1: t2, t3, Слой 2: t4

    const node1 = nodes.find((n) => n.task.id === '1');
    const node2 = nodes.find((n) => n.task.id === '2');
    const node3 = nodes.find((n) => n.task.id === '3');
    const node4 = nodes.find((n) => n.task.id === '4');

    expect(node1?.layer).toBe(0);
    expect(node2?.layer).toBe(1);
    expect(node3?.layer).toBe(1);
    expect(node4?.layer).toBe(2);
  });
});

describe('Валидация ручных переходов карточек', () => {
  it('разрешает допустимые переходы', () => {
    expect(() => validateManualTransition('backlog', 'ready')).not.toThrow();
    expect(() => validateManualTransition('in_progress', 'backlog')).not.toThrow();
    expect(() => validateManualTransition('review', 'done')).not.toThrow();
    expect(() => validateManualTransition('review', 'ready')).not.toThrow();
    expect(() => validateManualTransition('backlog', 'backlog')).not.toThrow();
  });

  it('отклоняет недопустимые переходы с информативной ошибкой', () => {
    expect(() => validateManualTransition('backlog', 'done')).toThrow(InvalidTransitionError);
    expect(() => validateManualTransition('ready', 'done')).toThrow(InvalidTransitionError);
    expect(() => validateManualTransition('blocked', 'done')).toThrow(InvalidTransitionError);
    expect(() => validateManualTransition('failed', 'done')).toThrow(InvalidTransitionError);
  });
});
