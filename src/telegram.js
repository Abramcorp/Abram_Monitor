"use strict";

// Лёгкий клиент к Telegram Bot API.
// Шлёт в один общий чат/группу (TELEGRAM_CHAT_ID).
// Если в группе включены Topics — можно задать TELEGRAM_TOPIC_DOCUMENTS,
// и уведомления по запросам документов пойдут в соответствующий топик.

const FormData = require("form-data");

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

// Отправка файла-документа. fileSource: { fileName, mimeType, stream } или { fileName, mimeType, buffer }
async function sendDocument({ chatId, topicId, fileSource, caption } = {}) {
  if (!BOT_TOKEN) { console.warn("[telegram] sendDocument: BOT_TOKEN not set"); return null; }
  if (!fileSource) { console.warn("[telegram] sendDocument: no fileSource"); return null; }
  const targetChatId = chatId ? String(chatId) : CHAT_ID;
  if (!targetChatId) return null;
  const form = new FormData();
  form.append("chat_id", targetChatId);
  if (!chatId && topicId) {
    const n = Number(topicId);
    if (Number.isFinite(n) && n > 0) {
      form.append("message_thread_id", String(n));
    }
  }
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  const docOptions = {
    filename: fileSource.fileName || "document",
    contentType: fileSource.mimeType || "application/octet-stream"
  };
  if (fileSource.stream) {
    form.append("document", fileSource.stream, docOptions);
  } else if (fileSource.buffer) {
    form.append("document", fileSource.buffer, docOptions);
  } else {
    return null;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
      method: "POST",
      headers: form.getHeaders(),
      body: form,
      // длинный таймаут на большие файлы (50 МБ может загружаться 30+ сек)
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[telegram] sendDocument failed: status=${res.status} chat=${targetChatId} file=${fileSource.fileName} body=${body}`);
      return { ok: false, status: res.status, body };
    }
    const json = await res.json();
    console.log(`[telegram] sendDocument ok: chat=${targetChatId} file=${fileSource.fileName} message_id=${json?.result?.message_id}`);
    return json;
  } catch (error) {
    console.warn(`[telegram] sendDocument error: chat=${targetChatId} file=${fileSource.fileName} err=${error.message}`);
    return null;
  }
}

async function notifyDocRequestFulfilled(req, { actor, recipientChatId, attachmentSources = [] } = {}) {
  if (!BOT_TOKEN || !req) return null;
  const text = `📦 <b>Документы готовы к отправке</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + `Подготовил: ${escapeHtml(actor?.fullName || "—")}\n`
    + (attachmentSources.length ? `Файлов в пакете: <b>${attachmentSources.length}</b>\n` : "")
    + `Нужно подтвердить получение в приложении.`;
  const targetChatId = recipientChatId || "";
  // Если файлов нет — просто текст (старое поведение).
  if (!attachmentSources.length) {
    if (targetChatId) {
      const res = await sendTelegramMessage(text, { chatId: targetChatId });
      if (res && res.ok !== false) return res;
    }
    if (!CHAT_ID) return null;
    return sendTelegramMessage(text, { topicId: TOPIC_DOCUMENTS });
  }
  // Есть файлы: шлём поштучно, caption ставим только на первый.
  const usePersonal = Boolean(targetChatId);
  const fallbackChatId = CHAT_ID;
  let firstSent = false;
  let anySuccess = false;
  const results = [];
  for (const src of attachmentSources) {
    const caption = firstSent ? "" : text;
    let res = null;
    if (usePersonal) {
      res = await sendDocument({ chatId: targetChatId, fileSource: src, caption });
      // Если личка не сработала на ПЕРВОМ файле — переключаемся на общий чат для всех
      if ((!res || res.ok === false) && !firstSent && fallbackChatId) {
        res = await sendDocument({ chatId: fallbackChatId, topicId: TOPIC_DOCUMENTS, fileSource: src, caption });
      }
    } else if (fallbackChatId) {
      res = await sendDocument({ chatId: fallbackChatId, topicId: TOPIC_DOCUMENTS, fileSource: src, caption });
    }
    results.push(res);
    firstSent = true;
    if (res && res.ok !== false) anySuccess = true;
  }
  return { ok: anySuccess, results };
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
  sendDocument,
  notifyDocRequestCreated,
  notifyDocRequestFulfilled,
  notifyDocRequestConfirmed
};
