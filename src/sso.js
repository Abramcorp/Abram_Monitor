"use strict";

// Единый вход в сервисы Абрамкорпа: пользователь логинится в Мониторе, а
// сторонние сервисы (макеты печатей, ЭДО) получают подписанный тикет и
// заводят по нему собственную короткую сессию. Сессии Монитора живут в
// памяти процесса, поэтому проверить их снаружи нельзя — отсюда тикет.

const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 60 * 1000;   // тикет живёт минуту: его сразу обменивают
// Adjacent services use their own compact role vocabulary. Missing overrides
// inherit a role derived from the user's Monitor role.
const SERVICE_ROLES = ["partner", "manager", "admin"];
const SERVICE_ROLE_SET = new Set(SERVICE_ROLES);
const SERVICE_ACCESS_LEVELS = ["none", ...SERVICE_ROLES];
const SERVICE_ACCESS_LEVEL_SET = new Set(SERVICE_ACCESS_LEVELS);
const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DEFAULT_SERVICE_ROLE_BY_MONITOR_ROLE = Object.freeze({
  admin: "admin",
  analyst_abram: "manager",
  partner: "partner",
  documents_officer: "manager"
});

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

function normalizeServiceRoles(raw, { allowedServiceIds, rejectInvalid = false } = {}) {
  if (raw === undefined || raw === null || raw === "") {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    if (rejectInvalid) throw new Error("serviceRoles must be an object");
    return {};
  }

  const allowed = allowedServiceIds === undefined
    ? null
    : new Set([...allowedServiceIds].map((id) => String(id || "").trim().toLowerCase()));
  const normalized = {};
  for (const [rawId, rawLevel] of Object.entries(raw)) {
    const serviceId = String(rawId || "").trim().toLowerCase();
    const level = String(rawLevel || "").trim().toLowerCase();
    if (!SERVICE_ID_PATTERN.test(serviceId) || (allowed && !allowed.has(serviceId))) {
      if (rejectInvalid) throw new Error(`Unknown service: ${rawId}`);
      continue;
    }
    if (!level || level === "inherit") {
      continue;
    }
    if (!SERVICE_ACCESS_LEVEL_SET.has(level)) {
      if (rejectInvalid) throw new Error(`Unsupported service access level: ${rawLevel}`);
      continue;
    }
    normalized[serviceId] = level;
  }
  return normalized;
}

function resolveServiceRole(user, serviceId) {
  const normalizedServiceId = String(serviceId || "").trim().toLowerCase();
  if (!SERVICE_ID_PATTERN.test(normalizedServiceId)) {
    return "";
  }
  const inheritedRole = DEFAULT_SERVICE_ROLE_BY_MONITOR_ROLE[String(user?.role || "")] || "";
  if (!inheritedRole) {
    return "";
  }
  const override = normalizeServiceRoles(user?.serviceRoles)[normalizedServiceId];
  if (override === "none") {
    return "";
  }
  if (SERVICE_ROLE_SET.has(override)) {
    return override;
  }
  return inheritedRole;
}

function isRoleAllowed(role) {
  return Boolean(DEFAULT_SERVICE_ROLE_BY_MONITOR_ROLE[String(role || "")]);
}

/** Подписанный тикет: base64url(JSON).base64url(HMAC-SHA256). */
function createTicket(user, { audience, secret, role, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() }) {
  if (!user || !user.id) throw new Error("user is required");
  if (!audience) throw new Error("audience is required");
  if (!secret) throw new Error("secret is required");
  const ticketRole = String(role || resolveServiceRole(user, audience));
  if (!SERVICE_ROLE_SET.has(ticketRole)) {
    throw new Error("valid service role is required");
  }

  const issuedAt = now();
  const payload = {
    sub: String(user.id),
    login: String(user.login || ""),
    name: String(user.fullName || ""),
    role: ticketRole,
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
  DEFAULT_TTL_MS,
  DEFAULT_SERVICE_ROLE_BY_MONITOR_ROLE,
  SERVICE_ACCESS_LEVELS,
  SERVICE_ROLES,
  parseServices,
  isAllowedRedirect,
  isRoleAllowed,
  normalizeServiceRoles,
  resolveServiceRole,
  createTicket,
  verifyTicket
};
