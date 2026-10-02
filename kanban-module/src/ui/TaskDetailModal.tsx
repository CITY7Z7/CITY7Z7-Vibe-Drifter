/**
 * @file kanban-module/src/ui/TaskDetailModal.tsx
 * @description Детальная панель / модальное окно выбранной задачи.
 *
 * Предоставляет:
 * - Полный просмотр и редактирование параметров задачи;
 * - Управление связями (добавление и удаление зависимостей);
 * - Живой консольный журнал (Live Log) с автоскроллом;
 * - Просмотр JSON-результата выполнения и текста ошибок;
 * - Действия жизненного цикла: Start, Cancel, Retry, Approve, Reject, Delete.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Task } from '../core/types';
import { Locale, translations } from './i18n';

export interface TaskDetailModalProps {
  task: Task | null;
  allTasks: Task[];
  locale: Locale;
  onClose: () => void;
  onStart: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string, comment?: string) => void;
  onDelete: (id: string) => void;
  onAddDependency: (taskId: string, depId: string) => void;
  onRemoveDependency: (taskId: string, depId: string) => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  allTasks,
  locale,
  onClose,
  onStart,
  onCancel,
  onRetry,
  onApprove,
  onReject,
  onDelete,
  onAddDependency,
  onRemoveDependency,
}) => {
  const t = translations[locale];
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [selectedDepToAdd, setSelectedDepToAdd] = useState('');
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Автоскролл логов при добавлении новых строк
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [task?.log]);

  if (!task) return null;

  const taskMap = new Map(allTasks.map((item) => [item.id, item]));

  // Список задач, которые можно добавить в зависимости (исключая саму себя и уже добавленные)
  const availableCandidatesForDep = allTasks.filter(
    (tCandidate) => tCandidate.id !== task.id && !task.dependsOn.includes(tCandidate.id)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="flex flex-col max-h-[90vh] w-full max-w-3xl rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden">
        {/* Шапка модального окна */}
        <div className="flex items-center justify-between border-b border-slate-800 p-4 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-sm font-bold text-blue-400">#{task.id.slice(-6)}</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                task.status === 'done'
                  ? 'bg-emerald-950 border border-emerald-700/60 text-emerald-300'
                  : task.status === 'in_progress'
                  ? 'bg-blue-950 border border-blue-700/60 text-blue-300'
                  : task.status === 'failed'
                  ? 'bg-rose-950 border border-rose-700/60 text-rose-300'
                  : task.status === 'review'
                  ? 'bg-purple-950 border border-purple-700/60 text-purple-300'
                  : task.status === 'blocked'
                  ? 'bg-orange-950 border border-orange-700/60 text-orange-300'
                  : 'bg-slate-800 border border-slate-700 text-slate-300'
              }`}
            >
              {task.status.replace('_', ' ')}
            </span>
          </div>

          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Тело модального окна */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Заголовок */}
          <div>
            <h2 className="text-lg font-bold text-slate-100">{task.title}</h2>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
              <span>Приоритет: P{task.priority}</span>
              <span>•</span>
              <span>Исполнитель: {task.executor || 'по умолчанию (mock)'}</span>
              <span>•</span>
              <span>
                Попытки: {task.attempts}/{task.maxAttempts}
              </span>
              <span>•</span>
              <span>Таймаут: {task.timeoutMs}ms</span>
            </div>
          </div>

          {/* Инструкция (Prompt) */}
          <div className="rounded-lg bg-slate-950 p-3.5 border border-slate-800">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Инструкция исполнителю (Prompt):
            </h4>
            <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
              {task.prompt}
            </p>
          </div>

          {/* Зависимости (Depends On) */}
          <div className="rounded-lg bg-slate-950 p-3.5 border border-slate-800">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Зависимости карточки (Depends On):
            </h4>

            {task.dependsOn.length === 0 ? (
              <p className="text-xs text-slate-500">Нет зависимостей — карточка независима.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {task.dependsOn.map((depId) => {
                  const depTask = taskMap.get(depId);
                  return (
                    <div
                      key={depId}
                      className="flex items-center gap-2 rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-200 border border-slate-700"
                    >
                      <span className="font-mono text-blue-400">#{depId.slice(-4)}</span>
                      <span>{depTask ? depTask.title : depId}</span>
                      <span
                        className={`text-[10px] font-mono ${
                          depTask?.status === 'done' ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        ({depTask?.status || 'unknown'})
                      </span>
                      {['backlog', 'ready', 'failed', 'blocked'].includes(task.status) && (
                        <button
                          onClick={() => onRemoveDependency(task.id, depId)}
                          className="text-slate-400 hover:text-rose-400 font-bold ml-1"
                          title="Удалить зависимость"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Добавление новой зависимости */}
            {['backlog', 'ready'].includes(task.status) && availableCandidatesForDep.length > 0 && (
              <div className="mt-3 flex items-center gap-2 pt-2 border-t border-slate-800/80">
                <select
                  value={selectedDepToAdd}
                  onChange={(e) => setSelectedDepToAdd(e.target.value)}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="">-- Выберите задачу для добавления зависимости --</option>
                  {availableCandidatesForDep.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      #{candidate.id.slice(-4)} {candidate.title}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!selectedDepToAdd}
                  onClick={() => {
                    if (selectedDepToAdd) {
                      onAddDependency(task.id, selectedDepToAdd);
                      setSelectedDepToAdd('');
                    }
                  }}
                  className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
                >
                  + Добавить связь
                </button>
              </div>
            )}
          </div>

          {/* Текст ошибки (если статус failed) */}
          {task.error && (
            <div className="rounded-lg bg-rose-950/40 border border-rose-800/60 p-3 text-xs text-rose-200">
              <div className="font-semibold text-rose-300 mb-1">{t.error}:</div>
              <div className="font-mono text-[11px] whitespace-pre-wrap">{task.error}</div>
            </div>
          )}

          {/* Результат выполнения (JSON) */}
          {task.result !== undefined && (
            <div className="rounded-lg bg-slate-950 p-3.5 border border-slate-800">
              <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
                {t.result}:
              </h4>
              <pre className="max-h-40 overflow-auto rounded bg-slate-900 p-2.5 text-[11px] font-mono text-emerald-300">
                {JSON.stringify(task.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Живой лог (Live Logs) */}
          <div className="rounded-lg bg-slate-950 p-3.5 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {t.logs}
              </h4>
              <span className="font-mono text-[10px] text-slate-500">
                {task.log.length} записей
              </span>
            </div>

            <div
              ref={logContainerRef}
              className="max-h-48 overflow-y-auto rounded bg-black/60 p-2.5 font-mono text-[11px] text-slate-300 space-y-1 select-text"
            >
              {task.log.length === 0 ? (
                <div className="text-slate-600 italic">Логи пока отсутствуют...</div>
              ) : (
                task.log.map((line, idx) => (
                  <div key={idx} className="leading-relaxed">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Подвал с кнопками действий */}
        <div className="border-t border-slate-800 p-4 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => {
              if (confirm('Вы уверены, что хотите удалить эту задачу?')) {
                onDelete(task.id);
                onClose();
              }
            }}
            className="rounded px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-950/50 hover:text-rose-300 transition-colors"
          >
            {t.delete}
          </button>

          <div className="flex items-center gap-2">
            {task.status === 'backlog' && (
              <button
                onClick={() => {
                  onStart(task.id);
                  onClose();
                }}
                className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm"
              >
                {t.start}
              </button>
            )}

            {task.status === 'in_progress' && (
              <button
                onClick={() => {
                  onCancel(task.id);
                  onClose();
                }}
                className="rounded bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 transition-colors shadow-sm"
              >
                {t.cancel}
              </button>
            )}

            {task.status === 'failed' && (
              <button
                onClick={() => {
                  onRetry(task.id);
                  onClose();
                }}
                className="rounded bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 transition-colors shadow-sm"
              >
                {t.retry}
              </button>
            )}

            {task.status === 'review' && (
              <div className="flex items-center gap-2">
                {!showRejectInput ? (
                  <>
                    <button
                      onClick={() => setShowRejectInput(true)}
                      className="rounded bg-slate-800 px-3 py-1.5 text-xs text-amber-300 hover:bg-slate-700 transition-colors border border-amber-800/40"
                    >
                      {t.reject}
                    </button>
                    <button
                      onClick={() => {
                        onApprove(task.id);
                        onClose();
                      }}
                      className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm"
                    >
                      {t.approve}
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Комментарий к доработке..."
                      value={rejectComment}
                      onChange={(e) => setRejectComment(e.target.value)}
                      className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100"
                    />
                    <button
                      onClick={() => {
                        onReject(task.id, rejectComment);
                        setShowRejectInput(false);
                        onClose();
                      }}
                      className="rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-500"
                    >
                      Подтвердить
                    </button>
                    <button
                      onClick={() => setShowRejectInput(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={onClose}
              className="rounded bg-slate-800 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
            >
              {t.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
