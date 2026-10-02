/**
 * @file kanban-module/src/ui/DependencyGraph.tsx
 * @description Слоистая схема ориентированного графа зависимостей (DAG) на SVG.
 *
 * Особенности:
 * - Уровни (слои) рассчитываются по топологической сортировке (computeGraphLayers);
 * - Цвет узлов соответствует текущему статусу выполнения задач;
 * - Направленные изогнутые стрелки с маркером острия;
 * - Интерактивность: клик по узлу открывает детали задачи, наведение подсвечивает связи.
 */

import React, { useMemo } from 'react';
import { Task, TaskStatus } from '../core/types';
import { computeGraphLayers } from '../core/graph';
import { Locale } from './i18n';

export interface DependencyGraphProps {
  tasks: Task[];
  locale: Locale;
  onSelectTask: (task: Task) => void;
  hoveredTaskId: string | null;
  onHover: (id: string | null) => void;
}

const statusColors: Record<TaskStatus, { bg: string; border: string; text: string }> = {
  backlog: { bg: '#1e293b', border: '#475569', text: '#94a3b8' },
  ready: { bg: '#451a03', border: '#d97706', text: '#fcd34d' },
  in_progress: { bg: '#172554', border: '#3b82f6', text: '#93c5fd' },
  review: { bg: '#3b0764', border: '#a855f7', text: '#d8b4fe' },
  done: { bg: '#064e3b', border: '#10b981', text: '#6ee7b7' },
  failed: { bg: '#4c0519', border: '#f43f5e', text: '#fda4af' },
  blocked: { bg: '#431407', border: '#ea580c', text: '#fdba74' },
};

export const DependencyGraph: React.FC<DependencyGraphProps> = ({
  tasks,
  onSelectTask,
  hoveredTaskId,
  onHover,
}) => {
  const { nodes, layersCount } = useMemo(() => computeGraphLayers(tasks), [tasks]);

  const NODE_WIDTH = 180;
  const NODE_HEIGHT = 64;
  const LAYER_GAP = 240;
  const ROW_GAP = 90;
  const PADDING_X = 60;
  const PADDING_Y = 60;

  // Рассчитываем координаты каждого узла
  const layout = useMemo(() => {
    const map = new Map<string, { x: number; y: number; task: Task }>();
    for (const item of nodes) {
      const x = PADDING_X + item.layer * LAYER_GAP;
      const y = PADDING_Y + item.orderInLayer * ROW_GAP;
      map.set(item.task.id, { x, y, task: item.task });
    }
    return map;
  }, [nodes]);

  // Вычисляем общие размеры SVG
  const maxNodesInAnyLayer = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of nodes) {
      counts.set(item.layer, (counts.get(item.layer) || 0) + 1);
    }
    let max = 1;
    for (const c of counts.values()) {
      if (c > max) max = c;
    }
    return max;
  }, [nodes]);

  const svgWidth = Math.max(800, PADDING_X * 2 + Math.max(1, layersCount) * LAYER_GAP);
  const svgHeight = Math.max(500, PADDING_Y * 2 + maxNodesInAnyLayer * ROW_GAP);

  // Собираем все направленные связи для отрисовки стрелок (parent -> child)
  const edges = useMemo(() => {
    const list: Array<{ fromId: string; toId: string; fromCoord: { x: number; y: number }; toCoord: { x: number; y: number } }> = [];
    for (const task of tasks) {
      const targetPos = layout.get(task.id);
      if (!targetPos) continue;

      for (const parentId of task.dependsOn) {
        const sourcePos = layout.get(parentId);
        if (sourcePos) {
          list.push({
            fromId: parentId,
            toId: task.id,
            fromCoord: {
              x: sourcePos.x + NODE_WIDTH,
              y: sourcePos.y + NODE_HEIGHT / 2,
            },
            toCoord: {
              x: targetPos.x,
              y: targetPos.y + NODE_HEIGHT / 2,
            },
          });
        }
      }
    }
    return list;
  }, [tasks, layout]);

  if (tasks.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-slate-800 text-sm text-slate-500">
        Нет задач для построения графа зависимостей. Создайте задачи или примените шаблон.
      </div>
    );
  }

  return (
    <div className="kb-graph-container relative w-full overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4">
      {/* Легенда */}
      <div className="absolute top-4 right-4 z-10 flex flex-wrap gap-2 rounded-lg bg-slate-900/90 p-2.5 text-[11px] border border-slate-800">
        {Object.entries(statusColors).map(([status, c]) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.border }} />
            <span className="text-slate-300 capitalize">{status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      <svg
        width={svgWidth}
        height={svgHeight}
        className="mx-auto"
        style={{ minWidth: '100%', minHeight: '500px' }}
      >
        <defs>
          {/* Маркер стрелки по умолчанию */}
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#64748b" />
          </marker>
          {/* Маркер активной стрелки */}
          <marker
            id="arrow-active"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8" />
          </marker>
        </defs>

        {/* 1. Отрисовка стрелок зависимостей */}
        {edges.map((edge, idx) => {
          const isEdgeActive =
            hoveredTaskId === edge.fromId || hoveredTaskId === edge.toId;

          // Изогнутая линия Безье между узлами
          const dx = (edge.toCoord.x - edge.fromCoord.x) / 2;
          const pathD = `M ${edge.fromCoord.x} ${edge.fromCoord.y} C ${edge.fromCoord.x + dx} ${edge.fromCoord.y}, ${edge.toCoord.x - dx} ${edge.toCoord.y}, ${edge.toCoord.x} ${edge.toCoord.y}`;

          return (
            <path
              key={`edge-${idx}`}
              d={pathD}
              fill="none"
              stroke={isEdgeActive ? '#38bdf8' : '#334155'}
              strokeWidth={isEdgeActive ? 2.5 : 1.5}
              markerEnd={isEdgeActive ? 'url(#arrow-active)' : 'url(#arrow)'}
              className="transition-all duration-200"
            />
          );
        })}

        {/* 2. Отрисовка узлов задач */}
        {Array.from(layout.entries()).map(([id, item]) => {
          const c = statusColors[item.task.status] || statusColors.backlog;
          const isCurrentHovered = hoveredTaskId === id;

          return (
            <g
              key={id}
              transform={`translate(${item.x}, ${item.y})`}
              className="cursor-pointer transition-all"
              onClick={() => onSelectTask(item.task)}
              onMouseEnter={() => onHover(id)}
              onMouseLeave={() => onHover(null)}
            >
              {/* Прямоугольник карточки */}
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                ry={8}
                fill={c.bg}
                stroke={isCurrentHovered ? '#38bdf8' : c.border}
                strokeWidth={isCurrentHovered ? 2.5 : 1.5}
                filter={isCurrentHovered ? 'drop-shadow(0 4px 6px rgba(56, 189, 248, 0.25))' : undefined}
              />

              {/* ID и статус */}
              <text
                x={12}
                y={22}
                fill={c.text}
                fontSize={11}
                fontFamily="monospace"
                fontWeight="bold"
              >
                #{id.slice(-4)} • {item.task.status.toUpperCase()}
              </text>

              {/* Заголовок задачи */}
              <text
                x={12}
                y={42}
                fill="#f1f5f9"
                fontSize={12}
                fontWeight="500"
                style={{
                  width: NODE_WIDTH - 24,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.task.title.length > 20
                  ? item.task.title.slice(0, 19) + '…'
                  : item.task.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
