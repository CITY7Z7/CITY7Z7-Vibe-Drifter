/**
 * @file demo/App.tsx
 * @description Минимальное приложение-песочница (Demo Sandbox) для автономной проверки Kanban-модуля.
 */

import React, { useState } from 'react';
import { KanbanBoard } from '../kanban-module/src/ui';

export const DemoApp: React.FC = () => {
  const [boardKey, setBoardKey] = useState(0);

  const handleResetBoard = async () => {
    if (confirm('Очистить доску и сбросить все задачи?')) {
      try {
        const res = await fetch('/api/kanban/boards/default/tasks');
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) {
          for (const t of json.data) {
            await fetch(`/api/kanban/tasks/${t.id}`, { method: 'DELETE' });
          }
        }
        setBoardKey((k) => k + 1);
      } catch (err) {
        console.error('Ошибка сброса доски:', err);
      }
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Верхний демонстрационный баннер */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="rounded bg-blue-600/30 border border-blue-500/40 px-2 py-0.5 font-mono text-[10px] font-bold text-blue-300">
            DEMO SANDBOX
          </span>
          <span className="text-slate-400">
            Эталонная реализация Kanban-оркестратора задач • Версия 1.0.0
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleResetBoard}
            className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            Очистить задачи
          </button>
        </div>
      </div>

      {/* Контейнер монтирования Канбан-модуля */}
      <div className="flex-1 overflow-hidden">
        <KanbanBoard key={boardKey} apiBase="/api/kanban" />
      </div>
    </div>
  );
};

export default DemoApp;
