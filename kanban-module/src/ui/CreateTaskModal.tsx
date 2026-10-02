/**
 * @file kanban-module/src/ui/CreateTaskModal.tsx
 * @description Модальное окно ручного создания новой задачи на доске.
 */

import React, { useState } from 'react';
import { Task } from '../core/types';
import { Locale, translations } from './i18n';

export interface CreateTaskModalProps {
  isOpen: boolean;
  allTasks: Task[];
  locale: Locale;
  onClose: () => void;
  onCreate: (task: Partial<Task>) => void;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  allTasks,
  locale,
  onClose,
  onCreate,
}) => {
  const t = translations[locale];
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [priority, setPriority] = useState(0);
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [requireReview, setRequireReview] = useState(false);
  const [executor, setExecutor] = useState('mock');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !prompt.trim()) return;

    onCreate({
      title: title.trim(),
      prompt: prompt.trim(),
      priority,
      dependsOn: selectedDeps,
      requireReview,
      executor: executor || 'mock',
      status: 'backlog',
    });

    setTitle('');
    setPrompt('');
    setPriority(0);
    setSelectedDeps([]);
    setRequireReview(false);
  };

  const toggleDep = (id: string) => {
    setSelectedDeps((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="flex flex-col w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 p-4 bg-slate-950/60">
          <h2 className="text-sm font-bold text-slate-100">{t.addTask}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Заголовок задачи:</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Разработать модуль авторизации"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Инструкция исполнителю (Prompt):
            </label>
            <textarea
              required
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Подробное техническое задание для исполнителя карточки..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Приоритет:</label>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100 focus:outline-none"
              >
                <option value={0}>Обычный (P0)</option>
                <option value={1}>Средний (P1)</option>
                <option value={2}>Высокий (P2)</option>
                <option value={3}>Критический (P3)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Исполнитель:</label>
              <select
                value={executor}
                onChange={(e) => setExecutor(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100 focus:outline-none"
              >
                <option value="mock">mock (тестовый симулятор)</option>
                <option value="http">http (внешний webhook)</option>
                <option value="shell">shell (консольная команда)</option>
              </select>
            </div>
          </div>

          {/* Зависимости */}
          {allTasks.length > 0 && (
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">
                Зависит от задач (выберите предшественников):
              </label>
              <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-2 space-y-1">
                {allTasks.map((tItem) => (
                  <label
                    key={tItem.id}
                    className="flex items-center gap-2 cursor-pointer hover:bg-slate-900 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDeps.includes(tItem.id)}
                      onChange={() => toggleDep(tItem.id)}
                      className="rounded border-slate-700"
                    />
                    <span className="font-mono text-blue-400">#{tItem.id.slice(-4)}</span>
                    <span className="text-slate-300 truncate">{tItem.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="requireReviewCheckbox"
              checked={requireReview}
              onChange={(e) => setRequireReview(e.target.checked)}
              className="rounded border-slate-700"
            />
            <label htmlFor="requireReviewCheckbox" className="text-slate-300 cursor-pointer">
              Требовать ручной аппрув перед переводом в Done (Review)
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              {t.cancelPlan}
            </button>
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 shadow-sm"
            >
              Создать задачу
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
