// Простой in-process pub/sub поверх Node EventEmitter — для live-updates через SSE.
// Сервер шлёт emit("change", { topic }) в момент любой мутации (deal/client/doc-request/etc),
// SSE-эндпоинт /api/stream регистрирует listener и пушит событие подписанным клиентам.
const { EventEmitter } = require("events");

const bus = new EventEmitter();
bus.setMaxListeners(0); // снимаем ограничение — слушателей столько же, сколько открытых вкладок

// Допустимые темы — фронт мапит их на цели loadData.
const TOPICS = new Set([
  "dashboard",       // суммарная карта: дёргается на любое изменение заявок/клиентов
  "clients",
  "deals",
  "managers",
  "tasks",
  "documentRequests",
  "knowledge",
  "programTypes",
  "programCategories",
  "users",
  "integrations"
]);

function emit(topic, payload = null) {
  if (!TOPICS.has(topic)) {
    console.warn(`[eventBus] unknown topic: ${topic}`);
    return;
  }
  bus.emit("change", { topic, payload, ts: Date.now() });
}

function on(handler) {
  bus.on("change", handler);
  return () => bus.off("change", handler);
}

module.exports = { emit, on, TOPICS };
