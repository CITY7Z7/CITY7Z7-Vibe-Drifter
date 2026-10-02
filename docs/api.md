# 🔌 Спецификация REST & SSE API (api.md)

> **Полное техническое описание всех HTTP эндпоинтов, схем валидации Zod, структуры потока Server-Sent Events и кодов ошибок.**

---

## 🧭 Базовые соглашения и форматы

- **Базовый префикс маршрутов:** `/api/kanban` (настраивается через параметр `apiBase`).
- **Формат обмена данными:** `application/json; charset=utf-8`.
- **Единая сигнатура ответов сервера:**
  ```typescript
  // Успешный ответ:
  { "ok": true, "data": T }

  // Ответ с ошибкой:
  { "ok": false, "error": "Описание причины сбоя" }
  ```
- **Валидация:** Все входящие тела запросов (`req.body`) и параметры маршрутов (`req.params`) строго валидируются через схемы библиотеки **Zod**.

---

## ⚡ 1. Реактивный поток событий (Server-Sent Events)

### `GET /api/kanban/events`
Устанавливает постоянное полнодуплексное (сервер -> клиент) текстовое соединение для трансляции изменений на доске в реальном времени.

- **Заголовки ответа сервера:**
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache`
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no`
- **Heartbeat:** Каждые 15 секунд сервер передает комментарий `: ping\n\n`.
- **Формат события:**
  ```text
  event: <event_name>
  data: {"type": "<event_name>", "payload": { ... }}
  ```

### Типы событий SSE:

| Имя события | Полезная нагрузка (`payload`) | Когда генерируется |
|---|---|---|
| `task:created` | `Task` | Создана новая задача вручную или через планировщик |
| `task:updated` | `Task` | Изменение статуса, приоритета, попыток или зависимостей |
| `task:deleted` | `{ id: string, boardId: string }` | Удаление задачи с доски |
| `task:log` | `{ id: string, line: string }` | Новая строка лога от исполняемого воркера |
| `task:progress`| `{ id: string, progress: number }`| Обновление процента выполнения (0–100%) |
| `board:updated`| `Board` | Изменение названия или настроек доски |
| `board:paused` | `{ boardId: string }` | Шедулер поставлен на паузу |
| `board:resumed`| `{ boardId: string }` | Шедулер возобновил работу |

---

## 📋 2. Управление досками (Boards API)

### `GET /api/kanban/boards`
Возвращает список всех досок. Если в базе еще нет досок, автоматически создает и возвращает доску по умолчанию (`id: 'default'`).

### `POST /api/kanban/boards`
Создает новую канбан-доску.
- **Тело запроса (JSON):**
  ```json
  {
    "name": "Разработка платежного шлюза",
    "settings": {
      "maxParallel": 4,
      "autoChain": true,
      "recoverPolicy": "fail",
      "defaultExecutor": "mock"
    }
  }
  ```

### `GET /api/kanban/boards/:id`
Возвращает модель конкретной доски по ее идентификатору.

### `PATCH /api/kanban/boards/:id`
Частичное обновление доски (название, `maxParallel`, `autoChain`, `recoverPolicy`).

### `DELETE /api/kanban/boards/:id`
Удаление доски и всех привязанных к ней задач и связей.

### `POST /api/kanban/boards/:id/pause`
Приостанавливает диспетчеризацию шедулера на указанной доске. Выполняемые задачи завершаются, новые из очереди `ready` не запускаются.

### `POST /api/kanban/boards/:id/resume`
Возобновляет работу шедулера на доске и немедленно инициирует `scheduler.tick()`.

---

## 📌 3. Управление задачами (Tasks API)

### `GET /api/kanban/boards/:boardId/tasks`
Возвращает полный массив всех задач для заданной доски.

### `POST /api/kanban/boards/:boardId/tasks`
Создает новую карточку задачи.
- **Тело запроса (JSON):**
  ```json
  {
    "title": "Интеграция Stripe Checkout",
    "prompt": "Сгенерировать контроллер обработки вебхуков Stripe",
    "status": "backlog",
    "executor": "mock",
    "priority": 5,
    "labels": ["backend", "payments"],
    "dependsOn": [],
    "maxAttempts": 3,
    "timeoutMs": 60000,
    "requireReview": true
  }
  ```

### `GET /api/kanban/tasks/:id`
Получение карточки задачи со всеми логами, артефактами и метаданными.

### `PATCH /api/kanban/tasks/:id`
Обновление полей задачи (`title`, `prompt`, `priority`, `labels`, `executor`).

### `DELETE /api/kanban/tasks/:id`
Удаление задачи. Автоматически удаляет все входящие и исходящие связи этой карточки в других задачах.

### `POST /api/kanban/tasks/:id/status`
Ручной перенос карточки между колонками (например, Drag & Drop). Проверяется валидность перехода по матрице FSM.
- **Тело запроса:** `{ "status": "ready" }`

---

## 🚀 4. Управление жизненным циклом и шедулером (Task Lifecycle)

### `POST /api/kanban/tasks/:id/run`
Мгновенный перевод задачи в статус `ready` и вызов тика шедулера. Если у задачи включен `autoChain: true`, активирует всю цепочку зависимостей.

### `POST /api/kanban/tasks/:id/cancel`
Отменяет исполнение активной задачи. Шедулер посылает сигнал `AbortSignal` воркеру, задача переводится в статус `failed` с текстом `Cancelled by user`.

### `POST /api/kanban/tasks/:id/retry`
Повторный запуск упавшей задачи. Сбрасывает статус в `ready`, очищает ошибку и разблокирует всех потомков, переведенных ранее в статус `blocked`.

### `POST /api/kanban/tasks/:id/approve`
Подтверждение результата выполнения задачи, находящейся на этапе `review`. Задача переходит в `done` и разблокирует зависимые карточки.

### `POST /api/kanban/tasks/:id/reject`
Отклонение результата ревью. Задача переводится в статус `failed` с пометкой `Rejected in review`.

---

## 🔗 5. Граф зависимостей и связи (Graph & Links API)

### `POST /api/kanban/tasks/:id/links`
Добавление зависимости к задаче (задача `:id` начинает зависеть от задачи `depId`).
- **Тело запроса:** `{ "depId": "task-abc-123" }`
- **Проверки:** Выполняется проверка на отсутствие цикла (DFS). Если добавление ребра образует контур, сервер вернет статус `400 Bad Request`.

### `DELETE /api/kanban/tasks/:id/links/:depId`
Удаление зависимости между задачами.

### `GET /api/kanban/boards/:boardId/graph`
Возвращает полную топологическую структуру графа доски для визуализации.
- **Ответ сервера:**
  ```json
  {
    "ok": true,
    "data": {
      "nodes": [
        { "id": "t1", "depth": 0, "status": "done" },
        { "id": "t2", "depth": 1, "status": "in_progress" }
      ],
      "links": [
        { "from": "t1", "to": "t2" }
      ],
      "hasCycle": false,
      "layers": [["t1"], ["t2"]]
    }
  }
  ```

---

## 🧠 6. Планировщик и чат (Planner & Chat API)

### `POST /api/kanban/boards/:boardId/plan/preview`
Анализирует текст цели или инструкцию и возвращает разобранный черновик графа без создания задач в базе.
- **Тело запроса:** `{ "text": "1. Собрать базу данных -> 2. Написать API -> 3. Покрыть тестами\nstart: 1" }`
- **Ответ сервера (`PlanPreview`):**
  ```json
  {
    "ok": true,
    "data": {
      "tasks": [
        { "id": "1", "title": "Собрать базу данных", "prompt": "..." },
        { "id": "2", "title": "Написать API", "prompt": "..." },
        { "id": "3", "title": "Покрыть тестами", "prompt": "..." }
      ],
      "links": [
        { "from": "1", "to": "2" },
        { "from": "2", "to": "3" }
      ],
      "start": ["1"],
      "warnings": []
    }
  }
  ```

### `POST /api/kanban/boards/:boardId/plan/apply`
Материализует предварительный план (`PlanPreview`) на доске: создает реальные карточки задач в SQLite/Postgres, строит зависимости между ними и переводит стартовые задачи в статус `ready`.

### `GET /api/kanban/boards/:boardId/chat`
Получение истории сообщений чата планировщика.

### `POST /api/kanban/boards/:boardId/chat`
Отправка сообщения в чат. Если текст содержит инструкции планирования, планировщик формирует черновик плана в поле `planPreview`.

---

## 📑 7. Шаблоны и исполнители (Templates & Executors)

### `GET /api/kanban/templates`
Возвращает список доступных шаблонов (19 встроенных из `starter.json` + пользовательские).

### `GET /api/kanban/executors`
Возвращает список зарегистрированных типов воркеров (например: `['mock', 'http', 'shell']`).

---

## ⚠️ Коды состояний HTTP и обработка ошибок

| HTTP Код | Название | Причина возникновения |
|---|---|---|
| `200 OK` | Успешно | Операция выполнена, в теле возвращен `{ ok: true, data: ... }` |
| `400 Bad Request` | Ошибка валидации | Некорректный JSON, ошибка Zod, попытка создать цикл в графе или недопустимый переход FSM |
| `404 Not Found` | Не найдено | Запрашиваемая задача, доска или шаблон не существуют |
| `409 Conflict` | Конфликт состояния | Попытка запустить уже выполняющуюся задачу или дубликат уникального ключа |
| `500 Server Error`| Внутренний сбой | Ошибка базы данных или неперехваченное исключение воркера |

---

## 🔄 Кольцевая навигация

- ⬅️ **Предыдущий узел:** [Документация модуля kanban-module (kanban-module.md)](./kanban-module.md)
- ➡️ **Следующий узел:** [Руководство по интеграции (integration-guide.md)](./integration-guide.md)
- 🔀 **Быстрый переход:** [Портал документации](./README.md) • [Архитектура](./architecture.md) • [Дизайн-система](./design-system.md) • [CHANGELOG](./CHANGELOG.md)
