/**
 * @file kanban-module/src/core/planner-parser.ts
 * @description Детерминированный парсер текста промптов и шаблонов в граф задач.
 *
 * Работает без обращения к LLM. Разбирает формат:
 * - Задачи: 1) ... 2) ... 3) ... после слова "Tasks:" или "Задачи:"
 * - Связи со стрелками (→, ->, =>): "1 → 2 → 3", "1 -> 2, 1 -> 3", "2 => 5 and 3 => 5"
 * - Фразы связывания: "Link them sequentially", "последовательно", "run N in parallel after M"
 * - Инструкции старта: "Start task 1", "Start tasks 1 and 2", "Start all tasks", "Запусти задачу 1", "Запусти все"
 */

import { PlanPreview } from './types';

export interface ParseOptions {
  defaultTitleMaxLen?: number;
}

/**
 * Нормализует стрелки зависимостей к единому символу '->'.
 */
function normalizeArrows(text: string): string {
  return text
    .replace(/→/g, '->')
    .replace(/=>/g, '->');
}

/**
 * Парсер детерминированных планов из текстового описания или шаблона.
 */
export function parsePlanText(input: string, options: ParseOptions = {}): PlanPreview {
  const warnings: string[] = [];
  const normalized = normalizeArrows(input.trim());

  // 1. Извлечение блока задач
  // Ищем маркер "Tasks:" или "Задачи:" (регистронезависимо)
  const taskMarkerRegex = /(?:Tasks|Задачи|Break it into tasks|Задачи проекта)[\s:]+/i;
  const markerMatch = normalized.search(taskMarkerRegex);

  let tasksBlock = normalized;
  let remainingAfterTasks = '';

  if (markerMatch !== -1) {
    const afterMarker = normalized.slice(markerMatch).replace(taskMarkerRegex, '');
    // Находим где заканчивается блок задач (обычно перед "Link", "Связи", "Связать", "Run", "Start", "Запусти")
    const linkMarkerRegex = /(?:\n\s*|\.\s+)(?:Link|Связи|Связать|Run\s+\d|Start|Запусти)/i;
    const linkMatch = afterMarker.search(linkMarkerRegex);

    if (linkMatch !== -1) {
      tasksBlock = afterMarker.slice(0, linkMatch);
      remainingAfterTasks = afterMarker.slice(linkMatch);
    } else {
      tasksBlock = afterMarker;
    }
  } else {
    // Если маркера нет, проверяем, есть ли шаблон нумерации 1) ... 2) ...
    const firstNumbered = normalized.search(/(?:^|\s)1\)\s+/);
    if (firstNumbered !== -1) {
      const linkMarkerRegex = /(?:\n\s*|\.\s+)(?:Link|Связи|Связать|Run\s+\d|Start|Запусти)/i;
      const linkMatch = normalized.slice(firstNumbered).search(linkMarkerRegex);
      if (linkMatch !== -1) {
        tasksBlock = normalized.slice(firstNumbered, firstNumbered + linkMatch);
        remainingAfterTasks = normalized.slice(firstNumbered + linkMatch);
      } else {
        tasksBlock = normalized.slice(firstNumbered);
      }
    } else {
      warnings.push('Не найден явный блок задач (Tasks: 1) ... 2) ...).');
    }
  }

  // 2. Разбор задач по номерам 1) ... 2) ...
  const taskItems: Array<{ id: string; title: string; prompt: string }> = [];
  // Регулярное выражение для поиска "1) текст", "2) текст"
  const itemRegex = /(?:^|\s)(\d+)\)\s+([\s\S]*?)(?=(?:\s+\d+\)|\s*$))/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(tasksBlock)) !== null) {
    const id = match[1];
    const fullText = match[2].trim().replace(/\s+/g, ' ');
    if (!fullText) continue;

    // Генерируем заголовок задачи: первое предложение или до 80 символов
    const titleMax = options.defaultTitleMaxLen || 80;
    let title = fullText;
    const firstDot = fullText.indexOf('.');
    const firstComma = fullText.indexOf(',');
    const breakPos = firstDot !== -1 ? firstDot : firstComma;

    if (breakPos > 0 && breakPos <= titleMax) {
      title = fullText.slice(0, breakPos).trim();
    } else if (fullText.length > titleMax) {
      title = fullText.slice(0, titleMax).trim() + '…';
    }

    taskItems.push({
      id,
      title,
      prompt: fullText,
    });
  }

  const taskIds = new Set(taskItems.map((t) => t.id));

  // 3. Разбор связей (Edges)
  const linksSet = new Set<string>(); // "from->to" для дедупликации
  const links: Array<{ from: string; to: string }> = [];

  function addLink(from: string, to: string) {
    if (from === to) {
      warnings.push(`Игнорирована недопустимая самосвязь ${from} -> ${to}.`);
      return;
    }
    if (!taskIds.has(from)) {
      warnings.push(`Связь ссылается на неизвестную задачу #${from}.`);
    }
    if (!taskIds.has(to)) {
      warnings.push(`Связь ссылается на неизвестную задачу #${to}.`);
    }
    const key = `${from}->${to}`;
    if (!linksSet.has(key)) {
      linksSet.add(key);
      links.push({ from, to });
    }
  }

  // Текст для анализа связей
  const textForLinks = remainingAfterTasks || normalized;

  // А. Проверка последовательного связывания: "Link them sequentially", "последовательно"
  // Но только если после слова sequentially нет явных стрелок (например: "Link sequentially 1 -> 2 -> ...")
  const hasSeqPhrase =
    /link\s+them\s+sequentially/i.test(textForLinks) ||
    /связать\s+(?:их\s+)?последовательно/i.test(textForLinks) ||
    /последовательно/i.test(textForLinks);

  const hasExplicitSeqArrows = /link\s+sequentially\s+\d+\s*->/i.test(textForLinks);

  if (hasSeqPhrase && !hasExplicitSeqArrows) {
    for (let i = 0; i < taskItems.length - 1; i++) {
      addLink(taskItems[i].id, taskItems[i + 1].id);
    }
  }

  // Б. Поиск цепочек со стрелками, например: "1 -> 2 -> 3 -> 4" или "1 -> 2"
  // Ищем фрагменты вида \d+\s*(?:->\s*\d+)+
  const arrowChainRegex = /\b\d+(?:\s*->\s*\d+)+\b/g;
  let chainMatch: RegExpExecArray | null;

  while ((chainMatch = arrowChainRegex.exec(textForLinks)) !== null) {
    const chainStr = chainMatch[0];
    const parts = chainStr.split('->').map((p) => p.trim());
    for (let i = 0; i < parts.length - 1; i++) {
      addLink(parts[i], parts[i + 1]);
    }
  }

  // В. Поиск паттерна "run N in parallel after M" или "run 4 in parallel after 1"
  // или "run 1, 2, and 3 in parallel"
  const runAfterRegex = /run\s+([\d\s,and]+)\s+in\s+parallel\s+after\s+(\d+)/gi;
  let runMatch: RegExpExecArray | null;
  while ((runMatch = runAfterRegex.exec(textForLinks)) !== null) {
    const targetsStr = runMatch[1];
    const parentId = runMatch[2];
    const targets = targetsStr.match(/\d+/g) || [];
    for (const target of targets) {
      addLink(parentId, target);
    }
  }

  // 4. Разбор списка задач для старта
  let startTasks: string[] = [];

  // Проверка на "Start all tasks" / "Запусти все"
  const startAllRegex = /(?:start\s+all\s+tasks|запусти(?:ть)?\s+все(?:\s+задачи)?)/i;
  if (startAllRegex.test(textForLinks)) {
    startTasks = taskItems.map((t) => t.id);
  } else {
    // Поиск конкретных номеров: "Start task 1", "Start tasks 1 and 2", "Запусти задачу 1", "Start tasks 1, 2"
    const startSpecificRegex = /(?:Start\s+tasks?|Запусти(?:ть)?(?:\s+задач[уи])?)\s+([\d\s,andи]+)/i;
    const startMatch = textForLinks.match(startSpecificRegex);

    if (startMatch) {
      const numbers = startMatch[1].match(/\d+/g);
      if (numbers && numbers.length > 0) {
        startTasks = Array.from(new Set(numbers));
      }
    }
  }

  // Если список запуска пуст, но задачи есть — по умолчанию стартуем первую задачу или задачи с нулевой in-degree
  if (startTasks.length === 0 && taskItems.length > 0) {
    // Если есть задачи без входящих зависимостей:
    const targetIds = new Set(links.map((l) => l.to));
    const roots = taskItems.map((t) => t.id).filter((id) => !targetIds.has(id));
    if (roots.length > 0) {
      startTasks = [roots[0]];
    } else {
      startTasks = [taskItems[0].id];
    }
  }

  // Проверка на циклы в разобранном графе
  if (detectCycleInLinks(links)) {
    warnings.push('Внимание: в разобранном графе связей обнаружен цикл!');
  }

  return {
    tasks: taskItems,
    links,
    start: startTasks,
    warnings,
  };
}

/**
 * Простая проверка наличия цикла в списке связей { from, to }.
 */
function detectCycleInLinks(links: Array<{ from: string; to: string }>): boolean {
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();

  for (const l of links) {
    nodes.add(l.from);
    nodes.add(l.to);
    const list = adj.get(l.from) || [];
    list.push(l.to);
    adj.set(l.from, list);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(curr: string): boolean {
    visited.add(curr);
    recStack.add(curr);

    const neighbors = adj.get(curr) || [];
    for (const n of neighbors) {
      if (!visited.has(n)) {
        if (dfs(n)) return true;
      } else if (recStack.has(n)) {
        return true;
      }
    }

    recStack.delete(curr);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node)) {
      if (dfs(node)) return true;
    }
  }

  return false;
}
