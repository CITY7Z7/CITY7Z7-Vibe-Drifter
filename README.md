# ⚡ CITY7Z7-Vibe-Drifter: Движок оркестрации и визуального управления задачами

[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-blue.svg)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19.0-61dafb.svg)](https://react.dev/)
[![Express 4.21](https://img.shields.io/badge/Express-4.21-lightgrey.svg)](https://expressjs.com/)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL%20Better--sqlite3-brightgreen.svg)](https://github.com/WiseLibs/better-sqlite3)
[![Tests Passing](https://img.shields.io/badge/Tests-56%20Passed-success.svg)](./docs/workflows-and-testing.md)
[![Documentation Ring](https://img.shields.io/badge/Docs-Ring%20Connected-orange.svg)](./docs/README.md)

> **CITY7Z7-Vibe-Drifter** — это эталонная full-stack система и встраиваемый модуль (`kanban-module`) для оркестрации сложных асинхронных процессов. Система выполняет автоматическую трансляцию высокоуровневых целей в ориентированный ациклический граф (DAG), управляет параллельным исполнением задач с контролем пула потоков (`maxParallel`), каскадно запускает цепочки зависимостей и обеспечивает реактивное отображение прогресса по протоколу Server-Sent Events (SSE).

---

## 🌟 Ключевые возможности системы

1. **Математически строгое ядро DAG:**
   - Алгоритм поиска циклов на основе трехцветного обхода в глубину (Three-Color DFS). Исключает зацикливание зависимостей ещё на этапе валидации.
   - Автоматический расчет топологических слоев глубины (Topological Layers) для ярусной визуализации графа слева направо.
2. **Интеллектуальный шедулер задач:**
   - Контроль параллелизма (`maxParallel` от 1 до 20) с приоритетной очередью (`priority` DESC, `createdAt` ASC).
   - Автоматический каскадный запуск (`autoChain`): переход зависимой карточки из `backlog` в `ready` при успешном завершении предка.
   - Каскадная обработка ошибок: при падении задачи все ее прямые и транзитивные потомки автоматически переводятся в статус `blocked`.
   - Восстановление прерванных задач при рестарте сервера (`recoverPolicy`: `fail` или `requeue`).
3. **Реактивный интерфейс на React 19:**
   - 7 колонок жизненного цикла задачи (`backlog`, `ready`, `in_progress`, `review`, `done`, `failed`, `blocked`).
   - Нативный HTML5 Drag & Drop с проверкой разрешенных переходов FSM.
   - Интерактивная «родословная» задач: при наведении курсора предки подсвечиваются янтарным контуром, а потомки — бирюзовым.
   - Векторный интерактивный граф зависимостей (SVG) с кубическими сплайнами Безье и масштабированием.
   - Встроенный выдвижной чат-планировщик для декомпозиции целей в задачи и 19 готовых инженерных шаблонов.
4. **Низкие накладные расходы (SSE Transport):**
   - Потоковая передача логов исполнения (`task:log`), прогресса (0–100%) и смены статусов без блокирующего полинга.
   - Автоматический Keep-Alive heartbeat (пинги каждые 15 секунд).
5. **Сменные адаптеры хранения и исполнители:**
   - Хранилище: `SQLiteStorageAdapter` (режим WAL, каскадные ключи) и `MemoryStorageAdapter` (RAM для изоляции тестов).
   - Воркеры (`TaskExecutor`): `MockExecutor` (симуляция), `HttpExecutor` (веб-хуки и внешние API), `ShellExecutor` (терминальные команды).
6. **Полная изоляция и переносимость:**
   - Модуль `kanban-module/` автономен. Использует префиксы `kb-*` (CSS), `kanban_*` (БД), `/api/kanban/*` (API). Готов к инъекции в сторонние проекты согласно руководству `INTEGRATION.md`.

---

## 🚀 Быстрый запуск

### Требования к окружению
- **Node.js:** v20.x или выше
- **Менеджер пакетов:** npm v10.x или выше

### 1. Установка зависимостей
```bash
npm install
```

### 2. Запуск локального сервера разработки
```bash
npm run dev
```
После старта приложение доступно по адресу: **`http://localhost:3000`**

### 3. Запуск полного набора тестов (56 тестов Vitest)
```bash
npm test
```

### 4. Запуск сквозного E2E тестирования (Playwright)
```bash
npm run test:e2e
```

### 5. Проверка типов TypeScript (Typecheck)
```bash
npm run lint
```

### 6. Сборка для продакшна
```bash
npm run build
npm start
```

---

## 🏛️ Архитектурная карта системы

```
                             [ Вход пользователя ]
                                       │
                                       ▼
                     ┌──────────────────────────────────┐
                     │   React 19 Single Page App       │
                     │  - KanbanBoard (7 колонок)       │
                     │  - DependencyGraph (SVG canvas)  │
                     │  - PlannerChat (LLM decomposition│
                     │  - useKanban Hook (State & SSE)  │
                     └─────────────────┬────────────────┘
                                       │ HTTP REST & SSE stream
                                       ▼
                     ┌──────────────────────────────────┐
                     │  Express Server (server.ts:3000) │
                     │  - createKanbanRouter            │
                     │  - SSEManager (keepalive ping)   │
                     │  - Zod Request Validators        │
                     └─────────────────┬────────────────┘
                                       │ In-Process Calls
                                       ▼
                     ┌──────────────────────────────────┐
                     │     Kanban Core Orchestrator     │
                     │  - Scheduler (maxParallel, tick) │
                     │  - Graph (DFS cycle detection)   │
                     │  - KanbanEventEmitter (Bus)      │
                     └─────────┬──────────────┬─────────┘
                               │              │
        ┌──────────────────────┘              └─────────────────────┐
        ▼                                                           ▼
┌──────────────────────────────┐            ┌───────────────────────────────┐
│     STORAGE ADAPTERS         │            │        TASK EXECUTORS         │
│  SQLiteStorageAdapter (WAL)  │            │  MockExecutor (Simulated lag) │
│  MemoryStorageAdapter (RAM)  │            │  HttpExecutor (REST calls)    │
│  *Готов к Postgres / Mongo   │            │  ShellExecutor (Safe bash)    │
└──────────────────────────────┘            └───────────────────────────────┘
```

---

## 📁 Структура репозитория

```
├── README.md                   # Главная точка входа в проект (данный файл)
├── package.json                # Спецификация зависимостей и скрипты
├── server.ts                   # Главный сервер приложения: Express + Vite middleware + SQLite
├── index.html                  # HTML-каркас клиентского приложения
├── docs/                       # 📚 База знаний с кольцевой навигацией
│   ├── README.md               # Портал документации и маршруты чтения
│   ├── architecture.md         # Глубокий разбор математики DAG, FSM и шедулера
│   ├── kanban-module.md        # Справочник по автономному модулю kanban-module
│   ├── api.md                  # Спецификация всех REST & SSE эндпоинтов и схем Zod
│   ├── integration-guide.md    # Пошаговая инъекция модуля в чужие проекты
│   ├── design-system.md        # Дизайн-система, токены, темы и правила кастомизации
│   ├── workflows-and-testing.md# Запуск тестов, дебаггинг и рабочие процессы
│   └── CHANGELOG.md            # Детальный хронологический журнал изменений версий
├── kanban-module/              # 📦 Автономный модуль оркестрации (встраиваемый)
│   ├── MODULE.json             # Манифест возможностей и правил изоляции
│   ├── INTEGRATION.md          # Краткая инструкция по переносу модуля
│   ├── src/                    # Исходный код (core, storage, executors, planner, server, ui)
│   └── tests/                  # 56 эталонных тестов (Unit, Integration, E2E)
├── demo/                       # Демонстрационная песочница
│   ├── App.tsx                 # Обвязка песочницы с кнопкой сброса и верхним баром
│   └── server.ts               # Изолированный сервер демо
└── src/                        # Клиентский корень приложения
    ├── App.tsx                 # Монтирование DemoApp
    ├── main.tsx                # Инициализация React 19
    └── index.css               # Tailwind CSS v4 импорт
```

---

## 🔄 Кольцевая навигация по документации (Documentation Ring)

Каждый документ базы знаний связан в единую замкнутую логическую цепь. Начните погружение с любого удобного узла:

- ➡️ **Следующий узел по кольцу:** [📚 Портал документации (/docs/README.md)](./docs/README.md)
- 🏛️ **Системная архитектура и математика DAG:** [/docs/architecture.md](./docs/architecture.md)
- 📦 **Анатомия модуля `kanban-module`:** [/docs/kanban-module.md](./docs/kanban-module.md)
- 🔌 **Спецификация REST & SSE API:** [/docs/api.md](./docs/api.md)
- 💉 **Руководство по интеграции в сторонние проекты:** [/docs/integration-guide.md](./docs/integration-guide.md)
- 🎨 **Дизайн-система и кастомизация интерфейса:** [/docs/design-system.md](./docs/design-system.md)
- 🧪 **Тестирование, верификация и запуск:** [/docs/workflows-and-testing.md](./docs/workflows-and-testing.md)
- 📜 **История коммитов и версий:** [/docs/CHANGELOG.md](./docs/CHANGELOG.md)
