/**
 * @file kanban-module/src/ui/KanbanBoard.tsx
 * @description Главный React-компонент Kanban-оркестратора (<KanbanBoard />).
 *
 * Архитектурные свойства:
 * - Полностью изолирован (CSS-классы с префиксом kb-*, локальные CSS-переменные для тем);
 * - Не модифицирует body, html или глобальные стили хоста;
 * - Поддерживает нативный Drag & Drop, реалтайм по SSE с авто-переподключением;
 * - Переключение между представлением колонок и графом зависимостей;
 * - Интегрированный боковой чат-планировщик с разбором целей и 19 шаблонами;
 * - Полная поддержка русского и английского языков (RU/EN).
 */

import React, { useState } from 'react';
import { KanbanBoardProps, ThemeMode } from './types';
import { Locale, translations } from './i18n';
import { useKanban } from './useKanban';
import { Column } from './Column';
import { DependencyGraph } from './DependencyGraph';
import { PlannerChat } from './PlannerChat';
import { TemplateModal } from './TemplateModal';
import { TaskDetailModal } from './TaskDetailModal';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskStatus } from '../core/types';

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  apiBase = '/api/kanban',
  initialLocale = 'ru',
  initialTheme = 'dark',
  customTitle,
  className = '',
}) => {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [activeTab, setActiveTab] = useState<'board' | 'graph'>('board');

  const t = translations[locale];

  const {
    boards,
    activeBoard,
    activeBoardId,
    setActiveBoardId,
    tasks,
    messages,
    templates,
    isPaused,
    runningTaskIds,
    selectedTask,
    setSelectedTask,
    hoveredTaskId,
    setHoveredTaskId,
    highlightedAncestors,
    highlightedDescendants,
    currentPlanPreview,
    setCurrentPlanPreview,
    isPlanning,
    isTemplateModalOpen,
    setIsTemplateModalOpen,
    isCreateTaskModalOpen,
    setIsCreateTaskModalOpen,
    isPlannerOpen,
    setIsPlannerOpen,
    sseConnected,
    toasts,
    startTask,
    cancelTask,
    retryTask,
    approveTask,
    rejectTask,
    deleteTask,
    moveTaskManual,
    createTask,
    togglePauseScheduler,
    updateMaxParallel,
    submitPlanPrompt,
    applyPlan,
  } = useKanban(apiBase);

  // Группировка задач по колонкам
  const tasksByStatus: Record<TaskStatus, typeof tasks> = {
    backlog: tasks.filter((t) => t.status === 'backlog'),
    ready: tasks.filter((t) => t.status === 'ready'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    review: tasks.filter((t) => t.status === 'review'),
    done: tasks.filter((t) => t.status === 'done'),
    failed: tasks.filter((t) => t.status === 'failed'),
    blocked: tasks.filter((t) => t.status === 'blocked'),
  };

  const handleAddDependency = async (taskId: string, depId: string) => {
    try {
      await fetch(`${apiBase}/tasks/${taskId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depId }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveDependency = async (taskId: string, depId: string) => {
    try {
      await fetch(`${apiBase}/tasks/${taskId}/links/${depId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div
      className={`kb-orchestrator-root flex h-full min-h-[650px] w-full flex-col font-sans select-none ${
        theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'
      } ${className}`}
      style={{
        colorScheme: theme,
      }}
    >
      {/* 1. Верхняя панель управления (Header Bar) */}
      <header className="flex flex-wrap items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-2.5 gap-3 backdrop-blur-sm z-20">
        {/* Логотип и переключатель досок */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 font-bold text-white shadow-md shadow-blue-500/20">
              ⚡
            </span>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-100">
                {customTitle || t.appTitle}
              </h1>
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      sseConnected ? 'bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                  {sseConnected ? t.connected : t.connecting}
                </span>
              </div>
            </div>
          </div>

          {/* Селектор досок */}
          {boards.length > 1 && (
            <select
              value={activeBoardId}
              onChange={(e) => setActiveBoardId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Индикаторы шедулера и параллелизма */}
        <div className="flex items-center gap-2.5 text-xs">
          {/* Кнопка Pause / Resume */}
          <button
            onClick={togglePauseScheduler}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors border shadow-xs ${
              isPaused
                ? 'bg-amber-950/80 border-amber-600 text-amber-300 hover:bg-amber-900'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <span>{isPaused ? '▶' : '⏸'}</span>
            <span>{isPaused ? t.resume : t.pause}</span>
          </button>

          {/* Параллелизм (maxParallel) */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-slate-300">
            <span className="text-[11px] text-slate-400">{t.maxParallel}:</span>
            <span className="font-mono font-semibold text-blue-400">
              {activeBoard?.settings?.maxParallel || 3}
            </span>
            <div className="flex items-center gap-0.5 ml-1">
              <button
                onClick={() =>
                  updateMaxParallel(Math.max(1, (activeBoard?.settings?.maxParallel || 3) - 1))
                }
                className="h-4 w-4 rounded bg-slate-800 text-[10px] text-slate-300 hover:bg-slate-700"
              >
                -
              </button>
              <button
                onClick={() =>
                  updateMaxParallel(Math.min(10, (activeBoard?.settings?.maxParallel || 3) + 1))
                }
                className="h-4 w-4 rounded bg-slate-800 text-[10px] text-slate-300 hover:bg-slate-700"
              >
                +
              </button>
            </div>
          </div>

          {/* Счетчик запущенных слотов */}
          <div className="flex items-center gap-1 rounded-lg bg-blue-950/40 border border-blue-900/40 px-2.5 py-1 text-[11px] text-blue-300 font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span>
              {t.runningTasks}: {runningTaskIds.length}/{activeBoard?.settings?.maxParallel || 3}
            </span>
          </div>
        </div>

        {/* Вкладки представления (Доска / Граф), Шаблоны, Язык и Тема */}
        <div className="flex items-center gap-2">
          {/* Переключатель Табов */}
          <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5">
            <button
              onClick={() => setActiveTab('board')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === 'board'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.board}
            </button>
            <button
              onClick={() => setActiveTab('graph')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === 'graph'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.graph}
            </button>
          </div>

          {/* Кнопка создания задачи */}
          <button
            onClick={() => setIsCreateTaskModalOpen(true)}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 transition-colors shadow-sm"
          >
            <span>+</span>
            <span>{t.addTask}</span>
          </button>

          {/* Библиотека шаблонов */}
          <button
            onClick={() => setIsTemplateModalOpen(true)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors"
          >
            {t.templates}
          </button>

          {/* Тоггл чата планировщика */}
          <button
            onClick={() => setIsPlannerOpen(!isPlannerOpen)}
            className={`rounded-lg p-1.5 text-xs transition-colors border ${
              isPlannerOpen
                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title={t.planner}
          >
            💬
          </button>

          {/* Язык (RU/EN) */}
          <button
            onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
            className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] font-mono text-slate-300 hover:bg-slate-800"
          >
            {locale.toUpperCase()}
          </button>

          {/* Тема (Dark/Light) */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs text-slate-300 hover:bg-slate-800"
            title={theme === 'dark' ? t.lightTheme : t.darkTheme}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {/* Предупреждение о паузе шедулера */}
      {isPaused && (
        <div className="bg-amber-950/60 border-b border-amber-800/60 px-4 py-1.5 text-center text-xs font-medium text-amber-200 flex items-center justify-center gap-2">
          <span>⏸</span>
          <span>{t.pausedBanner}</span>
          <button
            onClick={togglePauseScheduler}
            className="underline hover:text-amber-100 font-semibold"
          >
            {t.resume}
          </button>
        </div>
      )}

      {/* 2. Основная рабочая область */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Контент: Колонки или Граф */}
        <main className="flex-1 overflow-x-auto overflow-y-auto p-4 flex flex-col">
          {activeTab === 'board' ? (
            <div className="flex gap-4 items-start min-w-max pb-4 flex-1">
              {/* Основные колонки по умолчанию */}
              <Column
                status="backlog"
                title={t.backlog}
                tasks={tasksByStatus.backlog}
                allTasks={tasks}
                locale={locale}
                hoveredTaskId={hoveredTaskId}
                highlightedAncestors={highlightedAncestors}
                highlightedDescendants={highlightedDescendants}
                onHover={setHoveredTaskId}
                onSelectTask={setSelectedTask}
                onMoveTask={moveTaskManual}
                onStartTask={startTask}
                onCancelTask={cancelTask}
                onRetryTask={retryTask}
                onApproveTask={approveTask}
              />

              <Column
                status="ready"
                title={t.ready}
                tasks={tasksByStatus.ready}
                allTasks={tasks}
                locale={locale}
                hoveredTaskId={hoveredTaskId}
                highlightedAncestors={highlightedAncestors}
                highlightedDescendants={highlightedDescendants}
                onHover={setHoveredTaskId}
                onSelectTask={setSelectedTask}
                onMoveTask={moveTaskManual}
                onStartTask={startTask}
                onCancelTask={cancelTask}
                onRetryTask={retryTask}
                onApproveTask={approveTask}
              />

              <Column
                status="in_progress"
                title={t.in_progress}
                tasks={tasksByStatus.in_progress}
                allTasks={tasks}
                locale={locale}
                hoveredTaskId={hoveredTaskId}
                highlightedAncestors={highlightedAncestors}
                highlightedDescendants={highlightedDescendants}
                onHover={setHoveredTaskId}
                onSelectTask={setSelectedTask}
                onMoveTask={moveTaskManual}
                onStartTask={startTask}
                onCancelTask={cancelTask}
                onRetryTask={retryTask}
                onApproveTask={approveTask}
              />

              <Column
                status="review"
                title={t.review}
                tasks={tasksByStatus.review}
                allTasks={tasks}
                locale={locale}
                hoveredTaskId={hoveredTaskId}
                highlightedAncestors={highlightedAncestors}
                highlightedDescendants={highlightedDescendants}
                onHover={setHoveredTaskId}
                onSelectTask={setSelectedTask}
                onMoveTask={moveTaskManual}
                onStartTask={startTask}
                onCancelTask={cancelTask}
                onRetryTask={retryTask}
                onApproveTask={approveTask}
              />

              <Column
                status="done"
                title={t.done}
                tasks={tasksByStatus.done}
                allTasks={tasks}
                locale={locale}
                hoveredTaskId={hoveredTaskId}
                highlightedAncestors={highlightedAncestors}
                highlightedDescendants={highlightedDescendants}
                onHover={setHoveredTaskId}
                onSelectTask={setSelectedTask}
                onMoveTask={moveTaskManual}
                onStartTask={startTask}
                onCancelTask={cancelTask}
                onRetryTask={retryTask}
                onApproveTask={approveTask}
              />

              {/* Сворачиваемые колонки Failed и Blocked */}
              <Column
                status="failed"
                title={t.failed}
                tasks={tasksByStatus.failed}
                allTasks={tasks}
                locale={locale}
                collapsible={true}
                hoveredTaskId={hoveredTaskId}
                highlightedAncestors={highlightedAncestors}
                highlightedDescendants={highlightedDescendants}
                onHover={setHoveredTaskId}
                onSelectTask={setSelectedTask}
                onMoveTask={moveTaskManual}
                onStartTask={startTask}
                onCancelTask={cancelTask}
                onRetryTask={retryTask}
                onApproveTask={approveTask}
              />

              <Column
                status="blocked"
                title={t.blocked}
                tasks={tasksByStatus.blocked}
                allTasks={tasks}
                locale={locale}
                collapsible={true}
                hoveredTaskId={hoveredTaskId}
                highlightedAncestors={highlightedAncestors}
                highlightedDescendants={highlightedDescendants}
                onHover={setHoveredTaskId}
                onSelectTask={setSelectedTask}
                onMoveTask={moveTaskManual}
                onStartTask={startTask}
                onCancelTask={cancelTask}
                onRetryTask={retryTask}
                onApproveTask={approveTask}
              />
            </div>
          ) : (
            <DependencyGraph
              tasks={tasks}
              locale={locale}
              onSelectTask={setSelectedTask}
              hoveredTaskId={hoveredTaskId}
              onHover={setHoveredTaskId}
            />
          )}
        </main>

        {/* 3. Боковой чат-планировщик */}
        {isPlannerOpen && (
          <PlannerChat
            messages={messages}
            currentPlanPreview={currentPlanPreview}
            isPlanning={isPlanning}
            locale={locale}
            onSendPrompt={submitPlanPrompt}
            onApplyPlan={applyPlan}
            onCancelPlan={() => setCurrentPlanPreview(null)}
            onOpenTemplates={() => setIsTemplateModalOpen(true)}
            onClose={() => setIsPlannerOpen(false)}
          />
        )}
      </div>

      {/* 4. Модальные окна */}
      <TaskDetailModal
        task={selectedTask}
        allTasks={tasks}
        locale={locale}
        onClose={() => setSelectedTask(null)}
        onStart={startTask}
        onCancel={cancelTask}
        onRetry={retryTask}
        onApprove={approveTask}
        onReject={rejectTask}
        onDelete={deleteTask}
        onAddDependency={handleAddDependency}
        onRemoveDependency={handleRemoveDependency}
      />

      <TemplateModal
        isOpen={isTemplateModalOpen}
        templates={templates}
        locale={locale}
        onClose={() => setIsTemplateModalOpen(false)}
        onSelectTemplate={(tpl) => {
          submitPlanPrompt(tpl.prompt);
          setIsPlannerOpen(true);
        }}
      />

      <CreateTaskModal
        isOpen={isCreateTaskModalOpen}
        allTasks={tasks}
        locale={locale}
        onClose={() => setIsCreateTaskModalOpen(false)}
        onCreate={createTask}
      />

      {/* 5. Уведомления (Toasts) */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between rounded-lg p-3 text-xs shadow-lg border transition-all ${
              toast.type === 'error'
                ? 'bg-rose-950 border-rose-700 text-rose-200'
                : toast.type === 'warning'
                ? 'bg-amber-950 border-amber-700 text-amber-200'
                : toast.type === 'success'
                ? 'bg-emerald-950 border-emerald-700 text-emerald-200'
                : 'bg-slate-900 border-slate-700 text-slate-200'
            }`}
          >
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
