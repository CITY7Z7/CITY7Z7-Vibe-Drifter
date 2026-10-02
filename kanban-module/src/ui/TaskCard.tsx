/**
 * @file kanban-module/src/ui/TaskCard.tsx
 * @description Компонент карточки задачи для Канбан-доски.
 *
 * Поддерживает:
 * - Нативный HTML5 Drag & Drop;
 * - Подсветку связанных предков и потомков при наведении курсора;
 * - Отображение статуса ожидания не запущенных зависимостей ("ждёт #N (не запущена)");
 * - Прогресс-бар исполнения и счетчик попыток;
 * - Быстрые действия (Start, Cancel, Retry, Approve).
 */

import React from 'react';
import { Task } from '../core/types';
import { Locale, translations } from './i18n';

export interface TaskCardProps {
  task: Task;
  allTasks: Task[];
  locale: Locale;
  isHovered: boolean;
  isAncestorOfHovered: boolean;
  isDescendantOfHovered: boolean;
  onHover: (id: string | null) => void;
  onClick: (task: Task) => void;
  onStart: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onApprove: (id: string) => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  allTasks,
  locale,
  isHovered,
  isAncestorOfHovered,
  isDescendantOfHovered,
  onHover,
  onClick,
  onStart,
  onCancel,
  onRetry,
  onApprove,
}) => {
  const t = translations[locale];

  // Проверяем, разрешен ли ручной drag из текущего статуса
  const isDraggable = ['backlog', 'in_progress', 'review'].includes(task.status);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ taskId: task.id, status: task.status }));
    e.dataTransfer.effectAllowed = 'move';
  };

  // Анализ зависимостей для понятного бейджа
  const taskMap = new Map(allTasks.map((item) => [item.id, item]));
  const uncompletedDeps = task.dependsOn
    .map((depId) => taskMap.get(depId))
    .filter((depTask): depTask is Task => Boolean(depTask && depTask.status !== 'done'));

  // Вычисление классов подсветки связей
  let highlightClass = 'border-slate-700 bg-slate-800/90 hover:border-slate-500';
  if (isHovered) {
    highlightClass = 'ring-2 ring-blue-500 border-blue-400 bg-slate-800 shadow-lg shadow-blue-500/10';
  } else if (isAncestorOfHovered) {
    highlightClass = 'border-amber-500/80 bg-amber-950/20 ring-1 ring-amber-500/50';
  } else if (isDescendantOfHovered) {
    highlightClass = 'border-cyan-500/80 bg-cyan-950/20 ring-1 ring-cyan-500/50';
  }

  // Расчет прогресса
  const progressPct =
    typeof task.meta?.progress === 'number'
      ? Math.min(100, Math.max(0, task.meta.progress))
      : task.status === 'done'
      ? 100
      : 0;

  return (
    <div
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onMouseEnter={() => onHover(task.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(task)}
      className={`kb-task-card group relative flex flex-col gap-2 rounded-lg border p-3.5 transition-all cursor-pointer select-none text-slate-100 ${highlightClass}`}
    >
      {/* Заголовок и ID карточки */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-mono font-medium text-slate-400">
          #{task.id.slice(-4)}
        </span>
        {task.priority > 0 && (
          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
            P{task.priority}
          </span>
        )}
      </div>

      <div className="text-sm font-medium leading-snug line-clamp-2 text-slate-100">
        {task.title}
      </div>

      {/* Метки (labels) */}
      {task.labels && task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {task.labels.slice(0, 3).map((l, idx) => (
            <span
              key={idx}
              className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-300"
            >
              {l}
            </span>
          ))}
        </div>
      )}

      {/* Индикация ожидания зависимостей */}
      {uncompletedDeps.length > 0 && (
        <div className="rounded bg-amber-950/40 border border-amber-800/40 p-1.5 text-[11px] text-amber-300">
          <div className="font-semibold flex items-center gap-1">
            <svg className="w-3 h-3 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t.waitingDeps}
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {uncompletedDeps.map((dep) => (
              <span
                key={dep.id}
                className="rounded bg-amber-900/60 px-1 py-0.2 text-[10px] font-mono text-amber-200"
              >
                #{dep.id.slice(-4)}
                {dep.status === 'backlog' ? ' (не запущена)' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Прогресс-бар выполнения задачи */}
      {task.status === 'in_progress' && (
        <div className="mt-1 flex flex-col gap-1">
          <div className="flex justify-between text-[10px] text-blue-300 font-mono">
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping"></span>
              {task.executor || 'mock'}
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Попытки и ошибки */}
      {task.status === 'failed' && (
        <div className="rounded bg-rose-950/40 border border-rose-800/40 p-1.5 text-[11px] text-rose-300 line-clamp-2">
          {task.error || 'Ошибка исполнения'}
        </div>
      )}

      {/* Нижняя панель действий */}
      <div className="mt-1 flex items-center justify-between pt-1 border-t border-slate-700/60 text-[11px] text-slate-400">
        <div className="flex items-center gap-1">
          {task.attempts > 0 && (
            <span className="font-mono text-[10px]">
              {t.attempts}: {task.attempts}/{task.maxAttempts}
            </span>
          )}
        </div>

        {/* Быстрые кнопки прямо на карточке */}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {task.status === 'backlog' && (
            <button
              onClick={() => onStart(task.id)}
              className="rounded bg-emerald-600/80 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              {t.start}
            </button>
          )}

          {task.status === 'in_progress' && (
            <button
              onClick={() => onCancel(task.id)}
              className="rounded bg-slate-700 px-2 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-900/60 transition-colors"
            >
              {t.cancel}
            </button>
          )}

          {task.status === 'failed' && (
            <button
              onClick={() => onRetry(task.id)}
              className="rounded bg-amber-600/80 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-500 transition-colors"
            >
              {t.retry}
            </button>
          )}

          {task.status === 'review' && (
            <button
              onClick={() => onApprove(task.id)}
              className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500 transition-colors"
            >
              {t.approve}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
