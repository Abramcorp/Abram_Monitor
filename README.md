# Deal Monitor

Standalone-сервис для мониторинга состояния сделок: текущие воронки, завершенные сделки, аналитика и сводный отчет.

## Запуск

```bash
npm start
```

По умолчанию сервис доступен на `http://localhost:3000`.

## Railway + PostgreSQL

Для многопользовательского режима сервис использует PostgreSQL, если задана переменная окружения `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `DATABASE_PRIVATE_URL` или `POSTGRES_URL`.

На Railway:

1. Создать сервис из репозитория.
2. Добавить Railway PostgreSQL plugin к проекту.
3. Убедиться, что у web-сервиса есть переменная `DATABASE_URL` или `DATABASE_PUBLIC_URL`.
4. Deploy запустит `npm start`; при первом старте сервис сам создаст таблицы и перенесет начальные данные из `data/*.json`.

На Railway сервис не стартует без PostgreSQL-переменных, чтобы не потерять аналитиков, клиентов и заявки при redeploy. Локально без PostgreSQL-переменных приложение продолжает работать через JSON-файлы. Это удобно для быстрой разработки и тестов.

Если внешний PostgreSQL требует SSL, можно добавить переменную:

```bash
PGSSLMODE=require
```

## Архитектура MVP

- `data/deals.json` - локальная база сделок.
- `data/banks.json` - задел под вторую часть: база банков и условий.
- `src/analytics.js` - нормализация сделок и расчет отчетов.
- `src/store.js` - единый слой данных: PostgreSQL при `DATABASE_URL`, JSON fallback локально.
- `src/postgresStore.js` - схема PostgreSQL, первичный seed и конкурентные обновления строк.
- `server.js` - HTTP API и раздача статического интерфейса.
- `public/` - рабочий dashboard без внешних CDN и npm-зависимостей.

Google Sheets используется только как ориентир по исходным полям, но не участвует в работе сервиса.

## API

- `GET /api/dashboard` - агрегированные показатели, воронки и сделки.
- `GET /api/deals` - список сделок.
- `POST /api/deals` - создать сделку.
- `PATCH /api/deals/:id` - обновить сделку.
- `POST /api/deals/:id/actions` - добавить действие в хронологию заявки.
- `GET /api/managers` - список аналитиков.
- `POST /api/managers` - создать учетную карточку аналитика.
- `DELETE /api/managers/:id` - удалить учетную карточку аналитика.
- `GET /api/banks` - база банков и условий.
- `POST /api/banks` - добавить банк или программу.
- `GET /api/knowledge` - база знаний по банкам и программам.
- `POST /api/knowledge` - добавить программу в базу знаний.
- `PATCH /api/knowledge/programs/:id` - изменить программу базы знаний.

## Интеграция Jarvis

Для машинной интеграции используется отдельный API. Админский логин и
браузерная cookie для него не нужны.

Переменные Railway:

```bash
ABRAM_MONITOR_JARVIS_API_KEY=<случайный секрет длиной не менее 32 символов>
ABRAM_MONITOR_JARVIS_SCOPES=read
```

Доступные scopes: `read`, `write_plan`, `write_status`. Без явной настройки
выдаётся только `read`. Для включения записи:

```bash
ABRAM_MONITOR_JARVIS_SCOPES=read,write_plan,write_status
```

Маршруты `v1`:

- `GET /api/integration/v1/health` — проверка ключа и scopes;
- `GET /api/integration/v1/changes?updatedSince=<ISO>` — изменения клиентов,
  заявок, программ и запросов документов; возвращаемый `cursor` передаётся в
  следующий запрос как `updatedSince`;
- `GET /api/integration/v1/quality` — аудит пригодности истории для обучения;
- `GET /api/integration/v1/deals/:id` — одна заявка;
- `POST /api/integration/v1/clients/upsert` — связать клиента по
  `clientId + ИНН + crmLeadId`;
- `POST /api/integration/v1/deals` — создать подтверждённый маршрут;
- `POST /api/integration/v1/deals/:id/link-client` — идемпотентно связать
  старую заявку с уже подтверждённым клиентом без изменения решения;
- `PATCH /api/integration/v1/deals/:id` — обновить решение/статус.

Каждая мутация требует заголовок `Idempotency-Key`. Сервисный ключ имеет доступ
только к `/api/integration/v1/*` и не открывает пользовательскую админку.

## Проверки

```bash
node --test
npm run check
```
