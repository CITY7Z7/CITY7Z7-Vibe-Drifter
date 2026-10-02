/**
 * @file kanban-module/src/ui/useKanban.ts
 * @description Реактивный хук состояния доски (Zustand + SSE + Polling fallback).
 *
 * Управляет:
 * - Загрузкой и синхронизацией досок и задач через REST API;
 * - Реалтайм-обновлениями через нативный SSE поток с авто-переподключением;
 * - Резервным опросом (polling каждые 3 секунды в случае недоступности SSE);
 * - Выделением связанных задач при наведении курсора (hoveredTaskId);
 * - Действиями над задачами (Start, Cancel, Retry, Approve, Reject, Delete);
 * - Интерактивным чатом-планировщиком и генерацией превью графа.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Board, Task, ChatMessage, TaskTemplate, PlanPreview } from '../core/types';
import { getAncestors, getDescendants } from '../core/graph';

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

export function useKanban(apiBase = '/api/kanban') {
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string>('default');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);

  // Состояние шедулера
  const [isPaused, setIsPaused] = useState(false);
  const [runningTaskIds, setRunningTaskIds] = useState<string[]>([]);

  // Вспомогательные UI-состояния
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [currentPlanPreview, setCurrentPlanPreview] = useState<PlanPreview | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [isPlannerOpen, setIsPlannerOpen] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const sseRef = useRef<EventSource | null>(null);
  const activeBoardIdRef = useRef(activeBoardId);
  activeBoardIdRef.current = activeBoardId;

  const showToast = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // 1. Загрузка списка досок
  const loadBoards = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/boards`);
      const json = await res.json();
      if (json.ok && Array.isArray(json.data)) {
        setBoards(json.data);
        if (json.data.length > 0 && !activeBoardIdRef.current) {
          setActiveBoardId(json.data[0].id);
        }
      }
    } catch (err: any) {
      console.error('Ошибка загрузки досок:', err);
    }
  }, [apiBase]);

  // 2. Загрузка задач активной доски
  const loadTasks = useCallback(
    async (boardId: string) => {
      if (!boardId) return;
      try {
        const res = await fetch(`${apiBase}/boards/${boardId}/tasks`);
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) {
          setTasks(json.data);
          // Обновляем выбранную задачу, если она открыта
          setSelectedTask((curr) => {
            if (!curr) return null;
            return json.data.find((t: Task) => t.id === curr.id) || null;
          });
        }
      } catch (err) {
        console.error('Ошибка загрузки задач:', err);
      }
    },
    [apiBase]
  );

  // 3. Загрузка истории чата активной доски
  const loadChat = useCallback(
    async (boardId: string) => {
      if (!boardId) return;
      try {
        const res = await fetch(`${apiBase}/boards/${boardId}/chat`);
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) {
          setMessages(json.data);
        }
      } catch (err) {
        console.error('Ошибка загрузки чата:', err);
      }
    },
    [apiBase]
  );

  // 4. Загрузка шаблонов
  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/templates`);
      const json = await res.json();
      if (json.ok && Array.isArray(json.data)) {
        setTemplates(json.data);
      }
    } catch (err) {
      console.error('Ошибка загрузки шаблонов:', err);
    }
  }, [apiBase]);

  // 5. Загрузка статуса шедулера
  const loadSchedulerStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/scheduler/status`);
      const json = await res.json();
      if (json.ok && json.data) {
        setIsPaused(json.data.isPaused);
        setRunningTaskIds(json.data.runningTaskIds || []);
      }
    } catch (err) {
      console.error('Ошибка загрузки статуса шедулера:', err);
    }
  }, [apiBase]);

  // Инициализация при монтировании
  useEffect(() => {
    loadBoards();
    loadTemplates();
    loadSchedulerStatus();
  }, [loadBoards, loadTemplates, loadSchedulerStatus]);

  useEffect(() => {
    if (activeBoardId) {
      loadTasks(activeBoardId);
      loadChat(activeBoardId);
    }
  }, [activeBoardId, loadTasks, loadChat]);

  // 6. Подключение к SSE-потоку с автопереподключением и fallback-опросом
  useEffect(() => {
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    function connectSSE() {
      if (sseRef.current) {
        sseRef.current.close();
      }

      const sse = new EventSource(`${apiBase}/events`);
      sseRef.current = sse;

      sse.onopen = () => {
        setSseConnected(true);
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      };

      sse.addEventListener('task.created', (e) => {
        const payload = JSON.parse(e.data);
        if (payload?.task?.boardId === activeBoardIdRef.current) {
          setTasks((prev) => {
            if (prev.some((t) => t.id === payload.task.id)) return prev;
            return [...prev, payload.task];
          });
        }
      });

      sse.addEventListener('task.updated', (e) => {
        const payload = JSON.parse(e.data);
        if (payload?.task) {
          const updated = payload.task as Task;
          if (updated.boardId === activeBoardIdRef.current) {
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            setSelectedTask((curr) => (curr && curr.id === updated.id ? updated : curr));
          }
        }
      });

      sse.addEventListener('task.deleted', (e) => {
        const payload = JSON.parse(e.data);
        if (payload?.taskId) {
          setTasks((prev) => prev.filter((t) => t.id !== payload.taskId));
          setSelectedTask((curr) => (curr && curr.id === payload.taskId ? null : curr));
        }
      });

      sse.addEventListener('task.log', (e) => {
        const payload = JSON.parse(e.data);
        if (payload?.taskId && payload?.line) {
          setTasks((prev) =>
            prev.map((t) => (t.id === payload.taskId ? { ...t, log: [...t.log, payload.line] } : t))
          );
          setSelectedTask((curr) =>
            curr && curr.id === payload.taskId ? { ...curr, log: [...curr.log, payload.line] } : curr
          );
        }
      });

      sse.addEventListener('scheduler.state', (e) => {
        const payload = JSON.parse(e.data);
        if (payload) {
          setIsPaused(payload.isPaused);
          setRunningTaskIds(payload.runningTaskIds || []);
        }
      });

      sse.addEventListener('board.updated', (e) => {
        const payload = JSON.parse(e.data);
        if (payload?.board) {
          setBoards((prev) => prev.map((b) => (b.id === payload.board.id ? payload.board : b)));
        }
      });

      sse.onerror = () => {
        setSseConnected(false);
        sse.close();
        // Включаем резервный опрос каждые 3 секунды
        if (!pollInterval) {
          pollInterval = setInterval(() => {
            if (activeBoardIdRef.current) {
              loadTasks(activeBoardIdRef.current);
              loadSchedulerStatus();
            }
          }, 3000);
        }
        // Попытка переподключения через 4 секунды
        reconnectTimeout = setTimeout(connectSSE, 4000);
      };
    }

    connectSSE();

    return () => {
      if (sseRef.current) sseRef.current.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [apiBase, loadTasks, loadSchedulerStatus]);

  // Расчет подсвеченных карточек при наведении
  const highlightedAncestors = hoveredTaskId ? getAncestors(hoveredTaskId, tasks).map((t) => t.id) : [];
  const highlightedDescendants = hoveredTaskId ? getDescendants(hoveredTaskId, tasks).map((t) => t.id) : [];

  // --- Действия жизненного цикла задач ---

  const startTask = async (taskId: string) => {
    try {
      const res = await fetch(`${apiBase}/tasks/${taskId}/start`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.error || 'Ошибка запуска задачи', 'error');
      } else {
        showToast(`Задача запущена`, 'success');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const cancelTask = async (taskId: string) => {
    try {
      const res = await fetch(`${apiBase}/tasks/${taskId}/cancel`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.error || 'Ошибка отмены задачи', 'error');
      } else {
        showToast(`Задача отменена`, 'info');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const retryTask = async (taskId: string) => {
    try {
      const res = await fetch(`${apiBase}/tasks/${taskId}/retry`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.error || 'Ошибка повтора задачи', 'error');
      } else {
        showToast(`Задача перезапущена (Retry)`, 'success');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const approveTask = async (taskId: string) => {
    try {
      const res = await fetch(`${apiBase}/tasks/${taskId}/approve`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.error || 'Ошибка одобрения задачи', 'error');
      } else {
        showToast(`Задача одобрена (Done)`, 'success');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const rejectTask = async (taskId: string, comment?: string) => {
    try {
      const res = await fetch(`${apiBase}/tasks/${taskId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.error || 'Ошибка возврата на доработку', 'error');
      } else {
        showToast(`Задача возвращена на доработку`, 'warning');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      const res = await fetch(`${apiBase}/tasks/${taskId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.error || 'Ошибка удаления задачи', 'error');
      } else {
        showToast(`Задача удалена`, 'info');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const moveTaskManual = async (taskId: string, targetStatus: string) => {
    try {
      const res = await fetch(`${apiBase}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.error || 'Недопустимый переход статуса', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const createTask = async (taskData: Partial<Task>) => {
    try {
      const res = await fetch(`${apiBase}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardId: activeBoardId,
          title: taskData.title,
          prompt: taskData.prompt,
          status: taskData.status || 'backlog',
          priority: taskData.priority || 0,
          labels: taskData.labels || [],
          dependsOn: taskData.dependsOn || [],
          requireReview: Boolean(taskData.requireReview),
          timeoutMs: taskData.timeoutMs || 30000,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        showToast(json.error || 'Ошибка создания задачи', 'error');
      } else {
        showToast(`Задача создана`, 'success');
        setIsCreateTaskModalOpen(false);
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const togglePauseScheduler = async () => {
    try {
      const endpoint = isPaused ? `${apiBase}/scheduler/resume` : `${apiBase}/scheduler/pause`;
      const res = await fetch(endpoint, { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        setIsPaused(json.data.isPaused);
        showToast(json.data.isPaused ? 'Шедулер на паузе' : 'Шедулер возобновлен', 'info');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const updateMaxParallel = async (maxParallel: number) => {
    if (!activeBoardId) return;
    try {
      const res = await fetch(`${apiBase}/boards/${activeBoardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { maxParallel } }),
      });
      const json = await res.json();
      if (json.ok) {
        setBoards((prev) => prev.map((b) => (b.id === activeBoardId ? json.data : b)));
        showToast(`Параллелизм обновлен: ${maxParallel}`, 'success');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Планировщик
  const submitPlanPrompt = async (prompt: string) => {
    if (!prompt.trim()) return;
    setIsPlanning(true);
    try {
      const res = await fetch(`${apiBase}/planner/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId: activeBoardId, prompt }),
      });
      const json = await res.json();
      if (json.ok) {
        setCurrentPlanPreview(json.data);
        loadChat(activeBoardId);
      } else {
        showToast(json.error || 'Ошибка планирования', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsPlanning(false);
    }
  };

  const applyPlan = async (autoStart = false) => {
    if (!currentPlanPreview) return;
    try {
      const res = await fetch(`${apiBase}/planner/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardId: activeBoardId,
          plan: currentPlanPreview,
          autoStart,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        showToast(
          `Создано задач: ${json.data.createdTasks?.length}. Запущено: ${json.data.startedCount}`,
          'success'
        );
        setCurrentPlanPreview(null);
      } else {
        showToast(json.error || 'Ошибка применения плана', 'error');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const activeBoard = boards.find((b) => b.id === activeBoardId) || {
    id: activeBoardId,
    name: 'Главная доска',
    settings: { maxParallel: 3, autoChain: true, recoverPolicy: 'fail', defaultExecutor: 'mock' },
    createdAt: '',
    updatedAt: '',
  };

  return {
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
    showToast,
    // Actions
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
  };
}
