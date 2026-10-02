/**
 * @file kanban-module/tests/core/parser.test.ts
 * @description Тест-кейс 11: Проверка детерминированного парсера планов.
 *
 * Сверяет парсинг всех 19 эталонных шаблонов из Приложения А с эталонной таблицей:
 * - Точные списки рёбер (A -> B);
 * - Списки задач для начального старта;
 * - Поддержка стрелок →, ->, =>;
 * - Поддержка русскоязычных ключевых слов (Задачи, Связи, Запусти).
 */

import { describe, it, expect } from 'vitest';
import { parsePlanText } from '../../src/core/planner-parser';
import starterTemplates from '../../src/templates/starter.json';

// Эталонная спецификация из таблицы Приложения А
const REFERENCE_GRAPHS: Record<number, { edges: string[]; start: string[] }> = {
  1: { edges: ['1->2', '2->3', '3->4', '4->5'], start: ['1'] },
  2: { edges: ['1->2', '2->3', '1->4'], start: ['1'] },
  3: { edges: ['1->2', '1->3', '1->4'], start: ['1'] },
  4: { edges: ['1->2', '2->3', '3->4', '2->5'], start: ['1'] },
  5: { edges: ['1->2', '2->3', '3->4', '4->5'], start: ['1'] },
  6: { edges: ['1->2', '1->3', '1->4'], start: ['1'] },
  7: { edges: ['1->3', '2->4'], start: ['1', '2'] },
  8: { edges: ['1->2', '2->3', '2->4'], start: ['1'] },
  9: { edges: ['1->2', '1->3', '2->4', '3->4'], start: ['1'] },
  10: { edges: ['1->2', '2->3', '1->4'], start: ['1'] },
  11: { edges: ['1->2', '2->3', '1->4'], start: ['1'] },
  12: { edges: ['1->2', '1->4', '2->3', '4->3'], start: ['1'] },
  13: { edges: ['1->2', '1->3', '1->4', '2->5', '3->5', '4->5'], start: ['1'] },
  14: { edges: ['1->2', '1->3', '1->4'], start: ['1'] },
  15: { edges: ['1->2', '2->3', '1->4'], start: ['1'] },
  16: { edges: ['1->2', '2->3', '1->4'], start: ['1'] },
  17: { edges: ['1->4', '2->4'], start: ['1', '2', '3', '4'] },
  18: { edges: ['1->2', '1->3', '3->4'], start: ['1'] },
  19: { edges: ['1->2', '1->3', '2->4', '3->4'], start: ['1'] },
};

describe('Кейс 11: Тестирование детерминированного парсера по эталонным графам', () => {
  starterTemplates.forEach((tpl) => {
    it(`Шаблон №${tpl.id} (${tpl.title}): граф и запуск совпадают с эталоном`, () => {
      const parsed = parsePlanText(tpl.prompt);
      const expected = REFERENCE_GRAPHS[Number(tpl.id)];

      expect(expected).toBeDefined();

      // Преобразуем разобранные связи в множество строк "from->to" для сравнения без учета порядка
      const parsedEdges = parsed.links.map((l) => `${l.from}->${l.to}`).sort();
      const expectedEdges = [...expected.edges].sort();

      expect(parsedEdges).toEqual(expectedEdges);

      // Сверяем стартовые задачи
      const parsedStart = [...parsed.start].sort();
      const expectedStart = [...expected.start].sort();

      expect(parsedStart).toEqual(expectedStart);
    });
  });

  describe('Вариации стрелок и русскоязычные формулировки', () => {
    it('поддерживает стрелки ->, => и unicode → в одном выражении', () => {
      const text = `
        Tasks: 1) A 2) B 3) C 4) D
        Link 1 -> 2, 2 => 3 and 3 → 4.
        Start task 1.
      `;
      const res = parsePlanText(text);
      expect(res.links.map((l) => `${l.from}->${l.to}`)).toEqual(['1->2', '2->3', '3->4']);
      expect(res.start).toEqual(['1']);
    });

    it('корректно разбирает русскоязычные промпты со словом "последовательно"', () => {
      const text = `
        Задачи:
        1) Создать базу данных
        2) Добавить API маршруты
        3) Написать тесты
        Связать их последовательно.
        Запусти задачу 1.
      `;
      const res = parsePlanText(text);
      expect(res.tasks.length).toBe(3);
      expect(res.links.map((l) => `${l.from}->${l.to}`)).toEqual(['1->2', '2->3']);
      expect(res.start).toEqual(['1']);
    });

    it('поддерживает запуск нескольких задач по-русски: "Запусти задачи 1 и 2"', () => {
      const text = `
        Задачи: 1) Шаг 1 2) Шаг 2 3) Шаг 3
        Связи: 1 -> 3, 2 -> 3.
        Запусти задачи 1 и 2.
      `;
      const res = parsePlanText(text);
      expect(res.start).toEqual(['1', '2']);
      expect(res.links.map((l) => `${l.from}->${l.to}`)).toEqual(['1->3', '2->3']);
    });

    it('поддерживает "Запусти все" / "Start all tasks"', () => {
      const text = `
        Tasks: 1) Task A 2) Task B 3) Task C
        Запусти все задачи.
      `;
      const res = parsePlanText(text);
      expect(res.start).toEqual(['1', '2', '3']);
    });
  });
});
