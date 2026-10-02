/**
 * @file kanban-module/src/planner/planner.ts
 * @description Единый сервис планирования задач.
 *
 * Логика работы:
 * 1. Проверяет, соответствует ли текст детерминированному формату (наличие "Tasks:", нумерации "1)", стрелок "->", "→").
 * 2. Если соответствует — мгновенно и без сетевых вызовов разбирает через детерминированный parsePlanText.
 * 3. Если это свободный текст цели пользователя и подключен PlannerAdapter (LLM) — выполняет декомпозицию через LLM.
 * 4. Если адаптер не подключен — возвращает детерминированный результат или предупреждение с инструкцией.
 */

import { PlanPreview } from '../core/types';
import { parsePlanText } from '../core/planner-parser';
import { PlannerAdapter, PlannerContext } from './types';

export class UnifiedPlanner {
  private adapter?: PlannerAdapter;

  constructor(adapter?: PlannerAdapter) {
    this.adapter = adapter;
  }

  setAdapter(adapter: PlannerAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Разбор текста цели или готового шаблона в превью плана.
   */
  async plan(input: string, context?: PlannerContext): Promise<PlanPreview> {
    const trimmed = input.trim();
    if (!trimmed) {
      return {
        tasks: [],
        links: [],
        start: [],
        warnings: ['Введен пустой запрос. Введите цель или выберите шаблон.'],
      };
    }

    // Проверяем признаки детерминированного шаблона:
    // Наличие "Tasks:"/"Задачи:" или явных маркеров списков "1)" и "2)"
    const isDeterministicPattern =
      /(?:Tasks|Задачи|Break it into tasks)[\s:]+/i.test(trimmed) ||
      (/(?:^|\s)1\)\s+/i.test(trimmed) && /(?:^|\s)2\)\s+/i.test(trimmed));

    if (isDeterministicPattern) {
      // Разбираем локальным быстрым парсером
      return parsePlanText(trimmed);
    }

    // Если это свободная цель и есть подключенный LLM-адаптер:
    if (this.adapter) {
      try {
        return await this.adapter.decompose(trimmed, context);
      } catch (err: any) {
        console.warn('[UnifiedPlanner] Ошибка LLM-адаптера:', err);
        // Запасной fallback: попытка разобрать парсером
        const fallback = parsePlanText(trimmed);
        fallback.warnings.push(`Ошибка LLM (${err.message}). План разобран базовым эвристическим парсером.`);
        return fallback;
      }
    }

    // Если адаптера нет, но пользователь ввел текст:
    const preview = parsePlanText(trimmed);
    if (preview.tasks.length === 0) {
      preview.warnings.push(
        'LLM-планировщик не подключен (свободные цели требуют PlannerAdapter). Используйте шаблоны из библиотеки или структурированный формат: "Tasks: 1) ... 2) ... Link 1 -> 2. Start task 1."'
      );
    }

    return preview;
  }
}
