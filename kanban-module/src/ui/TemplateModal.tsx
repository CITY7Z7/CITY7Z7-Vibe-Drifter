/**
 * @file kanban-module/src/ui/TemplateModal.tsx
 * @description Модальное окно библиотеки шаблонов задач (19 эталонных шаблонов).
 *
 * Возможности:
 * - Категоризация: Greenfield, Modernization, Testing, Features, DevOps;
 * - Фильтрация по категориям и текстовый поиск по названию/промпту;
 * - Моментальная передача шаблона в планировщик для формирования графа.
 */

import React, { useState, useMemo } from 'react';
import { TaskTemplate } from '../core/types';
import { Locale, translations } from './i18n';

export interface TemplateModalProps {
  isOpen: boolean;
  templates: TaskTemplate[];
  locale: Locale;
  onClose: () => void;
  onSelectTemplate: (template: TaskTemplate) => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({
  isOpen,
  templates,
  locale,
  onClose,
  onSelectTemplate,
}) => {
  const t = translations[locale];
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const categories = [
    { key: 'all', label: t.allCategories },
    { key: 'greenfield', label: t.greenfield },
    { key: 'modernization', label: t.modernization },
    { key: 'testing', label: t.testing },
    { key: 'features', label: t.features },
    { key: 'devops', label: t.devops },
  ];

  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      const matchCat = selectedCategory === 'all' || tpl.category === selectedCategory;
      const matchSearch =
        searchQuery === '' ||
        tpl.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tpl.prompt.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [templates, selectedCategory, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="flex flex-col max-h-[85vh] w-full max-w-4xl rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden">
        {/* Шапка модального окна */}
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">📚</span>
            <h2 className="text-lg font-semibold text-slate-100">{t.templates}</h2>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-400">
              {templates.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Панель фильтров и поиска */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-slate-800 p-4 bg-slate-950/40">
          {/* Поиск */}
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchTemplate}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1.5 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {/* Фильтр по категориям */}
          <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
            {categories.map((c) => (
              <button
                key={c.key}
                onClick={() => setSelectedCategory(c.key)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedCategory === c.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Сетка карточек шаблонов */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredTemplates.length === 0 ? (
            <div className="col-span-2 py-12 text-center text-sm text-slate-500">
              Шаблоны не найдены по заданным критериям поиска.
            </div>
          ) : (
            filteredTemplates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-950/80 p-4 hover:border-slate-600 transition-all group"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                      #{tpl.id}
                    </span>
                    <span className="rounded bg-blue-950/80 border border-blue-800/40 px-2 py-0.5 text-[10px] font-medium text-blue-300 capitalize">
                      {tpl.category}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-slate-100 group-hover:text-blue-300 transition-colors">
                    {tpl.title}
                  </h3>

                  <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                    {tpl.prompt}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Готовый граф задач</span>
                  <button
                    onClick={() => {
                      onSelectTemplate(tpl);
                      onClose();
                    }}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 transition-colors shadow-sm"
                  >
                    Выбрать шаблон →
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
