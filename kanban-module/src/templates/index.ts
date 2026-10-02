/**
 * @file kanban-module/src/templates/index.ts
 * @description Экспорт 19 эталонных шаблонов задач.
 */

import starterData from './starter.json';
import { TaskTemplate } from '../core/types';

export const STARTER_TEMPLATES: TaskTemplate[] = starterData.map((item) => ({
  id: String(item.id),
  category: item.category as any,
  title: item.title,
  prompt: item.prompt,
  isBuiltin: true,
  createdAt: new Date().toISOString(),
}));

export default STARTER_TEMPLATES;
