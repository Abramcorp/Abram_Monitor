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

function truncate(text, max = 3500) {
  const s = String(text == null ? "" : text);
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

async function sendTelegramMessage(text, { topicId, chatId } = {}) {
  if (!BOT_TOKEN) {
    return null;
  }
  if (!text) {
    return null;
  }
  // Если передан chatId — шлём туда (личный/другой чат), иначе fallback в общий.
  const targetChatId = chatId ? String(chatId) : CHAT_ID;
  if (!targetChatId) {
    return null;
  }
  const payload = {
    chat_id: targetChatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  // Топик имеет смысл только для общего супергруппового чата, не для ЛС/другого id.
  if (!chatId && topicId) {
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
      return { ok: false, status: res.status, body };
    }
    return await res.json();
  } catch (error) {
    console.warn("[telegram] sendMessage error:", error.message);
    return null;
  }
}

function notifyDocRequestCreated(req /*, { author } = {} */) {
  if (!isEnabled() || !req) return null;
  const itemsText = truncate(req.items || "");
  const itemsBlock = itemsText
    ? `\n<b>Что нужно:</b>\n${escapeHtml(itemsText)}`
    : "";
  const text = `📥 <b>Новый запрос документов</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Программа: ${escapeHtml(req.program || "—")}\n`
    + `Банк: ${escapeHtml(req.bank || "—")}\n`
    + `Аналитик: ${escapeHtml(req.manager)}`
    + itemsBlock;
  return sendTelegramMessage(text, { topicId: TOPIC_DOCUMENTS });
}

async function notifyDocRequestFulfilled(req, { actor, recipientChatId } = {}) {
  if (!BOT_TOKEN || !req) return null;
  const text = `📦 <b>Документы готовы к отправке</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + `Подготовил: ${escapeHtml(actor?.fullName || "—")}\n`
    + `Нужно подтвердить получение в приложении.`;
  // Если у аналитика привязан Telegram — шлём ему в личку.
  if (recipientChatId) {
    const res = await sendTelegramMessage(text, { chatId: recipientChatId });
    if (res && res.ok !== false) return res;
    // если не удалось (бот заблокирован, чат не открыт) — fallback в общий чат
  }
  if (!CHAT_ID) return null;
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
