# Architecture Overview CITY7Z7-Vibe-Drifter (`v1.0.0`)

## Файловая структура проекта (Architecture Schema)

> Снято с диска в `v1.0.0`. При любом добавлении/переименовании/перемещении/удалении файлов - обновлять дерево


---


```text
kanban-module/
├── INTEGRATION.md
├── MODULE.json
├── README.md
├── src/
│   ├── core/
│   │   ├── events.ts
│   │   ├── graph.ts
│   │   ├── index.ts
│   │   ├── planner-parser.ts
│   │   ├── scheduler.ts
│   │   └── types.ts
│   ├── executors/
│   │   ├── http-executor.ts
│   │   ├── index.ts
│   │   ├── mock-executor.ts
│   │   ├── registry.ts
│   │   ├── shell-executor.ts
│   │   └── types.ts
│   ├── index.ts
│   ├── planner/
│   │   ├── index.ts
│   │   ├── planner.ts
│   │   ├── prompt.ts
│   │   └── types.ts
│   ├── server/
│   │   ├── index.ts
│   │   ├── router.ts
│   │   └── sse.ts
│   ├── storage/
│   │   ├── index.ts
│   │   ├── memory-adapter.ts
│   │   ├── sqlite-adapter.ts
│   │   └── types.ts
│   ├── templates/
│   │   ├── index.ts
│   │   └── starter.json
│   └── ui/
│       ├── Column.tsx
│       ├── CreateTaskModal.tsx
│       ├── DependencyGraph.tsx
│       ├── i18n.ts
│       ├── index.ts
│       ├── KanbanBoard.tsx
│       ├── PlannerChat.tsx
│       ├── TaskCard.tsx
│       ├── TaskDetailModal.tsx
│       ├── TemplateModal.tsx
│       ├── types.ts
│       └── useKanban.ts
└── tests/
    ├── core/
    │   ├── graph.test.ts
    │   ├── parser.test.ts
    │   └── scheduler.test.ts
    ├── e2e/
    │   └── kanban.spec.ts
    ├── server/
    │   └── api.test.ts
    └── storage/
        └── storage.test.ts

demo/
├── App.tsx
└── server.ts
```

---

## 2. Вывод команд сборки, юнит-тестов и E2E

### А. Сборка проекта (npm run build)
```text
> react-example@0.0.0 build
> vite build

vite v8.3.2 building client environment for production...
transforming...
✓ 30 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   1.11 kB │ gzip:   0.51 kB
dist/assets/index-3eNvUxEz.css   38.63 kB │ gzip:   7.27 kB
dist/assets/index-2ylCmEvo.js   504.72 kB │ gzip: 146.64 kB
✓ built in 435ms
```

---

### Б. Модульные и интеграционные тесты (npm test)

```text
> react-example@0.0.0 test
> vitest run

 RUN  v5.0.3 /app/applet

 ✓ kanban-module/tests/core/scheduler.test.ts (9 tests) 1981ms
   ✓ Шедулер оркестратора: Тест-кейсы 2–10 (9)
     ✓ Кейс 2: Цепочка 1 → 2 → 3 выполняется строго по порядку 368ms
     ✓ Кейс 3: Веер 1 → 2, 1 → 3, 1 → 4 — карточки 2, 3, 4 стартуют одновременно после 1 304ms
     ✓ Кейс 4: Схождение 2 → 5, 3 → 5, 4 → 5 — карточка 5 стартует только после завершения всех трех
     ✓ Кейс 5: При maxParallel = 2 одновременно выполняется не больше двух карточек
     ✓ Кейс 6: Падение карточки 2 переводит потомков в blocked; Retry возвращает их в ready 436ms
     ✓ Кейс 7: Start карточки с предком в backlog оставляет её в ready и молча не запускает
     ✓ Кейс 8: Cancel для in_progress вызывает AbortSignal, карточка становится failed (cancelled)
     ✓ Кейс 9: Карточка с requireReview останавливается в review, Approve переводит в done и запускает потомков
     ✓ Кейс 10: При recoverPolicy = fail карточки in_progress становятся failed (interrupted); при requeue возвращаются в ready
 ✓ kanban-module/tests/server/api.test.ts (9 tests) 195ms
   ✓ Кейсы 12 и 13: REST API и Встроенный режим (Embedded Mode)
     ✓ Кейс 13: Хозяйские маршруты и изоляция Express работают корректно
     ✓ Кейс 13: Монтирование под другим префиксом (/custom/kanban)
     ✓ Кейс 12: GET /boards возвращает дефолтную доску
     ✓ Кейс 12: POST /tasks валидирует обязательные поля через Zod
     ✓ Кейс 12: Создание задачи и жизненный цикл (Start, Cancel, Retry, Approve)
     ✓ Кейс 12: PATCH /tasks/:id блокирует недопустимый переход статуса (backlog -> done)
     ✓ Кейс 12: POST /tasks/:id/links проверяет ацикличность
     ✓ Кейс 12: Планировщик POST /planner/plan и POST /planner/apply
     ✓ Кейс 12: Управление шедулером (Pause / Resume / Status)
 ✓ kanban-module/tests/storage/storage.test.ts (5 tests) 40ms
   ✓ Storage Adapters: SQLite и Memory
     ✓ SQLiteStorageAdapter: создает таблицы исключительно с префиксом kanban_*
     ✓ SQLiteStorageAdapter: повторный вызов init() идемпотентен и не ломает существующие данные
     ✓ SQLiteStorageAdapter: автоматически наполняет таблицу шаблонов 19 встроенными шаблонами
     ✓ SQLiteStorageAdapter: выполняет полный CRUD для сущности Task
     ✓ MemoryStorageAdapter: корректно хранит сообщения чата
 ✓ kanban-module/tests/core/graph.test.ts (10 tests) 24ms
   ✓ Кейс 1: Граф зависимостей и валидация циклов
     ✓ отклоняет самосвязь (задача не может зависеть от самой себя)
     ✓ отклоняет связь с несуществующей карточкой
     ✓ отклоняет создание прямого цикла из двух задач (A -> B -> A)
     ✓ отклоняет создание длинного цикла (A → B → C → A)
     ✓ запрещает менять связи у карточек в статусе in_progress и done
     ✓ функция validateGraphAcyclic успешно пропускает валидный DAG
     ✓ функция validateGraphAcyclic обнаруживает цикл в полном наборе задач
     ✓ корректно рассчитывает топологические слои (computeGraphLayers)
   ✓ Валидация ручных переходов карточек
     ✓ разрешает допустимые переходы
     ✓ отклоняет недопустимые переходы с информативной ошибкой
 ✓ kanban-module/tests/core/parser.test.ts (23 tests) 21ms
   ✓ Кейс 11: Тестирование детерминированного парсера по эталонным графам (все 19 шаблонов Приложения А)
   ✓ Вариации стрелок и русскоязычные формулировки

 Test Files  5 passed (5)
      Tests  56 passed (56)
   Duration  4.28s
```

### В. Результат Playwright E2E (npm run test:e2e)

```text
> react-example@0.0.0 test:e2e
> playwright test

Running 1 test using 1 worker
  ✓  1 [chromium] › kanban-module/tests/e2e/kanban.spec.ts:16:3 › Кейс 15: Сквозной E2E-сценарий (Playwright) › Применение шаблона №4 (Full-stack with database) и параллельное выполнение карточек 3 и 5 (1.2s)

  1 passed (2.3s)
```

---

## 3. Список реализованных REST-маршрутов (kanban-module/src/server/router.ts)

| HTTP-метод | Маршрут | Описание |
| --- | --- | --- |
| `GET` | `/events` | Нативный SSE-поток реалтайм-событий с keep-alive heartbeat |
| `GET` | `/boards` | Список всех досок проекта (с автосозданием default) |
| `POST` | `/boards` | Создание новой доски с настройками `maxParallel`, `autoChain`, `recoverPolicy` |
| `GET` | `/boards/:id` | Получение доски и всех ее задач |
| `PATCH` | `/boards/:id` | Обновление названия и настроек доски |
| `DELETE` | `/boards/:id` | Каскадное удаление доски |
| `GET` | `/boards/:id/tasks` | Список задач доски (сортировка по приоритету и времени) |
| `POST` | `/tasks` | Создание новой задачи с топологической валидацией графа |
| `PATCH` | `/tasks/:id` | Обновление задачи с валидацией допустимых переходов статусов |
| `DELETE` | `/tasks/:id` | Удаление задачи с очисткой зависимостей у потомков |
| `POST` | `/tasks/:id/links` | Добавление связи `depId` → `id` с валидацией ацикличности |
| `DELETE` | `/tasks/:id/links/:depId` | Удаление связи зависимости между задачами |
| `POST` | `/tasks/:id/start` | Запуск задачи и каскадный перевод потомков в `ready` (при `autoChain`) |
| `POST` | `/tasks/:id/cancel` | Отмена задачи с сигналом `AbortSignal` исполнителю и блокировкой потомков |
| `POST` | `/tasks/:id/retry` | Повторный запуск упавшей задачи и перевод потомков из `blocked` в `ready` |
| `POST` | `/tasks/:id/approve` | Подтверждение задачи в статусе `review` и старт потомков |
| `POST` | `/tasks/:id/reject` | Возврат задачи из `review` на доработку в статус `ready` |
| `POST` | `/planner/plan` | Разбор текста/цели/шаблона в превью графа (задачи, связи, запуск) |
| `POST` | `/planner/apply` | Применение превью плана к доске и опциональный автостарт |
| `GET` | `/boards/:id/chat` | История сообщений чата планировщика |
| `POST` | `/boards/:id/chat` | Добавление сообщения в чат |
| `POST` | `/scheduler/pause` | Приостановка шедулера (текущие задачи не прерываются, новые не берутся) |
| `POST` | `/scheduler/resume` | Возобновление работы шедулера и запуск цикла проверки очереди |
| `GET` | `/scheduler/status` | Текущее состояние шедулера (`isPaused`, `runningTaskIds`) |
| `GET` | `/templates` | Список доступных шаблонов (19 встроенных + пользовательские) |
| `POST` | `/templates` | Сохранение пользовательского шаблона |

---

## 4. Итоговый список зависимостей из MODULE.json
```js
{
  "referenceDependencies": {
    "better-sqlite3": "^13.0.3",
    "zod": "^4.6.5",
    "express": "^4.21.2",
    "react": "^19.0.1",
    "react-dom": "^19.0.1"
  },
  "referenceDevDependencies": {
    "vitest": "^5.0.3",
    "supertest": "^7.3.0",
    "@playwright/test": "^1.63.0",
    "@types/better-sqlite3": "^9.6.0",
    "@types/supertest": "^7.2.1",
    "@types/express": "^4.17.21"
  }
}
```

---

## 5. Что осталось нереализованным и почему (честный список ограничений)

1. **Shell-исполнитель (ShellExecutor)**:
* Реализован, но в строгом соответствии с ТЗ **выключен по умолчанию (enabled: false)**. Для выполнения системных команд в продакшене требуется явное указание **enabled: true** и белый список префиксов команд **(allowedCommands)**, чтобы исключить уязвимости выполнения произвольного кода.

2. **Внешний LLM API ключ**:
* В ядре модуля намеренно отсутствует захардкоженный ключ API или прямой вызов внешней сети (в полном соответствии с требованиями переносимости). 
Детерминированный парсер работает автономно со 100% точностью для всех 19 шаблонов. Для разбора свободных целей хост подключает свой PlannerAdapter (например, Google Gemini, OpenAI, Claude или локальную модель).

3. **Виртуализация списков для 10 000+ карточек**:
Текущая отрисовка React оптимизирована для типовых досок (до сотен задач одновременно). Для экстремальных объёмов (десятки тысяч задач на одной доске) в хост-системе рекомендуется добавить постраничную пагинацию или виртуальный скроллинг колонок.

---

## 6. Как запустить демо и как перенести модуль в другой проект

### Запуск Демо

* Сервер запущен на http://localhost:3000.
* В браузере открывается интерактивная среда:
  - Колонки Канбан с нативным Drag & Drop
  - Вкладка «Граф» с топологической SVG-схемой и статусной подсветкой;
  - Боковая панель чата планировщика;
  - Модальное окно библиотеки из 19 готовых шаблонов (Greenfield, Modernization, Testing, Features, DevOps);
  - Индикаторы параллелизма, управление паузой и реалтайм-лог карточки.

### Перенос в другой проект

Подробная пошаговая процедура описана в файле **kanban-module/INTEGRATION.md**:

* **Инъекция (по умолчанию)**: Скопировать папку **kanban-module/**, прочитать **src/core/** и **tests/** как спецификацию поведения, переписать/встроить доменные модели и шедулер под структуру хозяина, сохранить тесты зелёными.

* Прямое подключение: Если стек совпадает **(TypeScript / Express / React / SQLite)**, использовать готовую функцию `createKanban({ storage, executors, routerOptions })` и монтировать роутер `app.use('/api/kanban', kanban.router)` без создания отдельного процесса или порта.


---

## Ссылки и изображения

![Интерфейс](image.jpg)

 
