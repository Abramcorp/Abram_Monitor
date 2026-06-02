"use strict";

// Лёгкий клиент к Telegram Bot API.
// Шлёт в один общий чат/группу (TELEGRAM_CHAT_ID).
// Если в группе включены Topics — можно задать TELEGRAM_TOPIC_DOCUMENTS,
// и уведомления по запросам документов пойдут в соответствующий топик.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const TOPIC_DOCUMENTS = process.env.TELEGRAM_TOPIC_DOCUMENTS || "";

function isEnabled() {
  return Boolean(BOT_TOKEN && CHAT_ID);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pluralizeItems(count) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "позиций";
  if (n1 > 1 && n1 < 5) return "позиции";
  if (n1 === 1) return "позиция";
  return "позиций";
}

async function sendTelegramMessage(text, { topicId } = {}) {
  if (!isEnabled()) {
    return null;
  }
  if (!text) {
    return null;
  }
  const payload = {
    chat_id: CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (topicId) {
    const n = Number(topicId);
    if (Number.isFinite(n) && n > 0) {
      payload.message_thread_id = n;
    }
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[telegram] sendMessage failed:", res.status, body);
      return null;
    }
    return await res.json();
  } catch (error) {
    console.warn("[telegram] sendMessage error:", error.message);
    return null;
  }
}

function notifyDocRequestCreated(req, { author } = {}) {
  if (!isEnabled() || !req) return null;
  const itemsCount = Array.isArray(req.items) ? req.items.length : 0;
  const itemsLine = itemsCount ? ` · ${itemsCount} ${pluralizeItems(itemsCount)}` : "";
  const text = `📥 <b>Новый запрос документов</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Программа: ${escapeHtml(req.program || "—")}\n`
    + `Банк: ${escapeHtml(req.bank || "—")}\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + `Запросил: ${escapeHtml(author?.fullName || "—")}${itemsLine}`;
  return sendTelegramMessage(text, { topicId: TOPIC_DOCUMENTS });
}

function notifyDocRequestFulfilled(req, { actor } = {}) {
  if (!isEnabled() || !req) return null;
  const text = `📦 <b>Документы готовы к отправке</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + `Подготовил: ${escapeHtml(actor?.fullName || "—")}\n`
    + `Аналитику нужно подтвердить получение в приложении.`;
  return sendTelegramMessage(text, { topicId: TOPIC_DOCUMENTS });
}

function notifyDocRequestConfirmed(req, { actor } = {}) {
  if (!isEnabled() || !req) return null;
  const text = `✅ <b>Документы получены</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + `Подтвердил: ${escapeHtml(actor?.fullName || "—")}`;
  return sendTelegramMessage(text, { topicId: TOPIC_DOCUMENTS });
}

module.exports = {
  isEnabled,
  sendTelegramMessage,
  notifyDocRequestCreated,
  notifyDocRequestFulfilled,
  notifyDocRequestConfirmed
};
