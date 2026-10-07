# 💉 Руководство по интеграции в сторонние проекты (integration-guide.md)

> **Практическое пошаговое руководство для инженера или ИИ-агента по переносу и адаптации модуля оркестратора в любое внешнее приложение.**

---

## 🧭 1. Философия переноса: Инъекция, а не «чёрный ящик»

Модуль **CITY7Z7-Vibe-Drifter** спроектирован **не как закрытый внешний npm-пакет**, а как **рабочая эталонная реализация и спецификация поведения**.

Когда папка `kanban-module/` копируется в приложение-хозяин (новостной агрегатор, CRM, Telegram-бот, ETL-конвейер или админ-панель):
1. **Инъекция ядра (рекомендуется):** Вы переносите логику ядра прямо в стек, существующие архитектурные слои и соглашения об именовании приложения-хозяина. Тесты модуля (`tests/`) гарантируют неизменность инвариантов бизнес-логики.
2. **Прямое монтирование (как есть):** Если технологический стек совпадает (Node.js, Express, React, SQLite/PostgreSQL), модуль подключается через главную фабрику `createKanban` без изменений исходного кода.

---

## 📋 2. Пошаговый алгоритм внедрения

### Шаг 1. Анализ архитектуры приложения-хозяина
Перед переносом кода изучите хост-проект:
- **Backend:** Express, Fastify, NestJS, Next.js API Routes, Koa?
- **База данных:** PostgreSQL, MySQL, SQLite, MongoDB, Redis? ORM: Prisma, Drizzle, TypeORM, Kysely?
- **Frontend:** React 18/19, Next.js App Router, Vue 3, Svelte, Angular?
- **Проверка сущностей:** Проверьте, нет ли уже в проекте таблиц `tasks` или канбан-досок.
  > *Совет:* Если сущность задачи уже существует, не дублируйте ее. Расширьте модель полями `depends_on`, `priority`, `executor`, `attempts`, `timeout_ms` и подключите шедулер оркестратора.

---

### Шаг 2. Реализация адаптера базы данных (`StorageAdapter`)
По умолчанию модуль использует SQLite (`better-sqlite3`). Если в хост-приложении используется **PostgreSQL** или **Prisma**, реализуйте контракт `StorageAdapter`:

```typescript
/**
 * Пример: PostgresStorageAdapter для хост-проекта на PostgreSQL / pg-pool
 */
import { Pool } from 'pg';
import { StorageAdapter } from './kanban-module/src/storage/types';
import { Board, Task, TaskTemplate, ChatMessage } from './kanban-module/src/core/types';

export class PostgresStorageAdapter implements StorageAdapter {
  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    // Идемпотентное создание таблиц с обязательным префиксом kanban_*
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS kanban_boards (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS kanban_tasks (
        id VARCHAR(64) PRIMARY KEY,
        board_id VARCHAR(64) REFERENCES kanban_boards(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status VARCHAR(32) NOT NULL,
        executor VARCHAR(64),
        priority INT DEFAULT 0,
        labels JSONB DEFAULT '[]'::jsonb,
        depends_on JSONB DEFAULT '[]'::jsonb,
        attempts INT DEFAULT 0,
        max_attempts INT DEFAULT 1,
        timeout_ms INT DEFAULT 30000,
        require_review BOOLEAN DEFAULT FALSE,
        result JSONB,
        error TEXT,
        log JSONB DEFAULT '[]'::jsonb,
        meta JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      );
    `);
  }

  async listTasks(boardId: string): Promise<Task[]> {
    const res = await this.pool.query(
      'SELECT * FROM kanban_tasks WHERE board_id = $1 ORDER BY created_at ASC',
      [boardId]
    );
    return res.rows.map(this.mapRowToTask);
  }

  // ... остальные методы интерфейса StorageAdapter
}
```

---

### Шаг 3. Создание собственных исполнителей (TaskExecutors)
Главная ценность оркестратора — запуск реальных бизнес-задач хост-приложения. Создайте классы, реализующие `TaskExecutor`:

```typescript
import { TaskExecutor, Task, ExecutionContext, ExecutionResult } from './kanban-module/src/core/types';

/**
 * Исполнитель публикации саммари в Telegram-канал
 */
export class TelegramPublisherExecutor implements TaskExecutor {
  readonly id = 'telegram_publisher';

  constructor(private readonly botToken: string, private readonly channelId: string) {}

  async run(task: Task, ctx: ExecutionContext): Promise<ExecutionResult> {
    ctx.log('[TelegramExecutor] Подготовка к публикации...');

    // 1. Проверяем токен отмены
    if (ctx.signal.aborted) {
      return { ok: false, error: 'Отменено пользователем' };
    }

    // 2. Извлекаем артефакт предыдущей задачи (например, результат работы LLM-рерайтера)
    const priorTaskResult = Object.values(ctx.deps)[0]?.output as { postText?: string };
    const messageText = priorTaskResult?.postText || task.prompt;

    ctx.progress(30);
    ctx.log(`[TelegramExecutor] Отправка сообщения длиной ${messageText.length} симв.`);

    // 3. Вызов Telegram Bot API
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.channelId,
        text: messageText,
        parse_mode: 'Markdown',
      }),
      signal: ctx.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      ctx.log(`[TelegramExecutor] Ошибка Telegram API: ${errBody}`);
      return { ok: false, error: `Telegram error: ${response.statusText}` };
    }

    const data = await response.json();
    ctx.progress(100);
    ctx.log('[TelegramExecutor] Сообщение успешно опубликовано!');

    return {
      ok: true,
      output: { messageId: data.result.message_id },
    };
  }
}
```

---

### Шаг 4. Монтирование в сервер хоста (Никаких отдельных портов!)
Модуль монтируется прямо в существующий HTTP-сервер Express, Fastify или NestJS:

```typescript
// server.ts хост-приложения
import express from 'express';
import { createKanban } from './kanban-module/src/index';
import { TelegramPublisherExecutor } from './executors/telegram';
import { myAuthMiddleware } from './auth';

const app = express();
app.use(express.json());

// Инициализация модуля
const kanban = createKanban({
  sqlitePath: './app-data.db', // или собственный storage: new PostgresStorageAdapter(pool)
  executors: [
    new TelegramPublisherExecutor(process.env.TG_BOT_TOKEN!, process.env.TG_CHANNEL_ID!),
  ],
  routerOptions: {
    auth: myAuthMiddleware, // Защита эндпоинтов авторизацией хоста
  },
});

await kanban.init();

// Монтирование роутера модуля
app.use('/api/kanban', kanban.router);

app.listen(8080, () => {
  console.log('Хост-сервер запущен на порту 8080');
});
```

---

### Шаг 5. Встраивание UI в клиентское приложение
Вставьте компонент в нужную страницу хост-приложения (админ-панель, раздел автоматизации):

```tsx
// src/pages/AutomationsPage.tsx
import React from 'react';
import { KanbanBoard } from '../kanban-module/src/ui';

export const AutomationsPage: React.FC = () => {
  return (
    <div className="flex h-screen flex-col">
      <h2 className="p-4 text-xl font-bold">Оркестрация процессов</h2>
      <div className="flex-1 overflow-hidden">
        <KanbanBoard
          apiBase="/api/kanban"
          initialLocale="ru"
          initialTheme="dark"
        />
      </div>
    </div>
  );
};
```

---

## 🛡️ Таблица соглашений об изоляции (Isolation Conventions)

| Подсистема | Префикс эталона | Правило переноса |
|---|---|---|
| **Таблицы БД** | `kanban_*` | Сохраняйте префикс во избежание коллизий с существующими таблицами хоста |
| **API Маршруты** | `/api/kanban/*` | Настраивается через `apiBase` на клиенте и `app.use()` на сервере |
| **Переменные среды** | `KANBAN_*` | Читайте через единый модуль конфигурации хост-приложения |
| **CSS-классы UI** | `kb-*` | Все стили изолированы внутри `.kb-orchestrator-root`, не ломают стили хоста |
| **LocalStorage** | `kanban:*` | Предотвращает конфликты настроек тем и фильтров |

---

## 🔄 Кольцевая навигация

- ⬅️ **Предыдущий узел:** [Спецификация REST & SSE API (api.md)](./api.md)
- ➡️ **Следующий узел:** [Дизайн-система (design-system.md)](./design-system.md)
- 🔀 **Быстрый переход:** [Портал документации](./README.md) • [Архитектура](./architecture.md) • [Документация модуля](./kanban-module.md) • [CHANGELOG](./CHANGELOG.md) • [AGENTS.md](../AGENTS.md)
