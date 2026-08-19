"use strict";

// Единый вход в сервисы Абрамкорпа: пользователь логинится в Мониторе, а
// сторонние сервисы (макеты печатей, ЭДО) получают подписанный тикет и
// заводят по нему собственную короткую сессию. Сессии Монитора живут в
// памяти процесса, поэтому проверить их снаружи нельзя — отсюда тикет.

const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 60 * 1000;   // тикет живёт минуту: его сразу обменивают
// Партнёрский контур в сервисы не пускаем; сервисная роль — не человек.
const DENIED_ROLES = new Set(["partner", "service_analytics"]);

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function sign(payloadPart, secret) {
  return base64url(crypto.createHmac("sha256", String(secret)).update(payloadPart).digest());
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Реестр сервисов из переменной окружения:
 *   SSO_SERVICES="stamp=https://stamp.up.railway.app,edo=https://edo.up.railway.app"
 * Значение — базовый адрес сервиса; возвращаться тикет может только на него.
 */
function parseServices(value) {
  const services = new Map();
  for (const chunk of String(value || "").split(/[,;\n]+/)) {
    const pair = chunk.trim();
    if (!pair) continue;
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const id = pair.slice(0, index).trim().toLowerCase();
    const base = pair.slice(index + 1).trim().replace(/\/+$/, "");
    if (id && /^https?:\/\//i.test(base)) {
      services.set(id, base);
    }
  }
  return services;
}

/** Разрешён ли возврат по этому адресу: только на базовый адрес сервиса. */
function isAllowedRedirect(redirect, serviceBase) {
  if (!redirect || !serviceBase) return false;
  let target;
  let base;
  try {
    target = new URL(redirect);
    base = new URL(serviceBase);
  } catch {
    return false;
  }
  if (target.protocol !== base.protocol || target.host !== base.host) return false;
  const basePath = base.pathname.replace(/\/+$/, "");
  return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
}

function isRoleAllowed(role) {
  return Boolean(role) && !DENIED_ROLES.has(String(role));
}

/** Подписанный тикет: base64url(JSON).base64url(HMAC-SHA256). */
function createTicket(user, { audience, secret, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() }) {
  if (!user || !user.id) throw new Error("user is required");
  if (!audience) throw new Error("audience is required");
  if (!secret) throw new Error("secret is required");

  const issuedAt = now();
  const payload = {
    sub: String(user.id),
    login: String(user.login || ""),
    name: String(user.fullName || ""),
    role: String(user.role || ""),
    aud: String(audience),
    iat: Math.floor(issuedAt / 1000),
    exp: Math.floor((issuedAt + ttlMs) / 1000),
    jti: crypto.randomBytes(8).toString("base64url")
  };
  const payloadPart = base64url(JSON.stringify(payload));
  return `${payloadPart}.${sign(payloadPart, secret)}`;
}

/** Проверка тикета — используется тестами и сервисами на Node, если появятся. */
function verifyTicket(ticket, { audience, secret, now = () => Date.now() }) {
  const parts = String(ticket || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, signature] = parts;
  if (!timingSafeEqual(signature, sign(payloadPart, secret))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (audience && payload.aud !== audience) return null;
  if (!payload.exp || payload.exp * 1000 <= now()) return null;
  return payload;
}

module.exports = {
  DENIED_ROLES,
  DEFAULT_TTL_MS,
  parseServices,
  isAllowedRedirect,
  isRoleAllowed,
  createTicket,
  verifyTicket
};
