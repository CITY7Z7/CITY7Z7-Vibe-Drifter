/**
 * @file kanban-module/src/ui/Column.tsx
 * @description Компонент колонки Канбан-доски.
 *
 * Особенности:
 * - Поддерживает нативный HTML5 Drop с проверкой разрешенных переходов;
 * - Возможность сворачивания для колонок Failed и Blocked;
 * - Цветовая дифференциация заголовков по статусам;
 * - Подсчет количества карточек.
 */

import React, { useState } from 'react';
import { Task, TaskStatus } from '../core/types';
import { TaskCard } from './TaskCard';
import { Locale, translations } from './i18n';

export interface ColumnProps {
  status: TaskStatus;
  title: string;
  tasks: Task[];
  allTasks: Task[];
  locale: Locale;
  collapsible?: boolean;
  hoveredTaskId: string | null;
  highlightedAncestors: string[];
  highlightedDescendants: string[];
  onHover: (id: string | null) => void;
  onSelectTask: (task: Task) => void;
  onMoveTask: (taskId: string, targetStatus: TaskStatus) => void;
  onStartTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
  onRetryTask: (taskId: string) => void;
  onApproveTask: (taskId: string) => void;
}

const statusHeaderColors: Record<TaskStatus, { border: string; dot: string; bg: string }> = {
  backlog: { border: 'border-slate-600', dot: 'bg-slate-400', bg: 'bg-slate-900/60' },
  ready: { border: 'border-amber-600', dot: 'bg-amber-400', bg: 'bg-slate-900/60' },
  in_progress: { border: 'border-blue-600', dot: 'bg-blue-400', bg: 'bg-slate-900/60' },
  review: { border: 'border-purple-600', dot: 'bg-purple-400', bg: 'bg-slate-900/60' },
  done: { border: 'border-emerald-600', dot: 'bg-emerald-400', bg: 'bg-slate-900/60' },
  failed: { border: 'border-rose-600', dot: 'bg-rose-400', bg: 'bg-slate-900/60' },
  blocked: { border: 'border-orange-600', dot: 'bg-orange-400', bg: 'bg-slate-900/60' },
};

export const Column: React.FC<ColumnProps> = ({
  status,
  title,
  tasks,
  allTasks,
  locale,
  collapsible = false,
  hoveredTaskId,
  highlightedAncestors,
  highlightedDescendants,
  onHover,
  onSelectTask,
  onMoveTask,
  onStartTask,
  onCancelTask,
  onRetryTask,
  onApproveTask,
}) => {
  const t = translations[locale];
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const colors = statusHeaderColors[status] || statusHeaderColors.backlog;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return;
      const data = JSON.parse(dataStr);
      if (data && data.taskId) {
        onMoveTask(data.taskId, status);
      }
    } catch (err) {
      console.error('Ошибка обработки Drop:', err);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`kb-column flex flex-col rounded-xl border ${colors.border} ${colors.bg} p-3 transition-colors min-w-[270px] max-w-[340px] flex-1 ${
        isDragOver ? 'ring-2 ring-blue-500 bg-slate-800/80' : ''
      }`}
    >
      {/* Заголовок колонки */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${colors.dot}`} />
          <h3 className="text-sm font-semibold text-slate-200 tracking-wide">{title}</h3>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-400">
            {tasks.length}
          </span>
        </div>

        {collapsible && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors text-xs"
            title={isCollapsed ? 'Развернуть' : 'Свернуть'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
        )}
      </div>

      {/* Список карточек */}
      {!isCollapsed && (
        <div className="flex flex-col gap-2.5 pt-3 overflow-y-auto flex-1 max-h-[calc(100vh-280px)] min-h-[120px]">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800/80 rounded-lg">
              {t.noTasks}
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                allTasks={allTasks}
                locale={locale}
                isHovered={hoveredTaskId === task.id}
                isAncestorOfHovered={highlightedAncestors.includes(task.id)}
                isDescendantOfHovered={highlightedDescendants.includes(task.id)}
                onHover={onHover}
                onClick={onSelectTask}
                onStart={onStartTask}
                onCancel={onCancelTask}
                onRetry={onRetryTask}
                onApprove={onApproveTask}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
