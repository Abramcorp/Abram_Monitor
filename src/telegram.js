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
// Биг Босс — личный чат, куда уходит суммарный отчёт по клиенту, когда
// все его активные заявки проверены за день. Без топиков.
const BOSS_CHAT_ID = process.env.TELEGRAM_BOSS_CHAT_ID || "";

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

// «5 дней», «1 день», «22 дня», «сегодня»
function formatDaysRu(n) {
  if (n == null || !Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "сегодня";
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} дней`;
  if (mod10 === 1) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} дня`;
  return `${n} дней`;
}

function processingLine(processingDays) {
  if (processingDays == null) return "";
  const label = formatDaysRu(processingDays);
  if (!label) return "";
  return `⏳ В обработке: <b>${label}</b>\n`;
}

// Форматируем сумму в рублях: «1 250 000 ₽». Пустую/нулевую/невалидную
// возвращаем пустой строкой — вызывающий просто не покажет строку.
const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0
});
function formatMoneyRu(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return moneyFormatter.format(n);
}

// Строки про сумму. Если есть только запрошенная — одна строка;
// если есть и одобренная — две. Если ничего — пустая строка.
function amountLines({ amountRequested, amountApproved } = {}) {
  const req = formatMoneyRu(amountRequested);
  const app = formatMoneyRu(amountApproved);
  if (!req && !app) return "";
  let out = "";
  if (req) out += `Сумма заявки: <b>${req}</b>\n`;
  if (app) out += `Одобрено: <b>${app}</b>\n`;
  return out;
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

// Удаление одного сообщения в группе/топике. Тихо возвращает true/false.
// Бот может удалить только свои сообщения, либо чужие если он админ группы.
async function deleteMessage({ chatId, messageId } = {}) {
  if (!BOT_TOKEN || !messageId) return false;
  const targetChatId = chatId ? String(chatId) : CHAT_ID;
  if (!targetChatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: targetChatId, message_id: Number(messageId) }),
      signal: AbortSignal.timeout(10000)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      console.warn(`[telegram] deleteMessage failed: status=${res.status} body=${JSON.stringify(json)}`);
      return false;
    }
    console.log(`[telegram] deleteMessage ok: chat=${targetChatId} message_id=${messageId}`);
    return true;
  } catch (error) {
    console.warn(`[telegram] deleteMessage error: ${error.message}`);
    return false;
  }
}

// Удаление топика в форум-группе. Возвращает true / false (тихо, без throw).
// Требует у бота право Manage Topics.
// Мягкое «архивирование» топика — закрытие. Сообщения остаются,
// но писать в него больше нельзя. Используется при архивации клиента.
async function closeForumTopic(threadId) {
  const n = Number(threadId);
  if (!BOT_TOKEN || !CHAT_ID) return false;
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/closeForumTopic`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, message_thread_id: n }),
      signal: AbortSignal.timeout(10000)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      console.warn(`[telegram] closeForumTopic failed: status=${res.status} body=${JSON.stringify(json)}`);
      return false;
    }
    console.log(`[telegram] closeForumTopic ok: thread_id=${n}`);
    return true;
  } catch (error) {
    console.warn(`[telegram] closeForumTopic error: ${error.message}`);
    return false;
  }
}

async function deleteForumTopic(threadId) {
  if (!BOT_TOKEN || !CHAT_ID || !threadId) return false;
  const n = Number(threadId);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteForumTopic`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, message_thread_id: n }),
      signal: AbortSignal.timeout(10000)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      console.warn(`[telegram] deleteForumTopic failed: status=${res.status} body=${JSON.stringify(json)}`);
      return false;
    }
    console.log(`[telegram] deleteForumTopic ok: thread_id=${n}`);
    return true;
  } catch (error) {
    console.warn(`[telegram] deleteForumTopic error: ${error.message}`);
    return false;
  }
}

function notifyDocRequestCreated(req, { topicId, processingDays, amountRequested, amountApproved } = {}) {
  if (!isEnabled() || !req) return null;
  const itemsText = truncate(req.items || "");
  const itemsBlock = itemsText
    ? `\n<b>Что нужно:</b>\n${escapeHtml(itemsText)}`
    : "";
  const isResend = typeof processingDays === "number";
  const headEmoji = isResend ? "🔁" : "📥";
  const headText = isResend ? "Напоминание · запрос документов" : "Новый запрос документов";
  const periodLine = req.period ? `Период: <b>${escapeHtml(req.period)}</b>\n` : "";
  const text = `${headEmoji} <b>${headText}</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Программа: ${escapeHtml(req.program || "—")}\n`
    + `Банк: ${escapeHtml(req.bank || "—")}\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + amountLines({ amountRequested, amountApproved })
    + periodLine
    + processingLine(processingDays)
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

async function notifyDocRequestFulfilled(req, { actor, recipientChatId, attachmentSources = [], topicId, processingDays, amountRequested, amountApproved } = {}) {
  if (!BOT_TOKEN || !req) return null;
  const isResend = typeof processingDays === "number";
  const headEmoji = isResend ? "🔁" : "📦";
  const headText = isResend ? "Напоминание · документы ждут вашего подтверждения" : "Документы готовы к отправке";
  const periodLineF = req.period ? `Период: <b>${escapeHtml(req.period)}</b>\n` : "";
  const text = `${headEmoji} <b>${headText}</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Банк: <b>${escapeHtml(req.bank || "—")}</b>\n`
    + `Программа: ${escapeHtml(req.program || "—")}\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + amountLines({ amountRequested, amountApproved })
    + periodLineF
    + (actor?.fullName ? `Подготовил: ${escapeHtml(actor.fullName)}\n` : "")
    + processingLine(processingDays)
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

// Индикатор частичной подгрузки: текст в топик клиента «📎 Добавлено N файлов,
// всего: M». Не дублирует уведомления аналитику — только в топик.
function notifyDocRequestPartialUpload(req, { topicId, uploadedNames = [], totalCount = 0, actor, amountRequested, amountApproved } = {}) {
  if (!isEnabled() || !req) return null;
  const added = uploadedNames.length;
  if (added === 0) return null;
  const visibleNames = uploadedNames.slice(0, 5);
  const moreLine = uploadedNames.length > 5 ? `… и ещё ${uploadedNames.length - 5}` : "";
  const filesBlock = visibleNames.map((n) => `— ${escapeHtml(n)}`).join("\n");
  const byTail = actor?.fullName ? ` (${escapeHtml(actor.fullName)})` : "";
  const text = `📎 <b>К запросу добавлено: ${added}</b>${byTail}\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Банк: ${escapeHtml(req.bank || "—")}\n`
    + amountLines({ amountRequested, amountApproved })
    + `Всего файлов в пакете: <b>${totalCount}</b>\n`
    + `\n${filesBlock}${moreLine ? `\n${moreLine}` : ""}`;
  return sendTelegramMessage(text, { topicId: topicId || TOPIC_DOCUMENTS });
}

function notifyDocRequestConfirmed(req, { actor, topicId, amountRequested, amountApproved } = {}) {
  if (!isEnabled() || !req) return null;
  const periodLineC = req.period ? `Период: <b>${escapeHtml(req.period)}</b>\n` : "";
  const text = `✅ <b>Документы получены</b>\n`
    + `Клиент: <b>${escapeHtml(req.clientName)}</b>\n`
    + `Банк: <b>${escapeHtml(req.bank || "—")}</b>\n`
    + `Программа: ${escapeHtml(req.program || "—")}\n`
    + `Аналитик: ${escapeHtml(req.manager)}\n`
    + amountLines({ amountRequested, amountApproved })
    + periodLineC
    + `Подтвердил: ${escapeHtml(actor?.fullName || "—")}`;
  return sendTelegramMessage(text, { topicId: topicId || TOPIC_DOCUMENTS });
}

// Уведомление о ключевой смене статуса заявки (submitted/approved/rejected).
// Отправляется конкретному получателю в личку — chatId должен быть передан.
function notifyDealStageChange(deal, { prevStageLabel, newStageLabel, chatId } = {}) {
  if (!BOT_TOKEN || !deal || !chatId) return null;
  const emoji = /одобр/i.test(newStageLabel || "") ? "🟢"
    : /отказ|отклон|нет возможн/i.test(newStageLabel || "") ? "🔴"
    : /подпис|реш/i.test(newStageLabel || "") ? "🟡"
    : "🔔";
  const text = `${emoji} <b>Смена статуса</b>\n`
    + `Клиент: <b>${escapeHtml(deal.client || "—")}</b>\n`
    + `Банк: <b>${escapeHtml(deal.bank || "—")}</b>\n`
    + `Программа: ${escapeHtml(deal.program || "—")}\n`
    + amountLines({ amountRequested: deal.amountRequested, amountApproved: deal.amountApproved })
    + `${escapeHtml(prevStageLabel || "—")} → <b>${escapeHtml(newStageLabel || "—")}</b>\n`
    + `Аналитик: ${escapeHtml(deal.manager || "—")}`;
  return sendTelegramMessage(text, { chatId });
}

// Утреннее уведомление аналитику в личку: «Проверьте заявки клиентов».
// clientsList: [{ clientName, count }, ...].
function notifyAnalystDailyCheck({ chatId, analystName, clientsList = [] }) {
  if (!BOT_TOKEN || !chatId) return null;
  if (!clientsList.length) return null;
  const lines = clientsList.map((c) => `— <b>${escapeHtml(c.clientName)}</b>: ${c.count} ${pluralRu(c.count, "заявка", "заявки", "заявок")}`).join("\n");
  const total = clientsList.reduce((sum, c) => sum + Number(c.count || 0), 0);
  const text = `🔔 <b>Проверьте заявки клиентов</b>\n`
    + (analystName ? `Аналитик: <b>${escapeHtml(analystName)}</b>\n` : "")
    + `Активных непроверенных: <b>${total}</b> у ${clientsList.length} ${pluralRu(clientsList.length, "клиента", "клиентов", "клиентов")}\n\n`
    + lines
    + `\n\nОткройте приложение — на карточке каждой заявки появится кнопка «Заявка проверена».`;
  return sendTelegramMessage(text, { chatId });
}

function pluralRu(n, one, few, many) {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

// Общий текст-формат для суммарного отчёта по клиенту — используется и в
// личке Биг Боссу, и в топике клиента в общей группе. Поля по заявке:
// статус, дней в статусе, банк/программа/сумма, последнее действие.
function buildClientStatusReportText({ clientName, manager, deals = [], trigger = "checked" }) {
  const headEmoji = trigger === "refresh" ? "🔄" : "✅";
  const headText = trigger === "refresh" ? "Обновление статусов" : "Все заявки клиента проверены";
  const dealsBlock = deals.map((d) => {
    const stageLine = `<b>${escapeHtml(d.stageLabel || "—")}</b>`
      + (d.daysInStage != null ? ` · ${formatDaysRu(d.daysInStage)} в статусе` : "");
    const lastLine = d.lastActionText
      ? `\n  ↳ ${escapeHtml(d.lastActionText)}${d.lastActionDate ? ` (${escapeHtml(d.lastActionDate)})` : ""}`
      : "";
    const amount = formatMoneyRu(d.amountRequested);
    const moneyLine = amount ? `${amount}` : "";
    return `• ${stageLine}\n  ${escapeHtml(d.bank || "—")} · ${escapeHtml(d.program || "—")}${moneyLine ? ` · ${moneyLine}` : ""}${lastLine}`;
  }).join("\n\n");
  return `${headEmoji} <b>${headText}</b>\n`
    + `Клиент: <b>${escapeHtml(clientName)}</b>\n`
    + `Аналитик: ${escapeHtml(manager || "—")}\n`
    + `Активных заявок: <b>${deals.length}</b>\n\n`
    + dealsBlock;
}

// Суммарный отчёт Биг Боссу в личку — когда аналитик проверил все
// активные заявки клиента за день (или при ручном refresh от админа).
function notifyBossClientReport(report) {
  if (!BOT_TOKEN || !BOSS_CHAT_ID || !report?.deals?.length) return null;
  return sendTelegramMessage(buildClientStatusReportText(report), { chatId: BOSS_CHAT_ID });
}

// Тот же отчёт, но в топик клиента в общей форум-группе — чтобы команда
// тоже видела сводку, не только Биг Босс. topicId обязателен.
function notifyClientStatusReportToTopic(report, { topicId } = {}) {
  if (!isEnabled() || !report?.deals?.length || !topicId) return null;
  return sendTelegramMessage(buildClientStatusReportText(report), { topicId });
}

function isBossConfigured() {
  return Boolean(BOT_TOKEN && BOSS_CHAT_ID);
}

module.exports = {
  isEnabled,
  isBossConfigured,
  sendTelegramMessage,
  sendDocument,
  createForumTopic,
  closeForumTopic,
  deleteForumTopic,
  deleteMessage,
  notifyDocRequestCreated,
  notifyDocRequestPartialUpload,
  notifyDocRequestFulfilled,
  notifyDocRequestConfirmed,
  notifyDealStageChange,
  notifyAnalystDailyCheck,
  notifyBossClientReport,
  notifyClientStatusReportToTopic,
  escapeHtml
};
