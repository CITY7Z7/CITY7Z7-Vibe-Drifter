/**
 * @file kanban-module/src/planner/prompt.ts
 * @description Строгая JSON-схема и системный промпт для декомпозиции целей через LLM.
 */

import { z } from 'zod';
import { PlanPreview } from '../core/types';

/**
 * Zod-схема валидации ответа LLM-планировщика.
 */
export const PlanPreviewSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().describe('Уникальный номер или строковый ID (1, 2, ...)'),
      title: z.string().min(1).max(120).describe('Краткий понятный заголовок задачи'),
      prompt: z.string().min(1).describe('Полная инструкция исполнителю по реализации задачи'),
      labels: z.array(z.string()).optional(),
    })
  ).min(1, 'План должен содержать хотя бы одну задачу'),
  links: z.array(
    z.object({
      from: z.string().describe('ID задачи-предшественника'),
      to: z.string().describe('ID зависимой задачи (ждет завершения from)'),
    })
  ),
  start: z.array(z.string()).min(1, 'Необходимо указать хотя бы одну задачу для начального старта'),
  warnings: z.array(z.string()).default([]),
});

/**
 * Системный промпт для LLM с четкой схемой и примером.
 */
export const PLANNER_SYSTEM_PROMPT = `
Ты — интеллектуальный архитектор задач и оркестратор графов зависимостей (DAG).
Твоя задача: взять цель пользователя и разложить её на оптимальный набор связанных задач.

ПРАВИЛА ПОСТРОЕНИЯ ГРАФА:
1. Независимые задачи должны выполняться ПАРАЛЛЕЛЬНО (веерное ветвление: 1 -> 2, 1 -> 3).
2. Задачи, зависящие от нескольких результатов, должны ожидать их завершения (схождение: 2 -> 4, 3 -> 4).
3. Граф обязан быть строго ациклическим (DAG). Самосвязи и циклы строго запрещены.
4. В списке "start" укажи ID задач первого уровня, которые должны стартовать сразу.
5. Ответ ДОЛЖЕН БЫТЬ ТОЛЬКО чистым валидным JSON без маркдаун-оберток (\`\`\`json).

ФОРМАТ ОТВЕТА (JSON):
{
  "tasks": [
    {
      "id": "1",
      "title": "Инициализация проекта",
      "prompt": "Настроить Express, TypeScript, tsconfig.json и eslint",
      "labels": ["setup", "backend"]
    },
    {
      "id": "2",
      "title": "Модели данных и БД",
      "prompt": "Создать подключение к SQLite и таблицу пользователей",
      "labels": ["database"]
    },
    {
      "id": "3",
      "title": "REST API маршруты",
      "prompt": "Реализовать эндпоинты GET, POST, PUT, DELETE /users",
      "labels": ["api"]
    }
  ],
  "links": [
    { "from": "1", "to": "2" },
    { "from": "2", "to": "3" }
  ],
  "start": ["1"],
  "warnings": []
}
`.trim();

/**
 * Валидирует и нормализует сырой JSON-ответ от LLM.
 */
export function validateAndCleanPlan(raw: unknown): PlanPreview {
  const parsed = PlanPreviewSchema.parse(raw);

  // Валидируем целостность ссылок
  const taskIds = new Set(parsed.tasks.map((t) => t.id));
  const validLinks: typeof parsed.links = [];
  const warnings = [...parsed.warnings];

  for (const l of parsed.links) {
    if (l.from === l.to) {
      warnings.push(`Самосвязь ${l.from} -> ${l.to} удалена.`);
      continue;
    }
    if (!taskIds.has(l.from)) {
      warnings.push(`Ссылка на несуществующую задачу-источник #${l.from}.`);
      continue;
    }
    if (!taskIds.has(l.to)) {
      warnings.push(`Ссылка на несуществующую зависимую задачу #${l.to}.`);
      continue;
    }
    validLinks.push(l);
  }

  // Фильтруем стартовый список
  const validStart = parsed.start.filter((id) => taskIds.has(id));
  if (validStart.length === 0 && parsed.tasks.length > 0) {
    validStart.push(parsed.tasks[0].id);
  }

  return {
    tasks: parsed.tasks,
    links: validLinks,
    start: validStart,
    warnings,
  };
}
