# Deal Monitor

Standalone-сервис для мониторинга состояния сделок: текущие воронки, завершенные сделки, аналитика и сводный отчет.

## Запуск

```bash
npm start
```

По умолчанию сервис доступен на `http://localhost:3000`.

## Railway + PostgreSQL

Для многопользовательского режима сервис использует PostgreSQL, если задана переменная окружения `DATABASE_URL`.

На Railway:

1. Создать сервис из репозитория.
2. Добавить Railway PostgreSQL plugin к проекту.
3. Убедиться, что у web-сервиса есть переменная `DATABASE_URL`.
4. Deploy запустит `npm start`; при первом старте сервис сам создаст таблицы и перенесет начальные данные из `data/*.json`.

Локально без `DATABASE_URL` приложение продолжает работать через JSON-файлы. Это удобно для быстрой разработки и тестов.

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

## Проверки

```bash
node --test
npm run check
```
