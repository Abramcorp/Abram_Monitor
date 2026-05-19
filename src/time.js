"use strict";

const MOSCOW_TIME_ZONE = "Europe/Moscow";
const MOSCOW_UTC_OFFSET = "+03:00";
const WORLD_TIME_API_URL = "https://worldtimeapi.org/api/timezone/Europe/Moscow";
const MOSCOW_TIME_CACHE_TTL_MS = 60_000;

let cachedMoscowTime = null;
let pendingMoscowTimeCheck = null;

function cleanText(value) {
  return String(value ?? "").trim();
}

function hasExplicitOffset(value) {
  return /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
}

function isLocalDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value);
}

function toIsoDate(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  const normalized = isLocalDateTime(text) && !hasExplicitOffset(text) ? `${text}${MOSCOW_UTC_OFFSET}` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseWorldTimePayload(payload) {
  const value = payload?.utc_datetime || payload?.datetime;
  return toIsoDate(value);
}

function shouldUseSharedCache(options) {
  return !("fetcher" in options) && !("fallbackDate" in options) && !("timeoutMs" in options);
}

function cachedTimeIsFresh(entry, nowMs) {
  return entry && nowMs - entry.checkedAtMs < MOSCOW_TIME_CACHE_TTL_MS;
}

function materializeCachedTime(entry, nowMs) {
  const elapsedMs = Math.max(0, nowMs - entry.checkedAtMs);
  return {
    iso: new Date(entry.baseMs + elapsedMs).toISOString(),
    source: entry.source,
    timeZone: entry.timeZone,
    checkedAt: new Date(entry.checkedAtMs).toISOString()
  };
}

function cacheMoscowTime(result, nowMs) {
  const checkedAtMs = new Date(result.checkedAt).getTime();
  cachedMoscowTime = {
    baseMs: new Date(result.iso).getTime(),
    checkedAtMs: Number.isFinite(checkedAtMs) ? checkedAtMs : nowMs,
    source: result.source,
    timeZone: result.timeZone
  };
}

function clearMoscowTimeCache() {
  cachedMoscowTime = null;
  pendingMoscowTimeCheck = null;
}

async function checkMoscowNow(options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const fallbackDate = options.fallbackDate || new Date();
  const timeoutMs = options.timeoutMs ?? 1500;

  if (typeof fetcher === "function") {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetcher(WORLD_TIME_API_URL, {
        headers: { Accept: "application/json" },
        signal: controller?.signal
      });
      if (response?.ok) {
        const iso = parseWorldTimePayload(await response.json());
        if (iso) {
          return {
            iso,
            source: "worldtimeapi",
            timeZone: MOSCOW_TIME_ZONE,
            checkedAt: new Date().toISOString()
          };
        }
      }
    } catch {
      // If the internet time check is unavailable, keep the app usable with an explicit fallback source.
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  return {
    iso: fallbackDate.toISOString(),
    source: "server-fallback",
    timeZone: MOSCOW_TIME_ZONE,
    checkedAt: fallbackDate.toISOString()
  };
}

async function getMoscowNow(options = {}) {
  if (!shouldUseSharedCache(options)) {
    return checkMoscowNow(options);
  }

  const nowMs = Date.now();
  if (cachedTimeIsFresh(cachedMoscowTime, nowMs)) {
    return materializeCachedTime(cachedMoscowTime, nowMs);
  }

  if (!pendingMoscowTimeCheck) {
    pendingMoscowTimeCheck = checkMoscowNow(options)
      .then((result) => {
        cacheMoscowTime(result, Date.now());
        return result;
      })
      .finally(() => {
        pendingMoscowTimeCheck = null;
      });
  }

  return pendingMoscowTimeCheck;
}

async function getMoscowNowIso(options = {}) {
  return (await getMoscowNow(options)).iso;
}

module.exports = {
  MOSCOW_TIME_ZONE,
  MOSCOW_UTC_OFFSET,
  MOSCOW_TIME_CACHE_TTL_MS,
  WORLD_TIME_API_URL,
  clearMoscowTimeCache,
  getMoscowNow,
  getMoscowNowIso,
  parseWorldTimePayload,
  toIsoDate
};
