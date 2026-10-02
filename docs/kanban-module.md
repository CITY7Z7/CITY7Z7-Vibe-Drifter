# 📦 Модуль «kanban-module»: Справочник архитектуры и API (kanban-module.md)

> **Полное руководство по внутреннему устройству автономного модуля оркестрации, фасаду `createKanban`, структуре пакета и доменным типам.**

---

## 🧭 Назначение и концепция модуля

Каталог `/kanban-module/` представляет собой **автономную, изолированную подсистему оркестрации задач**. Модуль спроектирован так, чтобы его можно было безболезненно перенести в любой проект на Node.js / TypeScript (Next.js, Express, Fastify, микросервис, CRM, админку) как эталонную реализацию.

Модуль сопровождается собственным манифестом `MODULE.json`, спецификацией переноса `INTEGRATION.md`, полным набором эталонных тестов (`tests/`) и 19 стартовыми шаблонами задач (`templates/starter.json`).

---

## 📁 Структура каталогов модуля

```
kanban-module/
├── MODULE.json                 # Манифест возможностей, зависимостей и изоляции
├── INTEGRATION.md              # Пошаговая инструкция по инъекции в хост-проект
├── README.md                   # Краткая памятка по модулю
├── src/
│   ├── index.ts                # Главная точка входа: фасад createKanban, реэкспорт
│   ├── core/                   # Чистая доменная математика без внешних библиотек
│   │   ├── types.ts            # Модели Task, Board, TaskStatus, TaskExecutor
│   │   ├── graph.ts            # Валидация DAG, обход DFS, поиск циклов, топология
│   │   ├── scheduler.ts        # Шедулер, maxParallel, каскадный сбой и авто-старт
│   │   ├── planner-parser.ts   # Детерминированный парсер планов и синтаксиса
│   │   ├── events.ts           # Внутрипроцессная шина событий (KanbanEventEmitter)
│   │   └── index.ts            # Реэкспорт ядра
│   ├── storage/                # Слой персистентности данных
│   │   ├── types.ts            # Интерфейс StorageAdapter
│   │   ├── sqlite-adapter.ts   # Продакшн-адаптер на better-sqlite3 (WAL-режим)
│   │   ├── memory-adapter.ts   # Быстрый RAM-адаптер для изоляции тестов
│   │   └── index.ts            # Реэкспорт адаптеров
│   ├── executors/              # Исполнители задач (воркеры)
│   │   ├── types.ts            # Интерфейсы ExecutionContext, ExecutionResult
│   │   ├── mock-executor.ts    # Симулятор работы с задержками и логами
│   │   ├── http-executor.ts    # Вызов внешних веб-хуков и микросервисов
│   │   ├── shell-executor.ts   # Песочница безопасного выполнения команд ОС
│   │   ├── registry.ts         # Реестр доступных воркеров
│   │   └── index.ts            # Реэкспорт воркеров
│   ├── planner/                # Планировщик и декомпозиция целей
│   │   ├── types.ts            # Спецификация генератора планов
│   │   ├── prompt.ts           # Системные промпты декомпозиции в DAG
│   │   ├── planner.ts          # UnifiedPlanner: парсер + LLM-адаптер
│   │   └── index.ts            # Реэкспорт планировщика
│   ├── server/                 # Транспортный HTTP-слой
│   │   ├── router.ts           # Фабрика Express Router (createKanbanRouter)
│   │   ├── sse.ts              # Менеджер потока Server-Sent Events (SSEManager)
│   │   └── index.ts            # Реэкспорт серверных утилит
│   ├── templates/              # Коллекция готовых шаблонов
│   │   ├── starter.json        # 19 эталонных графов задач
│   │   └── index.ts            # Загрузчик шаблонов
│   └── ui/                     # Реактивный фронтенд-компонент на React 19
│       ├── KanbanBoard.tsx     # Главная доска со всеми панелями
│       ├── Column.tsx          # Колонка канбан с нативным Drag & Drop
│       ├── TaskCard.tsx        # Карточка с подсветкой предков/потомков
│       ├── DependencyGraph.tsx # Интерактивный векторный граф зависимостей (SVG)
│       ├── TaskDetailModal.tsx # Терминал логов и редактор связей
│       ├── CreateTaskModal.tsx # Модальное окно быстрого создания карточки
│       ├── TemplateModal.tsx   # Каталог шаблонов по категориям
│       ├── PlannerChat.tsx     # Чат декомпозиции целей в граф
│       ├── useKanban.ts        # Кастомный хук управления состоянием и SSE
│       ├── i18n.ts             # Двуязычная локализация (RU / EN)
│       ├── types.ts            # Типы пропсов UI
│       └── index.ts            # Реэкспорт UI-компонентов
└── tests/                      # 56 эталонных тестов (Vitest + Playwright)
    ├── core/                   # Тесты графа, парсера и шедулера
    ├── storage/                # Тесты SQLite и Memory адаптеров
    ├── server/                 # Тесты REST API и Zod-валидации
    └── e2e/                    # Сквозные UI-тесты в браузере Playwright
```

---

## 🛠️ Главный фасад: `createKanban(options)`

Для создания полностью настроенного экземпляра подсистемы в Node.js используется главная функция-фабрика `createKanban`:

```typescript
import { createKanban, MockExecutor, HttpExecutor } from './kanban-module/src/index';

const kanban = createKanban({
  // 1. Путь к файлу базы данных SQLite (или передайте свой StorageAdapter)
  sqlitePath: './kanban-data.db',

  // 2. Список зарегистрированных исполнителей задач
  executors: [
    new MockExecutor({ id: 'mock', defaultDelayMs: 500 }),
    new HttpExecutor({ id: 'http', timeoutMs: 15000 }),
  ],

  // 3. Дополнительные опции роутера (например, авторизация хоста)
  routerOptions: {
    auth: (req, res, next) => {
      // Ваша проверка сессии / JWT
      next();
    },
  },
});

// Асинхронная инициализация: накат миграций, восстановление задач после рестарта
await kanban.init();

// Монтирование готового Express-роутера в приложение
app.use('/api/kanban', kanban.router);
```

### Параметры конфигурации (`CreateKanbanOptions`):

| Поле | Тип | По умолчанию | Описание |
|---|---|---|---|
| `sqlitePath` | `string` | `':memory:'` | Путь к файлу базы SQLite. Игнорируется, если передан `storage`. |
| `storage` | `StorageAdapter` | `SQLiteStorageAdapter` | Пользовательский адаптер хранилища (Postgres, Mongo и т.д.). |
| `executors` | `TaskExecutor[]` | `[MockExecutor]` | Коллекция зарегистрированных исполнителей задач. |
| `events` | `KanbanEventEmitter` | `new KanbanEventEmitter()` | Экземпляр шины событий модуля. |
| `planner` | `UnifiedPlanner` | `new UnifiedPlanner()` | Экземпляр парсера и генератора планов. |
| `routerOptions`| `KanbanRouterOptions`| `{}` | Настройки Express-роутера (`auth` middleware). |

### Возвращаемый объект (`KanbanInstance`):

- `init(): Promise<void>` — подготовка таблиц базы данных и вызов восстановления прерванных задач (`recoverInterruptedTasks`).
- `router: Router` — готовый Express Router со всеми REST и SSE маршрутами.
- `storage: StorageAdapter` — прямой доступ к адаптеру данных.
- `scheduler: Scheduler` — экземпляр планировщика для управления паузой, лимитами и прямым запуском задач.
- `events: KanbanEventEmitter` — шина реактивных событий приложения.
- `planner: UnifiedPlanner` — сервис разбора инструкций и генерации графов задач.
- `close(): Promise<void>` — корректная остановка шедулера, закрытие соединений БД и сброс слушателей.

---

## 🧩 Манифест возможностей: `MODULE.json`

Файл манифеста `MODULE.json` служит машинно-читаемой спецификацией для системных агентов:

```json
{
  "name": "CITY7Z7-Vibe-Drifter",
  "version": "1.0.0",
  "capabilities": [
    "dag-graph-validation",
    "topological-layers-layout",
    "parallel-task-scheduler",
    "auto-chain-triggers",
    "deterministic-plan-parser",
    "llm-goal-decomposition",
    "sse-realtime-events",
    "pluggable-storage-adapters",
    "pluggable-task-executors",
    "19-starter-templates",
    "scoped-ui-components",
    "bilingual-i18n-ru-en"
  ],
  "isolationConventions": {
    "tablePrefix": "kanban_",
    "routePrefix": "/api/kanban",
    "envPrefix": "KANBAN_",
    "cssClassPrefix": "kb-",
    "localStoragePrefix": "kanban:"
  }
}
```

---

## 💻 Использование UI-компонента в React

Фронтенд-компонент `<KanbanBoard />` полностью автономен и готов к внедрению в любой React-проект:

```tsx
import React from 'react';
import { KanbanBoard } from './kanban-module/src/ui';

export default function MyDashboardPage() {
  return (
    <div className="h-screen w-full">
      <KanbanBoard
        apiBase="/api/kanban"      // Базовый путь к смонтированному роутеру
        initialLocale="ru"          // Начальный язык: 'ru' | 'en'
        initialTheme="dark"         // Тема: 'dark' | 'light'
        customTitle="Оркестратор микросервисов"
      />
    </div>
  );
}
```

---

## 🔄 Кольцевая навигация

- ⬅️ **Предыдущий узел:** [Системная архитектура (architecture.md)](./architecture.md)
- ➡️ **Следующий узел:** [Спецификация REST & SSE API (api.md)](./api.md)
- 🔀 **Быстрый переход:** [Портал документации](./README.md) • [Руководство по интеграции](./integration-guide.md) • [Дизайн-система](./design-system.md) • [CHANGELOG](./CHANGELOG.md)
