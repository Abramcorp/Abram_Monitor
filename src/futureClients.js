"use strict";

const MOSCOW_TIME_ZONE = "Europe/Moscow";
const RUSSIAN_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"
];
const TERMINAL_STATUSES = new Set(["moved", "cancelled"]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeParameters(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => {
        const cleanKey = cleanText(key);
        if (!cleanKey) return null;
        if (typeof value === "boolean") return [cleanKey, value];
        if (typeof value === "number" && Number.isFinite(value)) return [cleanKey, value];
        return [cleanKey, cleanText(value)];
      })
      .filter(Boolean)
  );
}

function toIsoDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toDateKey(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function moscowDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Некорректная дата");
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: MOSCOW_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getFutureClientPeriodBounds(yearValue, monthValue, thirdValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const third = Number(thirdValue);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new Error("Год периода должен быть от 2000 до 2200");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Месяц периода должен быть от 1 до 12");
  }
  if (![1, 2, 3].includes(third)) {
    throw new Error("Треть месяца должна быть 1, 2 или 3");
  }
  const startDay = third === 1 ? 1 : third === 2 ? 11 : 21;
  const endDay = third === 1 ? 10 : third === 2 ? 20 : daysInMonth(year, month);
  return {
    startDate: toDateKey(year, month, startDay),
    endDate: toDateKey(year, month, endDay)
  };
}

function dateKeyToUtcMs(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function addCalendarDays(dateKey, days) {
  const date = new Date(dateKeyToUtcMs(dateKey) + Number(days || 0) * 86_400_000);
  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function periodLabel(year, month, third) {
  const { startDate, endDate } = getFutureClientPeriodBounds(year, month, third);
  const startDay = Number(startDate.slice(-2));
  const endDay = Number(endDate.slice(-2));
  return `${startDay}–${endDay} ${RUSSIAN_MONTHS[month - 1]} ${year}`;
}

function getFutureClientWindow(now = new Date(), count = 6, offset = 0) {
  const current = moscowDateParts(now);
  const currentThird = current.day <= 10 ? 1 : current.day <= 20 ? 2 : 3;
  const startIndex = current.year * 36 + (current.month - 1) * 3 + (currentThird - 1) + Number(offset || 0);
  return Array.from({ length: Math.max(0, Number(count) || 0) }, (_, position) => {
    const index = startIndex + position;
    const year = Math.floor(index / 36);
    const withinYear = index - year * 36;
    const month = Math.floor(withinYear / 3) + 1;
    const third = (withinYear % 3) + 1;
    const bounds = getFutureClientPeriodBounds(year, month, third);
    return {
      key: `${year}-${String(month).padStart(2, "0")}-${third}`,
      year,
      month,
      third,
      label: periodLabel(year, month, third),
      ...bounds
    };
  });
}

function normalizeFutureClient(raw = {}) {
  const now = new Date().toISOString();
  const createdAt = toIsoDate(raw.createdAt) || now;
  return {
    id: cleanText(raw.id) || `future-client-${Date.now()}`,
    name: cleanText(raw.name || raw.client),
    manager: cleanText(raw.manager),
    inn: cleanText(raw.inn).replace(/\D/g, ""),
    parameters: normalizeParameters(raw.parameters),
    crmUrl: cleanText(raw.crmUrl || raw.crmLink),
    driveUrl: cleanText(raw.driveUrl || raw.diskUrl || raw.driveLink),
    instructionUrl: cleanText(raw.instructionUrl || raw.instructionLink),
    comment: cleanText(raw.comment),
    periodYear: Number(raw.periodYear || raw.year) || 0,
    periodMonth: Number(raw.periodMonth || raw.month) || 0,
    periodThird: Number(raw.periodThird || raw.third) || 0,
    movedClientId: cleanText(raw.movedClientId),
    movedAt: toIsoDate(raw.movedAt),
    cancelledAt: toIsoDate(raw.cancelledAt),
    preReminderSentAt: toIsoDate(raw.preReminderSentAt),
    lastReminderDate: /^\d{4}-\d{2}-\d{2}$/.test(cleanText(raw.lastReminderDate))
      ? cleanText(raw.lastReminderDate)
      : "",
    createdAt,
    updatedAt: toIsoDate(raw.updatedAt) || createdAt
  };
}

function isHttpUrl(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateFutureClient(item) {
  if (!item.name) throw new Error("Наименование клиента обязательно");
  if (item.name.length > 240) throw new Error("Наименование клиента слишком длинное");
  if (!item.manager) throw new Error("Аналитик обязателен");
  if (item.inn && !/^\d{10}(?:\d{2})?$/.test(item.inn)) {
    throw new Error("ИНН должен содержать 10 или 12 цифр");
  }
  getFutureClientPeriodBounds(item.periodYear, item.periodMonth, item.periodThird);
  for (const [label, value] of [
    ["Ссылка на CRM", item.crmUrl],
    ["Ссылка на диск", item.driveUrl],
    ["Ссылка на инструкцию", item.instructionUrl]
  ]) {
    if (!isHttpUrl(value)) throw new Error(`${label} должна начинаться с http:// или https://`);
  }
  if (item.comment.length > 5000) throw new Error("Комментарий слишком длинный");
  return item;
}

function deriveFutureClientStatus(raw, now = new Date()) {
  const item = normalizeFutureClient(raw);
  if (item.movedAt || item.movedClientId) return "moved";
  if (item.cancelledAt) return "cancelled";
  const today = moscowDateParts(now).dateKey;
  const { startDate, endDate } = getFutureClientPeriodBounds(item.periodYear, item.periodMonth, item.periodThird);
  if (today > endDate) return "overdue";
  if (today >= startDate) return "current";
  return today >= addCalendarDays(startDate, -7) ? "soon" : "scheduled";
}

function futureClientReminderKind(raw, now = new Date()) {
  const item = normalizeFutureClient(raw);
  const status = deriveFutureClientStatus(item, now);
  if (TERMINAL_STATUSES.has(status) || status === "scheduled") return "";
  if (status === "soon") return item.preReminderSentAt ? "" : "soon";
  const today = moscowDateParts(now).dateKey;
  return item.lastReminderDate === today ? "" : status;
}

function withDerivedFutureClientStatus(item, now = new Date()) {
  return {
    ...normalizeFutureClient(item),
    status: deriveFutureClientStatus(item, now)
  };
}

module.exports = {
  MOSCOW_TIME_ZONE,
  addCalendarDays,
  deriveFutureClientStatus,
  futureClientReminderKind,
  getFutureClientPeriodBounds,
  getFutureClientWindow,
  moscowDateParts,
  normalizeFutureClient,
  periodLabel,
  validateFutureClient,
  withDerivedFutureClientStatus
};
