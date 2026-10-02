/**
 * @file kanban-module/src/ui/PlannerChat.tsx
 * @description Боковая панель чата-планировщика задач.
 *
 * Позволяет:
 * - Ввести свободную цель проекта или вставить промпт;
 * - Просмотреть декомпозицию на задачи, граф связей и стартовые задачи;
 * - Нажать «Применить» или «Применить и запустить»;
 * - Быстро перейти к выбору готовых шаблонов из библиотеки.
 */

import React, { useState } from 'react';
import { PlanPreview, ChatMessage } from '../core/types';
import { Locale, translations } from './i18n';

export interface PlannerChatProps {
  messages: ChatMessage[];
  currentPlanPreview: PlanPreview | null;
  isPlanning: boolean;
  locale: Locale;
  onSendPrompt: (prompt: string) => void;
  onApplyPlan: (autoStart: boolean) => void;
  onCancelPlan: () => void;
  onOpenTemplates: () => void;
  onClose: () => void;
}

export const PlannerChat: React.FC<PlannerChatProps> = ({
  messages,
  currentPlanPreview,
  isPlanning,
  locale,
  onSendPrompt,
  onApplyPlan,
  onCancelPlan,
  onOpenTemplates,
  onClose,
}) => {
  const t = translations[locale];
  const [inputText, setInputText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isPlanning) return;
    onSendPrompt(inputText.trim());
    setInputText('');
  };

  return (
    <aside className="kb-planner-chat flex flex-col w-96 border-l border-slate-800 bg-slate-900/95 p-4 text-slate-100 h-full">
      {/* Шапка чата */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">{t.planner}</h2>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenTemplates}
            className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-blue-300 hover:bg-slate-700 transition-colors border border-slate-700"
          >
            {t.templates}
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* История сообщений */}
      <div className="flex-1 overflow-y-auto py-3 space-y-3 pr-1 text-xs">
        {messages.length === 0 && !currentPlanPreview && (
          <div className="flex flex-col items-center justify-center p-6 text-center text-slate-500 gap-2 border border-dashed border-slate-800 rounded-lg">
            <p>Напишите цель проекта или выберите один из 19 готовых шаблонов.</p>
            <button
              onClick={onOpenTemplates}
              className="mt-2 text-blue-400 hover:underline"
            >
              Открыть шаблоны →
            </button>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col gap-1 p-2.5 rounded-lg max-w-[90%] ${
              msg.role === 'user'
                ? 'ml-auto bg-blue-600/90 text-white'
                : 'mr-auto bg-slate-800 border border-slate-700/80 text-slate-200'
            }`}
          >
            <span className="text-[10px] text-slate-400 font-mono">
              {msg.role === 'user' ? 'Вы' : 'Оркестратор'}
            </span>
            <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
          </div>
        ))}

        {isPlanning && (
          <div className="flex items-center gap-2 p-3 text-blue-400 text-xs animate-pulse">
            <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping" />
            Формирование плана и графа связей...
          </div>
        )}

        {/* Карточка превью сформированного плана */}
        {currentPlanPreview && (
          <div className="rounded-lg border border-blue-500/50 bg-blue-950/20 p-3 flex flex-col gap-2.5 mt-2">
            <div className="flex items-center justify-between text-blue-300 font-semibold text-xs border-b border-blue-800/40 pb-1.5">
              <span>{t.planPreview}</span>
              <span className="rounded bg-blue-900/60 px-1.5 py-0.5 text-[10px] font-mono">
                {currentPlanPreview.tasks.length} задач • {currentPlanPreview.links.length} связей
              </span>
            </div>

            {/* Список задач плана */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto text-[11px]">
              {currentPlanPreview.tasks.map((task) => (
                <div key={task.id} className="rounded bg-slate-900/80 p-2 border border-slate-800">
                  <div className="font-medium text-slate-100">
                    <span className="text-blue-400 font-mono mr-1">#{task.id}</span>
                    {task.title}
                  </div>
                  <p className="text-slate-400 text-[10px] line-clamp-2 mt-0.5">{task.prompt}</p>
                </div>
              ))}
            </div>

            {/* Связи */}
            {currentPlanPreview.links.length > 0 && (
              <div className="text-[11px] text-slate-300">
                <span className="text-slate-400">Связи: </span>
                <span className="font-mono text-blue-300">
                  {currentPlanPreview.links.map((l) => `${l.from}→${l.to}`).join(', ')}
                </span>
              </div>
            )}

            {/* Запуск */}
            <div className="text-[11px] text-slate-300">
              <span className="text-slate-400">Начальный старт: </span>
              <span className="font-mono text-emerald-400">
                #{currentPlanPreview.start.join(', #')}
              </span>
            </div>

            {/* Предупреждения */}
            {currentPlanPreview.warnings.length > 0 && (
              <div className="rounded bg-amber-950/40 border border-amber-800/40 p-2 text-[10px] text-amber-300">
                <div className="font-semibold">{t.warnings}:</div>
                {currentPlanPreview.warnings.map((w, idx) => (
                  <div key={idx}>• {w}</div>
                ))}
              </div>
            )}

            {/* Кнопки применения плана */}
            <div className="flex flex-col gap-1.5 pt-1">
              <button
                onClick={() => onApplyPlan(true)}
                className="w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm"
              >
                {t.applyAndStart}
              </button>
              <div className="flex gap-1.5">
                <button
                  onClick={() => onApplyPlan(false)}
                  className="flex-1 rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors border border-slate-700"
                >
                  {t.apply}
                </button>
                <button
                  onClick={onCancelPlan}
                  className="rounded px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {t.cancelPlan}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Поле ввода цели */}
      <form onSubmit={handleSubmit} className="pt-3 border-t border-slate-800 flex flex-col gap-2">
        <textarea
          rows={3}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={t.chatPlaceholder}
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleSubmit(e);
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Ctrl+Enter для отправки</span>
          <button
            type="submit"
            disabled={!inputText.trim() || isPlanning}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {t.send}
          </button>
        </div>
      </form>
    </aside>
  );
};
