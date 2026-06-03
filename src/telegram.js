"use strict";

// Лёгкий клиент к Telegram Bot API.
// Шлёт в один общий чат/группу (TELEGRAM_CHAT_ID).
// Если в группе включены Topics — можно задать TELEGRAM_TOPIC_DOCUMENTS,
// и уведомления по запросам документов пойдут в соответствующий топик.
//
// Для отправки файлов используем нативные FormData + Blob из Node 20+
// (web standard) — они корректно работают с native fetch, в отличие от
// устаревшей пакетной form-data, которая в Node 20+ отдаёт неправильный
// Content-Length и Telegram отвечает 400 с пустым body.

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

// Создаёт топик в форум-группе. Возвращает { ok, message_thread_id } или null.
// Группа должна быть супергруппой с включённым forum mode, и бот должен иметь
// право Manage Topics (по умолчанию у админов есть).
async function createForumTopic(name) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("[telegram] createForumTopic: BOT_TOKEN/CHAT_ID not set");
    return null;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createForumTopic`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        name: String(name || "").slice(0, 128) || "Клиент"
      }),
      signal: AbortSignal.timeout(10000)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      console.warn(`[telegram] createForumTopic failed: status=${res.status} body=${JSON.stringify(json)}`);
      return null;
    }
    const threadId = json.result?.message_thread_id;
    console.log(`[telegram] createForumTopic ok: name="${name}" thread_id=${threadId}`);
    return { ok: true, message_thread_id: threadId };
  } catch (error) {
    console.warn(`[telegram] createForumTopic error: ${error.message}`);
    return null;
  }
}

function notifyDocRequestCreated(req, { topicId } = {}) {
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
  return sendTelegramMessage(text, { topicId: topicId || TOPIC_DOCUMENTS });
}

// Отправка файла-документа. fileSource: { fileName, mimeType, stream } или { fileName, mimeType, buffer }
async function sendDocument({ chatId, topicId, fileSource, caption } = {}) {
  if (!BOT_TOKEN) { console.warn("[telegram] sendDocument: BOT_TOKEN not set"); return null; }
  if (!fileSource) { console.warn("[telegram] sendDocument: no fileSource"); return null; }
  const targetChatId = chatId ? String(chatId) : CHAT_ID;
  if (!targetChatId) return null;

  // Native FormData + Blob (Node 20+ web standard, совместим с native fetch).
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
  const fileName = fileSource.fileName || "document";
  const mimeType = fileSource.mimeType || "application/octet-stream";
  // Buffer → Blob (web Blob, не require'им — глобальный в Node 18+)
  let blob;
  if (fileSource.buffer) {
    blob = new Blob([fileSource.buffer], { type: mimeType });
  } else if (fileSource.stream) {
    // На всякий случай — собрать stream в Buffer, потом обернуть в Blob
    const chunks = [];
    for await (const chunk of fileSource.stream) chunks.push(chunk);
    blob = new Blob([Buffer.concat(chunks)], { type: mimeType });
  } else {
    console.warn("[telegram] sendDocument: fileSource has no buffer/stream");
    return null;
  }
  form.append("document", blob, fileName);

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
      method: "POST",
      body: form, // fetch сам выставит multipart Content-Type с boundary
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[telegram] sendDocument failed: status=${res.status} chat=${targetChatId} file=${fileName} body=${body}`);
      return { ok: false, status: res.status, body };
    }
    const json = await res.json();
    console.log(`[telegram] sendDocument ok: chat=${targetChatId} file=${fileName} message_id=${json?.result?.message_id}`);
    return json;
  } catch (error) {
    console.warn(`[telegram] sendDocument error: chat=${targetChatId} file=${fileName} err=${error.message}`);
    return null;
  }
}

async function notifyDocRequestFulfilled(req, { actor, recipientChatId, attachmentSources = [], topicId } = {}) {
  if (!BOT_TOKEN || !req) return null;
  const text = `📦 <b>Документы готовы к отправке</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Банк: <b>${escapeHtml(req.bank || "—")}</b>\n`
    + `Программа: ${escapeHtml(req.program || "—")}\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + `Подготовил: ${escapeHtml(actor?.fullName || "—")}\n`
    + (attachmentSources.length ? `Файлов в пакете: <b>${attachmentSources.length}</b>\n` : "")
    + `Нужно подтвердить получение в приложении.`;
  const targetChatId = recipientChatId || "";
  const groupTopicId = topicId || TOPIC_DOCUMENTS;
  // Если файлов нет — просто текст (старое поведение).
  if (!attachmentSources.length) {
    if (targetChatId) {
      const res = await sendTelegramMessage(text, { chatId: targetChatId });
      if (res && res.ok !== false) return res;
    }
    if (!CHAT_ID) return null;
    return sendTelegramMessage(text, { topicId: groupTopicId });
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
      // Если личка не сработала на ПЕРВОМ файле — переключаемся на групповой чат для всех
      if ((!res || res.ok === false) && !firstSent && fallbackChatId) {
        res = await sendDocument({ chatId: fallbackChatId, topicId: groupTopicId, fileSource: src, caption });
      }
    } else if (fallbackChatId) {
      res = await sendDocument({ chatId: fallbackChatId, topicId: groupTopicId, fileSource: src, caption });
    }
    results.push(res);
    firstSent = true;
    if (res && res.ok !== false) anySuccess = true;
  }
  return { ok: anySuccess, results };
}

function notifyDocRequestConfirmed(req, { actor, topicId } = {}) {
  if (!isEnabled() || !req) return null;
  const text = `✅ <b>Документы получены</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Банк: <b>${escapeHtml(req.bank || "—")}</b>\n`
    + `Программа: ${escapeHtml(req.program || "—")}\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + `Подтвердил: ${escapeHtml(actor?.fullName || "—")}`;
  return sendTelegramMessage(text, { topicId: topicId || TOPIC_DOCUMENTS });
}

module.exports = {
  isEnabled,
  sendTelegramMessage,
  sendDocument,
  createForumTopic,
  notifyDocRequestCreated,
  notifyDocRequestFulfilled,
  notifyDocRequestConfirmed
};
