"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { calculateDashboard } = require("./src/analytics");
const { getMoscowNow } = require("./src/time");
const {
  addDealAction,
  appendIntegrationAudit,
  addDocumentRequestAttachment,
  archiveClient,
  bulkBlockClientDeals,
  confirmDocumentRequest,
  createBank,
  createClient,
  createDeal,
  createDocumentRequest,
  createKnowledgeEntry,
  createManager,
  createTask,
  deleteClient,
  deleteDeal,
  deleteDocumentRequest,
  deleteManager,
  deleteTask,
  fulfillDocumentRequest,
  markDealChecked,
  dealNeedsCheck,
  isDealCheckedToday,
  CHECKABLE_STAGES,
  getBanks,
  getClients,
  getDeals,
  getDocumentRequests,
  getKnowledge,
  getProgramDiscoveries,
  getManagers,
  getTasks,
  removeDocumentRequestAttachment,
  updateDeal,
  updateKnowledgeProgram,
  updateManager,
  updateTask,
  upsertIntegrationClient,
  upsertProgramDiscovery,
  upsertCreditAnalysisBundle,
  decideCreditAnalysisConclusion,
  initStore
} = require("./src/store");
const users = require("./src/users");
const { defaultStore: sessionStore } = require("./src/sessions");
const googleDrive = require("./src/googleDrive");
const telegram = require("./src/telegram");
const eventBus = require("./src/eventBus");
const {
  SERVICE_ROLE,
  authenticateServiceBearer,
  buildChangeSet,
  normalizeIdentityName,
  normalizeInn,
  normalizeProgramDiscovery,
  normalizeCreditAnalysisBundle,
  normalizeCreditAnalysisDecision,
  requestHash,
  sha256,
  summarizeQuality,
  validateIntegrationDecision
} = require("./src/integrationApi");
const {
  setClientTelegramTopicId,
  setClientTelegramBossTopicId,
  setDocumentRequestOpenMessageId,
  addDocumentRequestPartialUploadMessageId,
  clearDocumentRequestPartialUploadMessageIds,
  getProgramTypes,
  createProgramType,
  updateProgramType,
  deleteProgramType,
  getProgramCategories,
  createProgramCategory,
  updateProgramCategory,
  deleteProgramCategory,
  seedTaxonomyIfEmpty,
  reloadTaxonomyCache
} = require("./src/store");
const Busboy = require("busboy");

// Резолвит/создаёт topic-id в форум-группе для клиента.
// Возвращает строковый thread_id или "" если не удалось.
// Сколько дней заявка провела в текущем статусе. Берём дату начала
// от наиболее свежей из: signedAt (для submitted) / inquiryAt (для lead)
// / fallback updatedAt → createdAt.
function daysInStage(deal) {
  const stageStart = deal.stage === "submitted"
    ? (deal.signedAt || deal.updatedAt || deal.createdAt)
    : deal.stage === "lead"
      ? (deal.inquiryAt || deal.updatedAt || deal.createdAt)
      : (deal.updatedAt || deal.createdAt);
  if (!stageStart) return null;
  const ms = Date.now() - new Date(stageStart).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / (24 * 3600 * 1000));
}

// Готовит данные для notifyBossClientReport по одному клиенту.
function buildBossClientReport(clientName, manager, activeDeals, trigger = "checked") {
  const deals = activeDeals.map((d) => {
    const lastAction = Array.isArray(d.actions) && d.actions.length
      ? d.actions[d.actions.length - 1]
      : null;
    return {
      stageLabel: d.stageLabel,
      daysInStage: daysInStage(d),
      bank: d.bank,
      program: d.program,
      amountRequested: d.amountRequested,
      lastActionText: lastAction?.action || "",
      lastActionDate: lastAction?.actionAt ? new Date(lastAction.actionAt).toLocaleDateString("ru-RU") : ""
    };
  });
  return { clientName, manager, deals, trigger };
}

// Резолвит/создаёт topic-id в чате Биг Босса для клиента. Если чат Босса —
// форум-группа (Topics включены), создаём отдельный топик под каждого клиента
// и кэшируем его id в client.telegramBossTopicId. Если форум не включён или
// нет прав — возвращаем "" и отчёт уйдёт в общий чат.
async function resolveBossClientTopicId(clientName, managerName, bossChatId) {
  try {
    if (!bossChatId || !clientName) return "";
    const clients = await getClients();
    const nameLc = String(clientName).trim().toLowerCase();
    const mgrLc = String(managerName || "").trim().toLowerCase();
    const cli = clients.find((c) =>
      String(c.name || "").trim().toLowerCase() === nameLc &&
      String(c.manager || "").trim().toLowerCase() === mgrLc
    ) || clients.find((c) => String(c.name || "").trim().toLowerCase() === nameLc);
    if (!cli) return "";
    if (cli.telegramBossTopicId) return String(cli.telegramBossTopicId);
    // Создаём новый.
    const topicName = managerName ? `${cli.name} (${managerName})` : cli.name;
    const result = await telegram.createForumTopic(topicName, { chatId: bossChatId });
    if (!result?.message_thread_id) return "";
    const threadId = String(result.message_thread_id);
    try {
      await setClientTelegramBossTopicId(cli.id, threadId);
    } catch (e) {
      console.warn("[boss-topic] persist error:", e.message);
    }
    // Якорное сообщение — чтобы топик не «опустошался» при удалениях.
    try {
      const esc = telegram.escapeHtml;
      const anchor = `📌 <b>${esc(cli.name)}</b>\n`
        + (managerName ? `Аналитик: ${esc(managerName)}\n` : "")
        + `\nТопик создан автоматически. Суммарные отчёты по клиенту приходят сюда.`;
      await telegram.sendTelegramMessage(anchor, { chatId: bossChatId, topicId: threadId });
    } catch (e) {
      console.warn("[boss-topic] anchor error:", e.message);
    }
    return threadId;
  } catch (error) {
    console.warn("[boss-topic] resolve error:", error.message);
    return "";
  }
}

// Активный клиент = есть в справочнике clients и без archivedAt.
// Используется в утренних пингах и при «Обновить статусы»: даже если
// у архивных/удалённых клиентов остались deals в активных стадиях —
// они не должны попадать в отчёты и уведомления.
async function buildActiveClientKeySet() {
  const clients = await getClients();
  const set = new Set();
  for (const c of clients) {
    if (c.archivedAt) continue;
    const k = `${String(c.manager || "").trim().toLowerCase()}|${String(c.name || "").trim().toLowerCase()}`;
    set.add(k);
  }
  return set;
}
function dealClientKey(deal) {
  return `${String(deal.manager || "").trim().toLowerCase()}|${String(deal.client || "").trim().toLowerCase()}`;
}

// Дебаунсенная отправка суммарного отчёта Биг Боссу. Поведение:
// - на каждый «полный набор проверок клиента» ставим таймер на 60с;
// - если внутри окна происходит новая проверка/смена статуса по тому же
//   клиенту — таймер сбрасывается;
// - в момент срабатывания таймера ещё раз проверяем условие
//   «нет непроверенных активных заявок» и состояние клиента (активен).
// Хранится в памяти процесса; при рестарте теряется (следующее
// изменение даст новый таймер).
const pendingBossReports = new Map(); // key=`${manager.lc}|${client.lc}` → setTimeout handle
const BOSS_REPORT_DEBOUNCE_MS = 60 * 1000;

// Выходные по МСК — тишина по всем автоматическим TG-уведомлениям.
// Ручные действия админа (refresh-status) работают всегда.
function isMoscowWeekendNow() {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      weekday: "short"
    }).format(new Date());
    return weekday === "Sat" || weekday === "Sun";
  } catch {
    return false;
  }
}

function scheduleBossClientReport(clientName, managerName, trigger = "checked") {
  // Тишина по выходным — таймер даже не ставим.
  if (isMoscowWeekendNow()) return;
  const key = `${String(managerName || "").trim().toLowerCase()}|${String(clientName || "").trim().toLowerCase()}`;
  if (!key.trim() || key === "|") return;
  const prev = pendingBossReports.get(key);
  if (prev) clearTimeout(prev);
  const handle = setTimeout(async () => {
    pendingBossReports.delete(key);
    try {
      // Пятница 23:59:30 → таймер отработает в 00:00:30 субботы — тоже гасим.
      if (isMoscowWeekendNow()) return;
      const activeKeys = await buildActiveClientKeySet();
      if (!activeKeys.has(key)) return; // клиент в архиве/удалён за окно ожидания
      const allDeals = await getDeals();
      const sameClient = allDeals.filter((d) =>
        String(d.client || "").trim().toLowerCase() === String(clientName || "").trim().toLowerCase() &&
        String(d.manager || "").trim().toLowerCase() === String(managerName || "").trim().toLowerCase()
      );
      const remaining = sameClient.filter((d) => dealNeedsCheck(d));
      if (remaining.length > 0) return; // ещё не все проверены — отменяемся
      const activeDeals = sameClient.filter((d) => CHECKABLE_STAGES.has(d.stage));
      if (!activeDeals.length) return; // нечего отправлять
      const report = buildBossClientReport(clientName, managerName, activeDeals, trigger);
      const bossChatId = await resolveBossChatId();
      if (!bossChatId) {
        console.warn(`[boss-report] нет привязанного chatId Биг Босса (client=${clientName})`);
        return;
      }
      const topicId = await resolveBossClientTopicId(clientName, managerName, bossChatId);
      await telegram.notifyBossClientReport(report, { chatId: bossChatId, topicId });
    } catch (e) {
      console.warn("[boss-report] debounced send error:", e.message);
    }
  }, BOSS_REPORT_DEBOUNCE_MS);
  // unref чтобы таймер не держал event loop при остановке процесса
  if (typeof handle.unref === "function") handle.unref();
  pendingBossReports.set(key, handle);
}

// Резолвим TG-chatId аналитика по его имени. Сначала через привязку
// manager.userId → user.telegramChatId, потом fallback по fullName.
// Возвращает "" если привязки нет.
async function resolveAnalystChatId(analystName) {
  try {
    if (!analystName) return "";
    const nameKey = String(analystName).trim().toLowerCase();
    const managers = await getManagers();
    const manager = managers.find((m) => String(m.name || "").trim().toLowerCase() === nameKey);
    if (!manager) return "";
    const allUsers = await users.listUsers();
    const linked = (manager.userId && allUsers.find((u) => u.id === manager.userId))
      || allUsers.find((u) => String(u.fullName || "").trim().toLowerCase() === nameKey);
    return linked?.telegramChatId ? String(linked.telegramChatId) : "";
  } catch (e) {
    console.warn("[analyst-chat-id] resolve error:", e.message);
    return "";
  }
}

// Резолвим chatId Биг Босса. По договорённости — это пользователь системы
// с fullName «Биг Босс» (case-insensitive) или login bigboss/boss; берём
// его привязанный telegramChatId. Если такой пользователь не найден или
// chatId не привязан — fallback на env TELEGRAM_BOSS_CHAT_ID.
async function resolveBossChatId() {
  try {
    const all = await users.listUsers();
    const candidate = all.find((u) => {
      const fn = String(u.fullName || "").trim().toLowerCase();
      const lg = String(u.login || "").trim().toLowerCase();
      return fn === "биг босс" || fn.includes("биг босс") || lg === "bigboss" || lg === "boss";
    });
    if (candidate?.telegramChatId) return String(candidate.telegramChatId);
  } catch (e) {
    console.warn("[boss] resolve from users error:", e.message);
  }
  return process.env.TELEGRAM_BOSS_CHAT_ID || "";
}

// Тянем сумму заявки из связанного deal по dealId — чтобы пробрасывать
// её в telegram-уведомления по запросам документов.
async function resolveDealAmountsForDocRequest(req) {
  try {
    if (!req?.dealId) return {};
    const deals = await getDeals();
    const deal = deals.find((d) => d.id === req.dealId);
    if (!deal) return {};
    return {
      amountRequested: Number(deal.amountRequested || 0),
      amountApproved: Number(deal.amountApproved || 0)
    };
  } catch {
    return {};
  }
}

async function resolveClientTopicId(clientName, managerName) {
  try {
    if (!clientName) return "";
    const clients = await getClients();
    const cli = clients.find((c) =>
      String(c.name || "").trim().toLowerCase() === String(clientName).trim().toLowerCase() &&
      String(c.manager || "").trim().toLowerCase() === String(managerName || "").trim().toLowerCase()
    ) || clients.find((c) => String(c.name || "").trim().toLowerCase() === String(clientName).trim().toLowerCase());
    if (!cli) return "";
    if (cli.telegramTopicId) return String(cli.telegramTopicId);
    // создаём новый топик
    const topicName = managerName ? `${cli.name} (${managerName})` : cli.name;
    const result = await telegram.createForumTopic(topicName);
    if (!result?.message_thread_id) return "";
    const threadId = String(result.message_thread_id);
    try {
      await setClientTelegramTopicId(cli.id, threadId);
    } catch (e) {
      console.warn("[telegram] failed to persist topicId:", e.message);
    }
    // Открывающее сообщение-якорь: остаётся в топике навсегда, чтобы топик
    // не «опустошился» при последующих удалениях.
    try {
      const esc = telegram.escapeHtml;
      const anchorText = `📌 <b>${esc(cli.name)}</b>\n`
        + (managerName ? `Аналитик: ${esc(managerName)}\n` : "")
        + (cli.driveUrl ? `<a href="${esc(cli.driveUrl)}">Папка клиента на Drive</a>\n` : "")
        + `\nТопик создан автоматически. Все события по клиенту приходят сюда.`;
      await telegram.sendTelegramMessage(anchorText, { topicId: threadId });
    } catch (e) {
      console.warn("[telegram] anchor message error:", e.message);
    }
    // Дополнительное сообщение-старт: заголовок «ЗАПРОС СЕССИИ», чтобы
    // документы-офицер сразу видел, к какому шагу привязан топик.
    try {
      await telegram.sendTelegramMessage(`<b>ЗАПРОС СЕССИИ</b>`, { topicId: threadId });
    } catch (e) {
      console.warn("[telegram] session-request message error:", e.message);
    }
    return threadId;
  } catch (error) {
    console.warn("[telegram] resolveClientTopicId error:", error.message);
    return "";
  }
}

// OAuth one-time state -> userId (TTL 10 min). In-memory, переживает только до рестарта.
const oauthStates = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
function createOAuthState(userId) {
  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.set(state, { userId, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
  return state;
}
function consumeOAuthState(state) {
  const entry = oauthStates.get(state);
  if (!entry) return null;
  oauthStates.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}
// чистка протухших раз в 5 минут
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStates) if (v.expiresAt < now) oauthStates.delete(k);
}, 5 * 60 * 1000).unref();

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE = "am_session";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const GZIP_MIN_BYTES = 1024;
const COMPRESSIBLE_TYPE_PATTERN = /^(?:text\/|application\/(?:json|javascript|xml)|image\/svg)/i;
const API_ETAG_MIN_BYTES = 64;

function computeEtag(body) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return `W/"${crypto.createHash("sha1").update(data).digest("base64").slice(0, 27)}"`;
}

function acceptsGzip(request) {
  const header = request?.headers?.["accept-encoding"];
  return typeof header === "string" && /\bgzip\b/i.test(header);
}

function byteLength(body) {
  return Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body));
}

function sendCompressed(request, response, statusCode, headers, body) {
  if (statusCode === 200 && headers.ETag && request?.headers?.["if-none-match"] === headers.ETag) {
    const conditional = {
      "Cache-Control": headers["Cache-Control"],
      "ETag": headers.ETag
    };
    if (headers.Vary) {
      conditional.Vary = headers.Vary;
    }
    response.writeHead(304, conditional);
    response.end();
    return;
  }

  const contentType = headers["Content-Type"] || "";
  const compressible =
    acceptsGzip(request) &&
    byteLength(body) >= GZIP_MIN_BYTES &&
    COMPRESSIBLE_TYPE_PATTERN.test(contentType);

  if (!compressible) {
    response.writeHead(statusCode, headers);
    response.end(body);
    return;
  }

  const source = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  zlib.gzip(source, (error, gzipped) => {
    if (error) {
      response.writeHead(statusCode, headers);
      response.end(body);
      return;
    }
    response.writeHead(statusCode, {
      ...headers,
      "Content-Encoding": "gzip",
      "Vary": "Accept-Encoding"
    });
    response.end(gzipped);
  });
}

function sendJson(response, statusCode, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  const headers = {
    "Cache-Control": "no-cache",
    "Content-Type": "application/json; charset=utf-8",
    "Pragma": "no-cache"
  };
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }
  if (statusCode === 200 && Buffer.byteLength(body) >= API_ETAG_MIN_BYTES) {
    headers.ETag = computeEtag(body);
  }
  sendCompressed(response.req, response, statusCode, headers, body);
}

function parseCookies(header) {
  const result = {};
  if (!header || typeof header !== "string") {
    return result;
  }
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) {
      continue;
    }
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }
  return result;
}

function buildSessionCookie(token, ttlMs, { secure = false } = {}) {
  const maxAge = Math.floor(ttlMs / 1000);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function clearSessionCookie({ secure = false } = {}) {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

// На проде по умолчанию выставляем Secure (HTTPS-only). Снять можно только
// явно через COOKIE_SECURE=false (для локальной разработки).
function shouldUseSecureCookie(request) {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  const forwardedProto = request?.headers?.["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.split(",")[0].trim() === "https") {
    return true;
  }
  // Defense-in-depth: на NODE_ENV=production требуем Secure, даже если прокси
  // не прислал x-forwarded-proto.
  if (process.env.NODE_ENV === "production") return true;
  return false;
}

function readBearerToken(request) {
  const header = request.headers?.authorization || request.headers?.Authorization;
  if (typeof header !== "string") {
    return "";
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function attachUser(request) {
  const cookies = parseCookies(request.headers?.cookie);
  const bearerToken = readBearerToken(request);
  const service = bearerToken ? authenticateServiceBearer(bearerToken) : null;
  if (service) {
    request.user = service.user;
    request.serviceScopes = service.scopes;
    request.sessionToken = "";
    return;
  }
  const token = bearerToken || cookies[SESSION_COOKIE] || "";
  const session = token ? sessionStore.get(token) : null;
  if (!session) {
    request.user = null;
    request.sessionToken = "";
    return;
  }
  const user = await users.findUserById(session.userId);
  if (!user) {
    sessionStore.destroy(token);
    request.user = null;
    request.sessionToken = "";
    return;
  }
  request.user = users.publicUser(user);
  request.sessionToken = token;
}

function requireServiceScope(request, scope) {
  if (request.user?.role !== SERVICE_ROLE) throw new AuthError(403, "Маршрут доступен только сервисной интеграции");
  if (!request.serviceScopes?.has(scope)) throw new AuthError(403, `Нет сервисного права: ${scope}`);
}

function readIdempotencyKey(request) {
  return String(request.headers?.["idempotency-key"] || "").trim();
}

function requireIdempotency(request) {
  const key = readIdempotencyKey(request);
  if (!key || key.length < 8 || key.length > 200) {
    throw new AuthError(400, "Для мутации нужен Idempotency-Key длиной 8–200 символов");
  }
  return { keyHash: sha256(key) };
}

function findKnowledgeProgram(knowledge, programId) {
  for (const bank of knowledge || []) {
    const program = (bank.programs || []).find((item) => item.id === programId);
    if (program) return { bank, program };
  }
  return null;
}

function integrationDealPayload(payload, client, knowledgeEntry, idempotency) {
  const program = knowledgeEntry.program;
  const bankName = String(program.bank || knowledgeEntry.bank.bank || "").trim();
  const amountRequested = Number(payload.amountRequested || 0);
  if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
    throw new AuthError(400, "amountRequested должен быть положительным числом");
  }
  const wave = Math.max(0, Math.trunc(Number(payload.wave || 0)));
  const bodyHash = requestHash(payload);
  const decision = validateIntegrationDecision({
    ...payload,
    stage: payload.stage || "planned",
    amountApproved: payload.amountApproved || 0
  });
  return {
    ...payload,
    id: `deal-int-${idempotency.keyHash.slice(0, 24)}`,
    clientId: client.id,
    inn: client.inn,
    crmLeadId: client.crmLeadId,
    client: client.name,
    manager: client.manager,
    knowledgeProgramId: program.id,
    bank: bankName,
    program: program.program || "",
    programType: program.programType || "",
    programAmountRange: program.amountRange || "",
    programTermRange: program.termRange || "",
    stage: decision.stage,
    amountRequested,
    amountApproved: decision.amountApproved,
    decisionType: decision.decisionType,
    refusalReasonCode: decision.refusalReasonCode,
    conditions: decision.conditions,
    wave,
    entryType: payload.entryType || "application",
    integrationSource: "jarvis",
    integrationIdempotencyKeyHash: idempotency.keyHash,
    integrationRequestHash: bodyHash
  };
}

async function handleIntegrationApi(request, response, url, pathname) {
  if (!pathname.startsWith("/api/integration/v1/")) return false;

  if (request.method === "GET" && pathname === "/api/integration/v1/health") {
    requireServiceScope(request, "read");
    sendJson(response, 200, {
      ok: true,
      schemaVersion: 1,
      actor: request.user.login,
      scopes: [...request.serviceScopes].sort(),
      time: new Date().toISOString()
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/integration/v1/changes") {
    requireServiceScope(request, "read");
    const snapshotAt = new Date().toISOString();
    const updatedSince = String(url.searchParams.get("updatedSince") || "").trim();
    const [deals, clients, knowledge, documentRequests] = await Promise.all([
      getDeals(), getClients(), getKnowledge(), getDocumentRequests()
    ]);
    sendJson(response, 200, buildChangeSet({ deals, clients, knowledge, documentRequests, updatedSince, snapshotAt }));
    return true;
  }

  if (request.method === "GET" && pathname === "/api/integration/v1/quality") {
    requireServiceScope(request, "read");
    sendJson(response, 200, { schemaVersion: 1, generatedAt: new Date().toISOString(), ...summarizeQuality(await getDeals()) });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/integration/v1/program-discoveries") {
    requireServiceScope(request, "read");
    const status = String(url.searchParams.get("status") || "").trim();
    const limit = Number(url.searchParams.get("limit") || 200);
    sendJson(response, 200, {
      schemaVersion: 1,
      discoveries: await getProgramDiscoveries({ status, limit })
    });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/integration/v1/program-discoveries/upsert") {
    requireServiceScope(request, "write_analytics");
    const idempotency = requireIdempotency(request);
    const payload = await readBody(request);
    const candidate = normalizeProgramDiscovery(payload);
    const hash = requestHash(candidate);
    const details = {
      query: String(payload.query || "").slice(0, 500),
      matchedProgramId: String(payload.matchedProgramId || "").slice(0, 120),
      diff: payload.diff && typeof payload.diff === "object" && !Array.isArray(payload.diff) ? payload.diff : {},
      notes: String(payload.notes || "").slice(0, 2000),
      requestHash: hash,
      idempotencyKeyHash: idempotency.keyHash
    };
    const result = await upsertProgramDiscovery({
      id: `pd-${sha256(candidate.sourceUrl).slice(0, 24)}`,
      ...candidate,
      seenAt: String(payload.seenAt || "").trim(),
      officialVerifiedAt: String(payload.officialVerifiedAt || "").trim(),
      details
    });
    await appendIntegrationAudit({
      action: "program_discovery_upsert",
      resourceType: "program_discovery",
      resourceId: result.id,
      requestHash: hash,
      idempotencyKeyHash: idempotency.keyHash,
      details: {
        sourceType: candidate.sourceType,
        status: candidate.status,
        snapshotInserted: result.snapshotInserted,
        catalogMutated: false
      }
    });
    sendJson(response, result.inserted ? 201 : 200, { discovery: result, catalogMutated: false });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/integration/v1/credit-analytics/bundles/upsert") {
    requireServiceScope(request, "write_analytics");
    const idempotency = requireIdempotency(request);
    const payload = await readBody(request);
    const bundle = normalizeCreditAnalysisBundle(payload);
    const result = await upsertCreditAnalysisBundle(bundle);
    await appendIntegrationAudit({
      action: "credit_analysis_bundle_upsert",
      resourceType: "credit_analysis_bundle",
      resourceId: `${result.caseRef}:${result.conclusionHash}`,
      requestHash: bundle.requestHash,
      idempotencyKeyHash: idempotency.keyHash,
      details: { snapshotHash: result.snapshotHash, status: result.status, agentSideEffect: false, crmSideEffect: false }
    });
    sendJson(response, 200, { schemaVersion: 1, result });
    return true;
  }

  const creditConclusionDecisionMatch = pathname.match(/^\/api\/integration\/v1\/credit-analytics\/conclusions\/([a-f0-9]+)\/decision$/u);
  if (request.method === "POST" && creditConclusionDecisionMatch) {
    requireServiceScope(request, "write_analytics");
    const idempotency = requireIdempotency(request);
    const payload = await readBody(request);
    const decision = normalizeCreditAnalysisDecision(payload, creditConclusionDecisionMatch[1]);
    const result = await decideCreditAnalysisConclusion(decision);
    await appendIntegrationAudit({
      action: "credit_analysis_conclusion_decision",
      resourceType: "credit_analysis_conclusion",
      resourceId: `${decision.caseRef}:${decision.conclusionHash}`,
      requestHash: requestHash(decision),
      idempotencyKeyHash: idempotency.keyHash,
      details: { decision: decision.decision, actor: decision.actor }
    });
    sendJson(response, 200, { schemaVersion: 1, result });
    return true;
  }

  const integrationDealReadMatch = pathname.match(/^\/api\/integration\/v1\/deals\/([^/]+)$/);
  if (request.method === "GET" && integrationDealReadMatch) {
    requireServiceScope(request, "read");
    const deal = (await getDeals()).find((item) => item.id === decodeURIComponent(integrationDealReadMatch[1]));
    if (!deal) throw new AuthError(404, "Deal not found");
    sendJson(response, 200, { deal });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/integration/v1/clients/upsert") {
    requireServiceScope(request, "write_plan");
    const idempotency = requireIdempotency(request);
    const payload = await readBody(request);
    payload.inn = normalizeInn(payload.inn);
    const hash = requestHash(payload);
    const existingMutation = (await getClients()).find((item) => item.lastIntegrationMutationKeyHash === idempotency.keyHash);
    if (existingMutation) {
      if (existingMutation.lastIntegrationMutationRequestHash !== hash) {
        throw new AuthError(409, "Idempotency-Key уже использован с другим телом запроса");
      }
      sendJson(response, 200, { client: existingMutation, replay: true });
      return true;
    }
    payload.lastIntegrationMutationKeyHash = idempotency.keyHash;
    payload.lastIntegrationMutationRequestHash = hash;
    const client = await upsertIntegrationClient(payload);
    await appendIntegrationAudit({
      action: "client_upsert",
      resourceType: "client",
      resourceId: client.id,
      requestHash: hash,
      idempotencyKeyHash: idempotency.keyHash
    });
    sendJson(response, 200, { client, replay: false });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/integration/v1/deals") {
    requireServiceScope(request, "write_plan");
    const idempotency = requireIdempotency(request);
    const payload = await readBody(request);
    const clients = await getClients();
    const client = clients.find((item) => item.id === String(payload.clientId || ""));
    if (!client || !client.inn || !client.crmLeadId) {
      throw new AuthError(400, "Сначала свяжите клиента по clientId + ИНН + crmLeadId");
    }
    const knowledgeEntry = findKnowledgeProgram(await getKnowledge(), String(payload.knowledgeProgramId || ""));
    if (!knowledgeEntry) throw new AuthError(400, "knowledgeProgramId не найден");
    const next = integrationDealPayload(payload, client, knowledgeEntry, idempotency);
    const existing = (await getDeals()).find((item) => item.integrationIdempotencyKeyHash === idempotency.keyHash);
    if (existing) {
      if (existing.integrationRequestHash !== next.integrationRequestHash) {
        throw new AuthError(409, "Idempotency-Key уже использован с другим телом запроса");
      }
      sendJson(response, 200, { deal: existing, replay: true });
      return true;
    }
    const deal = await createDeal(next);
    await appendIntegrationAudit({
      action: "deal_create",
      resourceType: "deal",
      resourceId: deal.id,
      requestHash: next.integrationRequestHash,
      idempotencyKeyHash: idempotency.keyHash,
      details: { clientId: client.id, knowledgeProgramId: deal.knowledgeProgramId, campaignId: deal.campaignId, wave: deal.wave }
    });
    sendJson(response, 201, { deal, replay: false });
    return true;
  }

  const integrationDealLinkMatch = pathname.match(/^\/api\/integration\/v1\/deals\/([^/]+)\/link-client$/);
  if (request.method === "POST" && integrationDealLinkMatch) {
    requireServiceScope(request, "write_plan");
    const idempotency = requireIdempotency(request);
    const dealId = decodeURIComponent(integrationDealLinkMatch[1]);
    const payload = await readBody(request);
    const hash = requestHash(payload);
    const existing = (await getDeals()).find((item) => item.id === dealId);
    if (!existing) throw new AuthError(404, "Deal not found");
    if (existing.lastIntegrationMutationKeyHash === idempotency.keyHash) {
      if (existing.lastIntegrationMutationRequestHash !== hash) {
        throw new AuthError(409, "Idempotency-Key уже использован с другим телом запроса");
      }
      sendJson(response, 200, { deal: existing, replay: true });
      return true;
    }
    const client = (await getClients()).find((item) => item.id === String(payload.clientId || ""));
    if (!client || !client.inn || !client.crmLeadId) {
      throw new AuthError(400, "Клиент должен иметь clientId + ИНН + crmLeadId");
    }
    if (existing.client && normalizeIdentityName(existing.client) !== normalizeIdentityName(client.name)) {
      throw new AuthError(409, "Имя клиента в заявке не совпадает с выбранной карточкой");
    }
    const deal = await updateDeal(dealId, {
      clientId: client.id,
      inn: client.inn,
      crmLeadId: client.crmLeadId,
      integrationSource: "jarvis",
      lastIntegrationMutationKeyHash: idempotency.keyHash,
      lastIntegrationMutationRequestHash: hash
    });
    await appendIntegrationAudit({
      action: "deal_client_link",
      resourceType: "deal",
      resourceId: deal.id,
      requestHash: hash,
      idempotencyKeyHash: idempotency.keyHash,
      details: { clientId: client.id, crmLeadId: client.crmLeadId }
    });
    sendJson(response, 200, { deal, replay: false });
    return true;
  }

  if (request.method === "PATCH" && integrationDealReadMatch) {
    requireServiceScope(request, "write_status");
    const idempotency = requireIdempotency(request);
    const dealId = decodeURIComponent(integrationDealReadMatch[1]);
    const existing = (await getDeals()).find((item) => item.id === dealId);
    if (!existing) throw new AuthError(404, "Deal not found");
    const payload = await readBody(request);
    const hash = requestHash(payload);
    if (existing.lastIntegrationMutationKeyHash === idempotency.keyHash) {
      if (existing.lastIntegrationMutationRequestHash !== hash) {
        throw new AuthError(409, "Idempotency-Key уже использован с другим телом запроса");
      }
      sendJson(response, 200, { deal: existing, replay: true });
      return true;
    }
    const allowed = [
      "stage", "amountApproved", "inquiryAt", "signedAt", "completedAt", "comment",
      "decisionType", "validUntil", "conditions", "refusalReasonCode", "lastCheckedAt"
    ];
    const patch = Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
    if (patch.stage && patch.stage !== "approved" && patch.amountApproved === undefined) patch.amountApproved = 0;
    const decision = validateIntegrationDecision(patch, existing);
    patch.stage = decision.stage;
    patch.amountApproved = decision.amountApproved;
    patch.decisionType = decision.decisionType;
    patch.refusalReasonCode = decision.refusalReasonCode;
    patch.conditions = decision.conditions;
    patch.lastIntegrationMutationKeyHash = idempotency.keyHash;
    patch.lastIntegrationMutationRequestHash = hash;
    const deal = await updateDeal(dealId, patch);
    await appendIntegrationAudit({
      action: "deal_update",
      resourceType: "deal",
      resourceId: deal.id,
      requestHash: hash,
      idempotencyKeyHash: idempotency.keyHash,
      details: { fields: Object.keys(patch).filter((key) => !key.includes("Integration")) }
    });
    sendJson(response, 200, { deal, replay: false });
    return true;
  }

  throw new AuthError(404, "Integration API route not found");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function staticCacheControl(ext) {
  if (ext === ".html" || ext === ".css" || ext === ".js") {
    return "no-cache";
  }
  if (ext === ".svg") {
    return "public, max-age=3600, must-revalidate";
  }
  return "public, max-age=300";
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalizedPath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const cacheControl = staticCacheControl(ext);
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, {
        "Cache-Control": cacheControl,
        "ETag": etag
      });
      response.end();
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      sendCompressed(request, response, 200, {
        "Cache-Control": cacheControl,
        "Content-Type": contentType,
        "ETag": etag,
        "Last-Modified": new Date(stat.mtimeMs).toUTCString()
      }, content);
    });
  });
}

class AuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function requireAuth(request) {
  if (!request.user) {
    throw new AuthError(401, "Не авторизовано");
  }
  return request.user;
}

function requireRole(request, allowedRoles) {
  const user = requireAuth(request);
  if (!allowedRoles.includes(user.role)) {
    throw new AuthError(403, "Недостаточно прав");
  }
  return user;
}

function isPartner(request) {
  return request.user?.role === "partner";
}

function partnerScope(request) {
  if (!isPartner(request)) {
    return null;
  }
  return String(request.user?.fullName || "").trim().toLowerCase();
}

function ensurePartnerOwnsManager(request, managerName) {
  const scope = partnerScope(request);
  if (!scope) {
    return;
  }
  if (String(managerName || "").trim().toLowerCase() !== scope) {
    throw new AuthError(403, "Можно работать только со своими клиентами");
  }
}

function filterByManager(items, scope, getter) {
  if (!scope) {
    return items;
  }
  return items.filter((item) => String(getter(item) || "").trim().toLowerCase() === scope);
}

async function handleAuth(request, response, pathname) {
  if (request.method === "POST" && pathname === "/api/auth/login") {
    const payload = await readBody(request);
    const login = String(payload.login || "").trim();
    const password = String(payload.password || "");
    if (!login || !password) {
      sendJson(response, 400, { error: "Логин и пароль обязательны" });
      return true;
    }
    const user = await users.authenticate(login, password);
    if (!user) {
      sendJson(response, 401, { error: "Неверный логин или пароль" });
      return true;
    }
    const session = sessionStore.create(user.id);
    // Возвращаем токен ТОЛЬКО в Set-Cookie (HttpOnly + Secure + SameSite=Strict).
    // В JSON-теле — больше нет, чтобы исключить попадание токена в localStorage
    // и его кражу через XSS.
    sendJson(
      response,
      200,
      { user: users.publicUser(user), expiresAt: session.expiresAt },
      { "Set-Cookie": buildSessionCookie(session.token, session.ttlMs, { secure: shouldUseSecureCookie(request) }) }
    );
    return true;
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    if (request.sessionToken) {
      sessionStore.destroy(request.sessionToken);
    }
    sendJson(
      response,
      200,
      { ok: true },
      { "Set-Cookie": clearSessionCookie({ secure: shouldUseSecureCookie(request) }) }
    );
    return true;
  }

  if (request.method === "GET" && pathname === "/api/auth/me") {
    if (!request.user) {
      sendJson(response, 401, { error: "Не авторизовано" });
      return true;
    }
    sendJson(response, 200, { user: request.user });
    return true;
  }

  return false;
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  // Live-updates: после любой успешной мутации (POST/PATCH/DELETE с 2xx)
  // дёргаем глобальный канал change → SSE-подписчики делают reload на клиенте.
  // Стрим и логин-операции пропускаем — у них своя семантика.
  if (request.method !== "GET" && request.method !== "HEAD" && !pathname.startsWith("/api/auth/") && pathname !== "/api/stream") {
    response.on("finish", () => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        try { eventBus.emit("dashboard"); } catch {}
      }
    });
  }

  if (pathname.startsWith("/api/auth/")) {
    const handled = await handleAuth(request, response, pathname);
    if (handled) {
      return;
    }
  }

  // Google OAuth callback публичен (state→user проверяем сами через oauthStates).
  if (request.method === "GET" && pathname === "/api/google/callback") {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const err = url.searchParams.get("error") || "";
    if (err) {
      response.writeHead(302, { Location: `/?integration=error&reason=${encodeURIComponent(err)}` });
      response.end();
      return;
    }
    const entry = consumeOAuthState(state);
    if (!entry) {
      response.writeHead(302, { Location: "/?integration=error&reason=invalid_state" });
      response.end();
      return;
    }
    // дополнительная проверка: пользователь существует и admin
    const u = await users.findUserById(entry.userId);
    if (!u || u.role !== "admin") {
      response.writeHead(302, { Location: "/?integration=error&reason=forbidden" });
      response.end();
      return;
    }
    try {
      const result = await googleDrive.handleOAuthCallback(code);
      response.writeHead(302, { Location: `/?integration=connected&email=${encodeURIComponent(result.connectedEmail || "")}` });
      response.end();
    } catch (error) {
      console.warn("[gdrive] callback error:", error.message);
      response.writeHead(302, { Location: `/?integration=error&reason=${encodeURIComponent(error.message)}` });
      response.end();
    }
    return;
  }

  // Все остальные /api/* требуют авторизации.
  requireAuth(request);

  if (request.user.role === SERVICE_ROLE) {
    if (!pathname.startsWith("/api/integration/v1/")) {
      throw new AuthError(403, "Сервисная учётка не имеет доступа к пользовательскому API");
    }
    await handleIntegrationApi(request, response, url, pathname);
    return;
  }

  // documents_officer имеет доступ только к запросам документов.
  if (request.user.role === "documents_officer" && !pathname.startsWith("/api/document-requests")) {
    throw new AuthError(403, "Доступ только к запросам документов");
  }

  // Server-Sent Events: держим соединение, пушим события из eventBus.
  // Клиент (app.js) на любое событие делает loadData() с debounce.
  if (request.method === "GET" && pathname === "/api/stream") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no" // отключаем nginx-буферизацию, если она вдруг есть
    });
    // Первый ping чтобы EventSource перешёл в open.
    response.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    // Keep-alive каждые 25 сек — Railway/nginx идлит соединения.
    const keepAlive = setInterval(() => {
      try { response.write(`: keep-alive ${Date.now()}\n\n`); }
      catch { clearInterval(keepAlive); }
    }, 25000);
    const off = eventBus.on((payload) => {
      try {
        response.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // соединение закрыто/сломано — отписываемся
        off();
        clearInterval(keepAlive);
      }
    });
    const cleanup = () => {
      off();
      clearInterval(keepAlive);
      try { response.end(); } catch {}
    };
    request.on("close", cleanup);
    request.on("error", cleanup);
    return;
  }

  const scope = partnerScope(request);

  if (request.method === "GET" && pathname === "/api/dashboard") {
    const time = await getMoscowNow();
    let deals = await getDeals();
    deals = filterByManager(deals, scope, (deal) => deal.manager);
    sendJson(response, 200, calculateDashboard(deals, new Date(time.iso), time));
    return;
  }

  if (request.method === "GET" && pathname === "/api/time") {
    sendJson(response, 200, { time: await getMoscowNow() });
    return;
  }

  if (request.method === "GET" && pathname === "/api/deals") {
    const deals = filterByManager(await getDeals(), scope, (deal) => deal.manager);
    sendJson(response, 200, { deals });
    return;
  }

  if (request.method === "POST" && pathname === "/api/deals") {
    const payload = await readBody(request);
    ensurePartnerOwnsManager(request, payload.manager);
    sendJson(response, 201, { deal: await createDeal(payload) });
    return;
  }

  const dealActionMatch = pathname.match(/^\/api\/deals\/([^/]+)\/actions$/);
  if (request.method === "POST" && dealActionMatch) {
    const dealId = decodeURIComponent(dealActionMatch[1]);
    if (scope) {
      const existing = (await getDeals()).find((deal) => deal.id === dealId);
      if (!existing) {
        sendJson(response, 404, { error: "Deal not found" });
        return;
      }
      ensurePartnerOwnsManager(request, existing.manager);
    }
    const payload = await readBody(request);
    const deal = await addDealAction(dealId, payload);
    if (!deal) {
      sendJson(response, 404, { error: "Deal not found" });
      return;
    }
    sendJson(response, 201, { deal });
    return;
  }

  const dealMatch = pathname.match(/^\/api\/deals\/([^/]+)$/);
  if (request.method === "PATCH" && dealMatch) {
    const dealId = decodeURIComponent(dealMatch[1]);
    const payload = await readBody(request);
    // Запоминаем prev для уведомления о смене ключевого статуса.
    const previous = (await getDeals()).find((d) => d.id === dealId) || null;
    if (scope) {
      if (!previous) {
        sendJson(response, 404, { error: "Deal not found" });
        return;
      }
      ensurePartnerOwnsManager(request, previous.manager);
      if (payload.manager !== undefined) {
        ensurePartnerOwnsManager(request, payload.manager);
      }
    }
    const deal = await updateDeal(dealId, payload);
    if (!deal) {
      sendJson(response, 404, { error: "Deal not found" });
      return;
    }
    sendJson(response, 200, { deal });
    // Смена стадии: уведомление в boss-топик клиента + при необходимости
    // auto-mark как проверенной + ставим дебаунсенный отчёт.
    if (previous && previous.stage !== deal.stage) {
      (async () => {
        try {
          // 1) Если заявка была «проверяемой» (lead/documents_requested/submitted)
          // и stage поменялся — считаем, что аналитик её посмотрел (стадия не
          // меняется без человека), отметим проверенной автоматически.
          if (CHECKABLE_STAGES.has(previous.stage) && !isDealCheckedToday(deal)) {
            try { await markDealChecked(deal.id); }
            catch (e) { console.warn("[stage-change] auto-check error:", e.message); }
          }
          // 2) Уведомление в Boss-чат → топик клиента. Локальный try/catch,
          // чтобы любая ошибка TG (Boss-чат не настроен, fetch failure,
          // нет прав на топик) не помешала вызвать scheduleBossClientReport
          // ниже — иначе debounce-триггер для этого перехода терялся бы.
          // По выходным (МСК) TG-уведомления не шлём (auto-check выше
          // и scheduleBossClientReport ниже сами внутри проверяют выходной).
          try {
            const ALERT_STAGES = new Set(["submitted", "approved", "rejected", "blocked"]);
            if (!isMoscowWeekendNow() && (ALERT_STAGES.has(deal.stage) || ALERT_STAGES.has(previous.stage))) {
              const bossChatId = await resolveBossChatId();
              if (bossChatId) {
                const topicId = await resolveBossClientTopicId(deal.client, deal.manager, bossChatId);
                await telegram.notifyDealStageChange(deal, {
                  prevStageLabel: previous.stageLabel || previous.stage,
                  newStageLabel: deal.stageLabel || deal.stage,
                  chatId: bossChatId,
                  topicId
                });
              } else {
                console.warn("[stage-change] нет привязанного chatId Биг Босса");
              }
            }
          } catch (alertError) {
            console.warn("[stage-change] alert error:", alertError.message);
          }
          // 3) Дебаунсенный сводный отчёт по клиенту (1 мин окно).
          // Вызывается ВСЕГДА — даже если TG-алерт выше упал.
          scheduleBossClientReport(deal.client, deal.manager);
        } catch (error) {
          console.warn("[stage-change] dispatch error:", error.message);
        }
      })().catch(() => null);
    }
    return;
  }

  if (request.method === "DELETE" && dealMatch) {
    const dealId = decodeURIComponent(dealMatch[1]);
    if (scope) {
      const existing = (await getDeals()).find((deal) => deal.id === dealId);
      if (!existing) {
        sendJson(response, 404, { error: "Deal not found" });
        return;
      }
      ensurePartnerOwnsManager(request, existing.manager);
    }
    const deal = await deleteDeal(dealId);
    if (!deal) {
      sendJson(response, 404, { error: "Deal not found" });
      return;
    }
    sendJson(response, 200, { deal });
    return;
  }

  // PATCH /api/deals/:id/check — отметить заявку как «проверенную» на сегодня.
  // Требует note (что сделано) — записывается в хронологию сделки как action.
  // Если после этого у клиента не осталось непроверенных активных заявок,
  // шлём суммарный отчёт Биг Боссу в личку (с 60с debounce).
  const dealCheckMatch = pathname.match(/^\/api\/deals\/([^/]+)\/check$/);
  if (request.method === "PATCH" && dealCheckMatch) {
    const dealId = decodeURIComponent(dealCheckMatch[1]);
    const body = await readBody(request).catch(() => ({}));
    const note = String(body?.note ?? "").trim();
    if (!note) {
      sendJson(response, 400, { error: "Укажите, что сделано по заявке" });
      return;
    }
    const existing = (await getDeals()).find((d) => d.id === dealId);
    if (!existing) {
      sendJson(response, 404, { error: "Deal not found" });
      return;
    }
    if (scope) ensurePartnerOwnsManager(request, existing.manager);
    if (!CHECKABLE_STAGES.has(existing.stage)) {
      sendJson(response, 400, { error: "Эту заявку проверять не нужно — статус не входит в список ежедневной проверки" });
      return;
    }
    // Сначала пишем действие в хронологию, потом отметку — чтобы дата action
    // была строго до updatedAt самой заявки.
    const actor = request.user?.fullName ? ` (${request.user.fullName})` : "";
    try {
      await addDealAction(dealId, { action: `Проверка заявки${actor}: ${note}` });
    } catch (e) {
      console.warn("[check] addDealAction error:", e.message);
    }
    const updated = await markDealChecked(dealId);
    sendJson(response, 200, { deal: updated });
    scheduleBossClientReport(existing.client, existing.manager);
    return;
  }

  // POST /api/deals/reorder — обновить orderIndex для набора заявок разом.
  // Тело: { order: [{ id, orderIndex }, ...] }. Партнёр-скоуп проверяем для
  // каждой заявки отдельно.
  if (request.method === "POST" && pathname === "/api/deals/reorder") {
    const payload = await readBody(request);
    const order = Array.isArray(payload?.order) ? payload.order : [];
    if (!order.length) {
      sendJson(response, 400, { error: "order обязателен, массив {id, orderIndex}" });
      return;
    }
    const allDeals = await getDeals();
    const byId = new Map(allDeals.map((d) => [d.id, d]));
    // Проверка партнёр-скоупа: пользователь-partner может двигать только своих.
    if (scope) {
      for (const item of order) {
        const existing = byId.get(String(item.id || ""));
        if (existing) ensurePartnerOwnsManager(request, existing.manager);
      }
    }
    let updated = 0;
    for (const item of order) {
      const dealId = String(item.id || "");
      const orderIndex = Number(item.orderIndex);
      if (!dealId || !byId.has(dealId) || !Number.isFinite(orderIndex)) continue;
      try {
        await updateDeal(dealId, { orderIndex });
        updated += 1;
      } catch (e) {
        console.warn("[reorder] update error:", dealId, e.message);
      }
    }
    sendJson(response, 200, { updated, total: order.length });
    return;
  }

  // POST /api/admin/refresh-status — админ дёргает суммарный отчёт по
  // каждому клиенту с активными заявками. Результат: count отправленных.
  if (request.method === "POST" && pathname === "/api/admin/refresh-status") {
    requireRole(request, ["admin"]);
    const allDeals = await getDeals();
    // Группируем по (manager, client).
    const activeKeys = await buildActiveClientKeySet();
    // Архивных/удалённых пропускаем — у них не должно быть отчётов даже
    // при наличии активных заявок в БД.
    const groups = new Map();
    for (const d of allDeals) {
      if (!CHECKABLE_STAGES.has(d.stage)) continue;
      if (!activeKeys.has(dealClientKey(d))) continue;
      const key = dealClientKey(d);
      if (!groups.has(key)) groups.set(key, { client: d.client, manager: d.manager, deals: [] });
      groups.get(key).deals.push(d);
    }
    const bossChatId = await resolveBossChatId();
    if (!bossChatId) {
      sendJson(response, 200, { sent: 0, total: groups.size, bossConfigured: false, details: [], error: "Биг Босс не настроен: не найден пользователь с fullName «Биг Босс» и привязанным telegramChatId" });
      return;
    }
    const sent = [];
    for (const { client, manager, deals } of groups.values()) {
      try {
        const report = buildBossClientReport(client, manager, deals, "refresh");
        const topicId = await resolveBossClientTopicId(client, manager, bossChatId);
        const res = await telegram.notifyBossClientReport(report, { chatId: bossChatId, topicId });
        if (res && res.ok !== false) sent.push({ client, manager, count: deals.length });
      } catch (e) {
        console.warn("[refresh-status]", client, e.message);
      }
    }
    sendJson(response, 200, { sent: sent.length, total: groups.size, bossConfigured: true, details: sent });
    return;
  }

  if (request.method === "GET" && pathname === "/api/banks") {
    sendJson(response, 200, { banks: await getBanks() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/banks") {
    requireRole(request, ["admin", "analyst_abram"]);
    const payload = await readBody(request);
    sendJson(response, 201, { bank: await createBank(payload) });
    return;
  }

  if (request.method === "GET" && pathname === "/api/clients") {
    const clients = filterByManager(await getClients(), scope, (client) => client.manager);
    sendJson(response, 200, { clients });
    return;
  }

  if (request.method === "POST" && pathname === "/api/clients") {
    const payload = await readBody(request);
    ensurePartnerOwnsManager(request, payload.manager);
    const client = await createClient(payload);
    sendJson(response, 201, { client });
    // Автосоздание TG-топика клиента в общем чате запросов документов —
    // fire-and-forget, чтобы ответ клиенту не тормозил. resolveClientTopicId
    // сам persists thread_id в client.telegramTopicId.
    (async () => {
      try {
        await resolveClientTopicId(client.name, client.manager);
      } catch (e) {
        console.warn("[client] auto-topic error:", e.message);
      }
    })().catch(() => {});
    return;
  }

  const clientArchiveMatch = pathname.match(/^\/api\/clients\/([^/]+)\/archive$/);
  if (request.method === "PATCH" && clientArchiveMatch) {
    const clientId = decodeURIComponent(clientArchiveMatch[1]);
    const existingClient = (await getClients()).find((c) => c.id === clientId);
    if (scope) {
      if (!existingClient) {
        sendJson(response, 404, { error: "Client not found" });
        return;
      }
      ensurePartnerOwnsManager(request, existingClient.manager);
    }
    const client = await archiveClient(clientId);
    if (!client) {
      sendJson(response, 404, { error: "Client not found" });
      return;
    }
    // Все незавершённые заявки клиента → blocked, причина «Закончили работу с клиентом».
    let blockedCount = 0;
    try {
      blockedCount = await bulkBlockClientDeals(client.name, client.manager, "Закончили работу с клиентом");
    } catch (e) {
      console.warn("[archive] bulkBlockClientDeals error:", e.message);
    }
    sendJson(response, 200, { client, blockedDeals: blockedCount });
    // Архивация: закрываем топики (общий + boss-топик в чате Босса).
    // Если Telegram не умеет close (старый клиент/нет прав) — fallback на delete.
    const topicId = existingClient?.telegramTopicId || client.telegramTopicId;
    const bossTopicId = existingClient?.telegramBossTopicId || client.telegramBossTopicId;
    (async () => {
      if (topicId) {
        const closed = await telegram.closeForumTopic(topicId).catch(() => false);
        if (!closed) {
          await telegram.deleteForumTopic(topicId).catch((e) => console.warn("[telegram] archive: topic cleanup error:", e.message));
        }
      }
      if (bossTopicId) {
        const bossChatId = await resolveBossChatId();
        if (bossChatId) {
          const closed = await telegram.closeForumTopic(bossTopicId, { chatId: bossChatId }).catch(() => false);
          if (!closed) {
            await telegram.deleteForumTopic(bossTopicId, { chatId: bossChatId }).catch((e) => console.warn("[telegram] archive: boss topic cleanup error:", e.message));
          }
        }
      }
    })().catch(() => {});
    return;
  }

  const clientMatch = pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (request.method === "DELETE" && clientMatch) {
    const clientId = decodeURIComponent(clientMatch[1]);
    const existingClient = (await getClients()).find((c) => c.id === clientId);
    if (scope) {
      if (!existingClient) {
        sendJson(response, 404, { error: "Client not found" });
        return;
      }
      ensurePartnerOwnsManager(request, existingClient.manager);
    }
    const client = await deleteClient(clientId);
    if (!client) {
      sendJson(response, 404, { error: "Client not found" });
      return;
    }
    sendJson(response, 200, { client });
    // Удаляем оба топика клиента (общий + boss). Файлы на Drive не трогаем.
    const topicId = existingClient?.telegramTopicId || client.telegramTopicId;
    const bossTopicId = existingClient?.telegramBossTopicId || client.telegramBossTopicId;
    (async () => {
      if (topicId) {
        await telegram.deleteForumTopic(topicId).catch((e) => console.warn("[telegram] delete: topic cleanup error:", e.message));
      }
      if (bossTopicId) {
        const bossChatId = await resolveBossChatId();
        if (bossChatId) {
          await telegram.deleteForumTopic(bossTopicId, { chatId: bossChatId }).catch((e) => console.warn("[telegram] delete: boss topic cleanup error:", e.message));
        }
      }
    })().catch(() => {});
    return;
  }

  if (request.method === "GET" && pathname === "/api/managers") {
    const managersRaw = await getManagers();
    // Join: сначала по userId (жёсткая привязка), затем fallback по name === fullName.
    const allUsers = await users.listUsers();
    const userById = new Map();
    const userByFullName = new Map();
    for (const u of allUsers) {
      userById.set(u.id, u);
      const key = String(u.fullName || "").trim().toLowerCase();
      if (key) {
        userByFullName.set(key, u);
      }
    }
    const enriched = managersRaw.map((manager) => {
      const linkedById = manager.userId ? userById.get(manager.userId) : null;
      const linkedByName = !linkedById ? userByFullName.get(String(manager.name || "").trim().toLowerCase()) : null;
      const linked = linkedById || linkedByName;
      return {
        ...manager,
        role: linked?.role || "",
        userLogin: linked?.login || "",
        userFullName: linked?.fullName || ""
      };
    });
    const managers = scope ? filterByManager(enriched, scope, (manager) => manager.name) : enriched;
    sendJson(response, 200, { managers });
    return;
  }

  if (request.method === "POST" && pathname === "/api/managers") {
    requireRole(request, ["admin"]);
    const payload = await readBody(request);
    sendJson(response, 201, { manager: await createManager(payload) });
    return;
  }

  const managerMatch = pathname.match(/^\/api\/managers\/([^/]+)$/);
  if (request.method === "DELETE" && managerMatch) {
    requireRole(request, ["admin"]);
    const manager = await deleteManager(decodeURIComponent(managerMatch[1]));
    if (!manager) {
      sendJson(response, 404, { error: "Manager not found" });
      return;
    }
    sendJson(response, 200, { manager });
    return;
  }

  if (request.method === "PATCH" && managerMatch) {
    requireRole(request, ["admin"]);
    const managerId = decodeURIComponent(managerMatch[1]);
    const payload = await readBody(request);
    const patch = {};
    if (payload.userId !== undefined) {
      patch.userId = String(payload.userId || "");
    }
    if (payload.name !== undefined) {
      patch.name = String(payload.name || "");
    }
    const updated = await updateManager(managerId, patch);
    if (!updated) {
      sendJson(response, 404, { error: "Manager not found" });
      return;
    }
    sendJson(response, 200, { manager: updated });
    return;
  }

  if (request.method === "GET" && pathname === "/api/knowledge") {
    sendJson(response, 200, { knowledge: await getKnowledge() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/knowledge") {
    requireRole(request, ["admin", "analyst_abram"]);
    const payload = await readBody(request);
    sendJson(response, 201, { entry: await createKnowledgeEntry(payload) });
    return;
  }

  if (request.method === "GET" && pathname === "/api/tasks") {
    const tasks = filterByManager(await getTasks(), scope, (task) => task.manager);
    sendJson(response, 200, { tasks });
    return;
  }

  if (request.method === "POST" && pathname === "/api/tasks") {
    const payload = await readBody(request);
    ensurePartnerOwnsManager(request, payload.manager);
    const task = await createTask(payload);
    sendJson(response, 201, { task });
    // Уведомление аналитику в личку (fire-and-forget). Резолвим chatId
    // по manager → users (как в утренних пингах). Если привязки нет — тихо
    // пропускаем, основной поток не страдает.
    (async () => {
      // Тишина по выходным — задачи ставятся, но пинги приходят в понедельник
      // (аналитик всё равно увидит их на карточке при следующем визите).
      if (isMoscowWeekendNow()) return;
      try {
        const chatId = await resolveAnalystChatId(task.manager);
        if (!chatId) return;
        await telegram.notifyAnalystNewTask({
          chatId,
          clientName: task.client,
          title: task.title,
          dueAt: task.dueAt,
          actor: request.user
        });
      } catch (e) {
        console.warn("[task] notify error:", e.message);
      }
    })().catch(() => {});
    return;
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (request.method === "PATCH" && taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    const payload = await readBody(request);
    if (scope) {
      const existing = (await getTasks()).find((task) => task.id === taskId);
      if (!existing) {
        sendJson(response, 404, { error: "Task not found" });
        return;
      }
      ensurePartnerOwnsManager(request, existing.manager);
      if (payload.manager !== undefined) {
        ensurePartnerOwnsManager(request, payload.manager);
      }
    }
    const task = await updateTask(taskId, payload);
    if (!task) {
      sendJson(response, 404, { error: "Task not found" });
      return;
    }
    sendJson(response, 200, { task });
    return;
  }

  if (request.method === "DELETE" && taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    if (scope) {
      const existing = (await getTasks()).find((task) => task.id === taskId);
      if (!existing) {
        sendJson(response, 404, { error: "Task not found" });
        return;
      }
      ensurePartnerOwnsManager(request, existing.manager);
    }
    const task = await deleteTask(taskId);
    if (!task) {
      sendJson(response, 404, { error: "Task not found" });
      return;
    }
    sendJson(response, 200, { task });
    return;
  }

  const knowledgeProgramMatch = pathname.match(/^\/api\/knowledge\/programs\/([^/]+)$/);
  if (request.method === "PATCH" && knowledgeProgramMatch) {
    requireRole(request, ["admin", "analyst_abram"]);
    const payload = await readBody(request);
    const entry = await updateKnowledgeProgram(decodeURIComponent(knowledgeProgramMatch[1]), payload);
    if (!entry) {
      sendJson(response, 404, { error: "Knowledge program not found" });
      return;
    }
    sendJson(response, 200, { entry });
    return;
  }

  if (request.method === "GET" && pathname === "/api/users") {
    requireRole(request, ["admin"]);
    const items = await users.listUsers();
    sendJson(response, 200, { users: items.map(users.publicUser) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/users") {
    requireRole(request, ["admin"]);
    const payload = await readBody(request);
    try {
      const created = await users.createUser({
        login: payload.login,
        password: payload.password,
        fullName: payload.fullName,
        role: payload.role,
        telegramChatId: payload.telegramChatId
      });
      // Авто-создаём manager для ролей-аналитиков (admin/analyst_abram/partner), если такого ещё нет.
      // Если manager с таким именем уже есть — сразу привязываем его к учётке через userId.
      if (created && (created.role === "admin" || created.role === "partner" || created.role === "analyst_abram") && created.fullName) {
        const existingManagers = await getManagers();
        const fullNameKey = created.fullName.trim().toLowerCase();
        const existing = existingManagers.find((m) => String(m.name || "").trim().toLowerCase() === fullNameKey);
        if (existing) {
          if (!existing.userId) {
            try {
              await updateManager(existing.id, { userId: created.id });
            } catch {
              // если не удалось привязать — пусть админ сделает руками
            }
          }
        } else {
          try {
            await createManager({ name: created.fullName, userId: created.id });
          } catch {
            // конфликт по имени или ошибка валидации — игнорируем; админ может создать вручную
          }
        }
      }
      sendJson(response, 201, { user: created });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (request.method === "PATCH" && userMatch) {
    requireRole(request, ["admin"]);
    const userId = decodeURIComponent(userMatch[1]);
    const payload = await readBody(request);
    try {
      const updated = await users.updateUser(userId, {
        fullName: payload.fullName,
        role: payload.role,
        password: payload.password,
        telegramChatId: payload.telegramChatId
      });
      if (!updated) {
        sendJson(response, 404, { error: "User not found" });
        return;
      }
      sendJson(response, 200, { user: updated });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "DELETE" && userMatch) {
    requireRole(request, ["admin"]);
    const userId = decodeURIComponent(userMatch[1]);
    if (request.user?.id === userId) {
      sendJson(response, 400, { error: "Нельзя удалить собственную учётную запись" });
      return;
    }
    const removed = await users.deleteUser(userId);
    if (!removed) {
      sendJson(response, 404, { error: "User not found" });
      return;
    }
    sendJson(response, 200, { user: removed });
    return;
  }

  if (request.method === "GET" && pathname === "/api/document-requests") {
    const items = filterByManager(await getDocumentRequests(), scope, (req) => req.manager);
    sendJson(response, 200, { documentRequests: items });
    return;
  }

  if (request.method === "POST" && pathname === "/api/document-requests") {
    if (request.user.role === "documents_officer") {
      throw new AuthError(403, "Этой роли нельзя создавать запросы");
    }
    const payload = await readBody(request);
    if (scope) {
      const dealId = String(payload.dealId || "");
      const deal = (await getDeals()).find((item) => item.id === dealId);
      if (!deal) {
        sendJson(response, 404, { error: "Заявка не найдена" });
        return;
      }
      ensurePartnerOwnsManager(request, deal.manager);
    }
    try {
      const req = await createDocumentRequest(payload, { author: request.user });
      sendJson(response, 201, { documentRequest: req });
      // Telegram-уведомление о новом запросе в топик клиента (fire-and-forget).
      // Сохраняем message_id, чтобы потом удалить сообщение при fulfillment.
      (async () => {
        const topicId = await resolveClientTopicId(req.clientName, req.manager);
        const amounts = await resolveDealAmountsForDocRequest(req);
        const res = await telegram.notifyDocRequestCreated(req, { topicId, ...amounts });
        const messageId = res?.result?.message_id;
        if (messageId) {
          try {
            await setDocumentRequestOpenMessageId(req.id, messageId);
          } catch (e) {
            console.warn("[telegram] save openMessageId failed:", e.message);
          }
        }
      })().catch((e) => console.warn("[telegram] notifyCreated dispatch:", e.message));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  // POST /api/document-requests/resend — переотправить все активные запросы в TG
  // (полезно после настройки топиков, или если кто-то пропустил/удалил уведомление).
  if (request.method === "POST" && pathname === "/api/document-requests/resend") {
    requireRole(request, ["admin", "documents_officer"]);
    const trace = `resend-${Date.now().toString(36)}`;
    try {
      const results = await performResendActiveRequests({ actor: request.user, trace });
      sendJson(response, 200, results);
    } catch (error) {
      console.error(`[${trace}] FATAL:`, error.message);
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  // POST /api/document-requests/:id/attachments — multipart upload файлов в Drive
  const docRequestAttachUploadMatch = pathname.match(/^\/api\/document-requests\/([^/]+)\/attachments$/);
  if (request.method === "POST" && docRequestAttachUploadMatch) {
    const traceId = `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const log = (...args) => console.log(`[${traceId}]`, ...args);
    log("START", { path: pathname, ct: request.headers["content-type"], cl: request.headers["content-length"] });
    try {
      requireRole(request, ["admin", "documents_officer"]);
      const reqId = decodeURIComponent(docRequestAttachUploadMatch[1]);
      log("reqId=", reqId, "user=", request.user.login);
      const existing = (await getDocumentRequests()).find((item) => item.id === reqId);
      if (!existing) {
        sendJson(response, 404, { error: "Document request not found" });
        return;
      }
      if (existing.status === "delivered") {
        sendJson(response, 400, { error: "Запрос уже закрыт, файлы прикреплять нельзя" });
        return;
      }
      // Резолвим папку клиента на Drive: сначала existing.driveUrl (заснапшоченный), потом текущий client.driveUrl
      let rootDriveUrl = existing.driveUrl || "";
      if (!rootDriveUrl) {
        const clients = await getClients();
        const cli = clients.find((c) =>
          String(c.name || "").trim().toLowerCase() === String(existing.clientName || "").trim().toLowerCase() &&
          String(c.manager || "").trim().toLowerCase() === String(existing.manager || "").trim().toLowerCase()
        );
        rootDriveUrl = cli?.driveUrl || "";
      }
      log("rootDriveUrl=", rootDriveUrl);
      let rootFolderId = googleDrive.extractFolderIdFromUrl(rootDriveUrl);
      // Fallback для клиентов без driveUrl (например, у партнёрского контура часто нет своей папки).
      // Берём env GOOGLE_DRIVE_FALLBACK_FOLDER_ID если задан, иначе корень аккаунта ("root").
      if (!rootFolderId) {
        const fallbackId = String(process.env.GOOGLE_DRIVE_FALLBACK_FOLDER_ID || "").trim();
        rootFolderId = fallbackId || "root";
        log(`no client driveUrl → fallback parent=${rootFolderId}`);
      }
      log("rootFolderId=", rootFolderId);
      const driveStatus = await googleDrive.getStatus();
      log("driveStatus.connected=", driveStatus.connected, "configured=", driveStatus.configured);
      if (!driveStatus.connected) {
        sendJson(response, 400, { error: "Google Drive не подключён. Подключите в Настройки → Интеграции." });
        return;
      }
      // Для "root" доступ всегда есть, остальные парентов проверяем.
      const hasAccess = rootFolderId === "root"
        ? true
        : await googleDrive.checkParentAccess(rootFolderId).catch((e) => { log("checkParentAccess error:", e.message); return false; });
      log("hasAccess=", hasAccess);
      if (!hasAccess) {
        sendJson(response, 400, { error: "Подключённый Google-аккаунт не имеет доступа к папке клиента (нужны права редактора)" });
        return;
      }
      // ensureFolder: «3. ПОДАЧИ (…)» / <банк>. Старая папка «5. ПОДАЧИ»
      // у существующих клиентов останется на Drive нетронутой — новые
      // загрузки пойдут в новую.
      const SUBMISSIONS_FOLDER = "3. ПОДАЧИ (ПО БАНКАМ - отправленные анкеты, заявления, выписки, бухгалтерия и проч.)";
      let submissionsFolder;
      let bankFolder;
      try {
        submissionsFolder = await googleDrive.ensureFolder(SUBMISSIONS_FOLDER, rootFolderId);
        log("submissionsFolder=", submissionsFolder?.id);
        const bankName = existing.bank || "БЕЗ_БАНКА";
        bankFolder = await googleDrive.ensureFolder(bankName, submissionsFolder.id);
        log("bankFolder=", bankFolder?.id, "name=", bankName);
      } catch (error) {
        log("ensureFolder error:", error.message);
        sendJson(response, 500, { error: `Не удалось создать папку на Drive: ${error.message}` });
        return;
      }
      // Принимаем multipart, для каждого file event — стримим в Drive в bankFolder с префиксом времени.
      const uploaded = [];
      const errors = [];
      const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB лимит Telegram
      log("multipart parse start");
      await new Promise((resolve) => {
        let bb;
        try {
          bb = Busboy({
            headers: request.headers,
            limits: { fileSize: MAX_FILE_BYTES, files: 20 },
            // По умолчанию busboy декодирует параметры (включая filename) как latin1.
            // Браузеры шлют кириллицу как utf8 без явной перекодировки → ломается.
            defParamCharset: "utf8"
          });
        } catch (e) {
          log("Busboy ctor error:", e.message);
          errors.push({ fileName: "(busboy)", error: e.message });
          resolve();
          return;
        }
        const pending = [];
        let fileCount = 0;
        bb.on("file", (_name, fileStream, info) => {
          fileCount += 1;
          // Дополнительный фолбэк: если defParamCharset не сработал
          // (старая версия busboy), перекодируем latin1 → utf8.
          let originalName = info.filename || "file";
          if (originalName && /[À-ÿ]/.test(originalName) && !/[А-Яа-яЁё]/.test(originalName)) {
            try {
              originalName = Buffer.from(originalName, "latin1").toString("utf8");
            } catch { /* keep original */ }
          }
          const mimeType = info.mimeType || "application/octet-stream";
          log(`file event #${fileCount}:`, originalName, mimeType);
          const now = new Date();
          const pad = (n) => String(n).padStart(2, "0");
          const prefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
          const finalName = `${prefix}__${originalName}`;
          // Собираем файл в Buffer (макс. 50 МБ) и только потом грузим в Drive.
          // Стримить busboy → googleapis напрямую ловит баг ERR_STREAM_PUSH_AFTER_EOF.
          const chunks = [];
          let totalBytes = 0;
          let truncated = false;
          fileStream.on("data", (chunk) => {
            if (truncated) return;
            totalBytes += chunk.length;
            chunks.push(chunk);
          });
          fileStream.on("limit", () => { truncated = true; log(`file ${originalName} hit size limit`); });
          fileStream.on("error", (e) => { log(`file stream error ${originalName}:`, e.message); });
          const uploadPromise = new Promise((resolveFile) => {
            fileStream.on("end", async () => {
              log(`file ${originalName} read: ${totalBytes} bytes, truncated=${truncated}`);
              if (truncated) {
                errors.push({ fileName: originalName, error: `Файл больше ${MAX_FILE_BYTES / 1024 / 1024} MB` });
                resolveFile();
                return;
              }
              const buffer = Buffer.concat(chunks, totalBytes);
              try {
                const driveFile = await googleDrive.uploadBuffer({
                  fileName: finalName,
                  parentId: bankFolder.id,
                  buffer,
                  mimeType
                });
                log(`uploaded to Drive:`, originalName, "→", driveFile.id);
                const att = {
                  fileName: finalName,
                  mimeType,
                  size: Number(driveFile.size) || totalBytes,
                  driveFileId: driveFile.id,
                  driveLink: driveFile.webViewLink || "",
                  uploadedAt: new Date().toISOString(),
                  uploadedBy: request.user.fullName || "",
                  uploadedByLogin: request.user.login || ""
                };
                try {
                  const addRes = await addDocumentRequestAttachment(reqId, att);
                  if (addRes?.duplicate) {
                    log(`addAttachment skipped duplicate: ${originalName}`);
                    errors.push({ fileName: originalName, error: "Дубликат: такой файл уже прикреплён" });
                    // Чистим только что загруженный дубль в Drive, чтобы не плодить копии.
                    await googleDrive.deleteFile(driveFile.id).catch(() => null);
                  } else {
                    uploaded.push({ ...att, originalName });
                  }
                } catch (e) {
                  log(`addAttachment error ${originalName}:`, e.message);
                  errors.push({ fileName: originalName, error: e.message });
                  await googleDrive.deleteFile(driveFile.id).catch(() => null);
                }
              } catch (error) {
                log(`uploadBuffer error ${originalName}:`, error.message, error.code || "", error.errors ? JSON.stringify(error.errors) : "");
                errors.push({ fileName: originalName, error: error.message });
              }
              resolveFile();
            });
          });
          pending.push(uploadPromise);
        });
        bb.on("close", async () => {
          log("bb close, awaiting", pending.length, "uploads");
          await Promise.all(pending);
          log("all uploads settled");
          resolve();
        });
        bb.on("error", (error) => {
          log("bb error:", error.message);
          errors.push({ fileName: "(multipart)", error: error.message });
          resolve();
        });
        request.on("aborted", () => log("request aborted by client"));
        request.on("error", (e) => log("request error:", e.message));
        request.pipe(bb);
      });
      const fresh = (await getDocumentRequests()).find((item) => item.id === reqId);
      log("DONE uploaded=", uploaded.length, "errors=", errors.length);
      sendJson(response, 200, { documentRequest: fresh, uploaded, errors });
      // Уведомление-индикатор в топик клиента: «📎 К запросу добавлено N, всего M».
      // Только если был хотя бы один успешный файл и статус ещё не closed.
      if (uploaded.length > 0 && fresh && fresh.status !== "delivered") {
        (async () => {
          try {
            const topicId = await resolveClientTopicId(fresh.clientName, fresh.manager);
            const uploadedNames = uploaded.map((u) => u.originalName || u.fileName).filter(Boolean);
            const totalCount = Array.isArray(fresh.attachments) ? fresh.attachments.length : 0;
            const amounts = await resolveDealAmountsForDocRequest(fresh);
            const sent = await telegram.notifyDocRequestPartialUpload(fresh, {
              topicId,
              uploadedNames,
              totalCount,
              actor: request.user,
              ...amounts
            });
            // Сохраняем message_id, чтобы при /fulfill удалить все промежуточные
            // индикаторы частичной подгрузки из топика клиента.
            const messageId = sent?.result?.message_id;
            if (messageId) {
              try {
                await addDocumentRequestPartialUploadMessageId(fresh.id, messageId);
              } catch (e) {
                log("save partial messageId failed:", e.message);
              }
            }
          } catch (e) {
            log("partial upload notify error:", e.message);
          }
        })().catch((e) => log("partial upload notify dispatch:", e.message));
      }
      return;
    } catch (error) {
      console.error(`[${traceId}] FATAL:`, error.stack || error.message);
      if (!response.headersSent) {
        sendJson(response, 500, { error: `Upload error [${traceId}]: ${error.message}` });
      }
      return;
    }
  }

  // DELETE /api/document-requests/:id/attachments/:attId — удаление файла с Drive и из запроса
  const docRequestAttachDeleteMatch = pathname.match(/^\/api\/document-requests\/([^/]+)\/attachments\/([^/]+)$/);
  if (request.method === "DELETE" && docRequestAttachDeleteMatch) {
    requireRole(request, ["admin", "documents_officer"]);
    const reqId = decodeURIComponent(docRequestAttachDeleteMatch[1]);
    const attId = decodeURIComponent(docRequestAttachDeleteMatch[2]);
    const existing = (await getDocumentRequests()).find((item) => item.id === reqId);
    if (!existing) {
      sendJson(response, 404, { error: "Document request not found" });
      return;
    }
    if (existing.status === "delivered") {
      sendJson(response, 400, { error: "Запрос уже закрыт" });
      return;
    }
    const { request: updated, attachment } = await removeDocumentRequestAttachment(reqId, attId);
    if (!attachment) {
      sendJson(response, 404, { error: "Attachment not found" });
      return;
    }
    if (attachment.driveFileId) {
      googleDrive.deleteFile(attachment.driveFileId).catch((error) => {
        console.warn("[gdrive] failed to delete file from Drive:", error.message);
      });
    }
    sendJson(response, 200, { documentRequest: updated, attachment });
    return;
  }

  const documentRequestFulfillMatch = pathname.match(/^\/api\/document-requests\/([^/]+)\/fulfill$/);
  if (request.method === "PATCH" && documentRequestFulfillMatch) {
    const ftrace = `fulfill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const flog = (...args) => console.log(`[${ftrace}]`, ...args);
    try {
      requireRole(request, ["admin", "documents_officer"]);
      const reqId = decodeURIComponent(documentRequestFulfillMatch[1]);
      flog("START reqId=", reqId, "user=", request.user.login);
      const existing = (await getDocumentRequests()).find((item) => item.id === reqId);
      if (!existing) {
        sendJson(response, 404, { error: "Document request not found" });
        return;
      }
      const attachments = Array.isArray(existing.attachments) ? existing.attachments.filter((a) => a.driveFileId) : [];
      flog("attachments=", attachments.length, "manager=", existing.manager);
      if (!attachments.length) {
        sendJson(response, 400, { error: "Прикрепите хотя бы один файл перед отправкой пакета" });
        return;
      }
      const driveStatus = await googleDrive.getStatus();
      if (!driveStatus.connected) {
        sendJson(response, 400, { error: "Google Drive не подключён. Подключите в Настройки → Интеграции." });
        return;
      }
      // Резолвим Telegram chat_id владельца-аналитика (для личного канала).
      let recipientChatId = "";
      let linkedUserLogin = "";
      try {
        if (existing.manager) {
          const managers = await getManagers();
          const nameKey = String(existing.manager).trim().toLowerCase();
          const manager = managers.find((m) => String(m.name || "").trim().toLowerCase() === nameKey);
          flog("manager match by name:", manager ? `id=${manager.id} userId=${manager.userId || "-"}` : "none");
          if (manager) {
            const allUsers = await users.listUsers();
            const linked = (manager.userId && allUsers.find((u) => u.id === manager.userId))
              || allUsers.find((u) => String(u.fullName || "").trim().toLowerCase() === nameKey);
            flog("user link:", linked ? `login=${linked.login} hasChatId=${Boolean(linked.telegramChatId)}` : "none");
            recipientChatId = linked?.telegramChatId || "";
            linkedUserLogin = linked?.login || "";
          }
        }
      } catch (e) {
        flog("resolve recipientChatId error:", e.message);
      }
      flog("recipientChatId=", recipientChatId || "(empty → общий чат)", "linkedUser=", linkedUserLogin || "-");

      // КАЧАЕМ файлы из Drive ДО смены статуса — иначе если кто-то удалит
      // attachment между «fulfillDocumentRequest» и «getFileBuffer», статус
      // переедет в fulfilled, а часть файлов не попадёт аналитику.
      flog("downloading", attachments.length, "files from Drive (pre-status-flip)");
      const sources = [];
      for (const att of attachments) {
        try {
          const buffer = await googleDrive.getFileBuffer(att.driveFileId);
          flog(`downloaded ${att.fileName}: ${buffer.length} bytes`);
          sources.push({
            fileName: att.fileName || "document",
            mimeType: att.mimeType || "application/octet-stream",
            buffer
          });
        } catch (error) {
          flog(`download error ${att.fileName}:`, error.message);
        }
      }
      if (!sources.length) {
        sendJson(response, 500, { error: "Не удалось скачать ни один файл с Drive — пакет не отправлен" });
        return;
      }

      // Меняем статус. Guard в fulfillDocumentRequest вернёт INVALID_STATE
      // если кто-то параллельно уже перевёл запрос в fulfilled/delivered.
      let updated;
      try {
        updated = await fulfillDocumentRequest(reqId, { actor: request.user });
      } catch (error) {
        if (error?.code === "INVALID_STATE") {
          sendJson(response, 409, { error: error.message });
          return;
        }
        throw error;
      }
      if (!updated) {
        sendJson(response, 404, { error: "Document request not found" });
        return;
      }
      sendJson(response, 200, { documentRequest: updated });

      // Отправка пакета в Telegram — fire-and-forget, файлы уже в Buffer.
      (async () => {
        try {
          const topicId = await resolveClientTopicId(updated.clientName, updated.manager);
          const amounts = await resolveDealAmountsForDocRequest(updated);
          flog("calling notifyDocRequestFulfilled with", sources.length, "files, chat=", recipientChatId || "common", "topic=", topicId || "(none)");
          const result = await telegram.notifyDocRequestFulfilled(updated, { actor: request.user, recipientChatId, attachmentSources: sources, topicId, ...amounts });
          flog("TG result:", JSON.stringify(result?.ok !== undefined ? { ok: result.ok, count: result.results?.length } : result));
          // Удаляем исходное сообщение «📥 Новый запрос документов» из топика —
          // запрос закрыт, в топике остаётся только пакет файлов + якорное сообщение.
          if (existing.openMessageId) {
            const ok = await telegram.deleteMessage({ messageId: existing.openMessageId });
            flog("openMessage deleted:", ok, "id=", existing.openMessageId);
            if (ok) {
              try { await setDocumentRequestOpenMessageId(updated.id, ""); } catch {}
            }
          }
          // Удаляем все промежуточные «📎 К запросу добавлено N» — они становятся
          // неактуальны: финальный пакет уже отправлен в топик.
          const partialIds = Array.isArray(existing.partialUploadMessageIds) ? existing.partialUploadMessageIds : [];
          if (partialIds.length) {
            let deleted = 0;
            for (const mid of partialIds) {
              try {
                const ok = await telegram.deleteMessage({ messageId: mid });
                if (ok) deleted += 1;
              } catch (e) {
                flog("delete partial message error:", mid, e.message);
              }
            }
            flog(`partial messages cleaned: ${deleted}/${partialIds.length}`);
            try { await clearDocumentRequestPartialUploadMessageIds(updated.id); } catch {}
          }
        } catch (error) {
          flog("TG notify error:", error.message, error.stack);
        }
      })().catch((error) => flog("TG dispatch error:", error.message));
      return;
    } catch (error) {
      console.error(`[${ftrace}] FATAL:`, error.stack || error.message);
      if (!response.headersSent) {
        sendJson(response, 500, { error: `Fulfill error [${ftrace}]: ${error.message}` });
      }
      return;
    }
  }

  const documentRequestConfirmMatch = pathname.match(/^\/api\/document-requests\/([^/]+)\/confirm$/);
  if (request.method === "PATCH" && documentRequestConfirmMatch) {
    if (request.user.role === "documents_officer") {
      throw new AuthError(403, "Подтверждать может только аналитик-владелец или администратор");
    }
    const reqId = decodeURIComponent(documentRequestConfirmMatch[1]);
    const existing = (await getDocumentRequests()).find((item) => item.id === reqId);
    if (!existing) {
      sendJson(response, 404, { error: "Document request not found" });
      return;
    }
    if (existing.status !== "fulfilled") {
      sendJson(response, 400, { error: "Можно подтверждать только запросы со статусом «Документы загружены»" });
      return;
    }
    if (scope) {
      ensurePartnerOwnsManager(request, existing.manager);
    } else if (request.user.role === "analyst_abram") {
      // analyst_abram может подтверждать только свои
      const ownerScope = String(existing.manager || "").trim().toLowerCase();
      const me = String(request.user.fullName || "").trim().toLowerCase();
      if (ownerScope && me && ownerScope !== me) {
        throw new AuthError(403, "Можно подтверждать только свои запросы");
      }
    }
    const updated = await confirmDocumentRequest(reqId, { actor: request.user });
    if (!updated) {
      sendJson(response, 404, { error: "Document request not found" });
      return;
    }
    sendJson(response, 200, { documentRequest: updated });
    // Telegram-уведомление о подтверждении в топик клиента (fire-and-forget).
    (async () => {
      const topicId = await resolveClientTopicId(updated.clientName, updated.manager);
      const amounts = await resolveDealAmountsForDocRequest(updated);
      await telegram.notifyDocRequestConfirmed(updated, { actor: request.user, topicId, ...amounts });
    })().catch((e) => console.warn("[telegram] notifyConfirmed dispatch:", e.message));
    return;
  }

  const documentRequestMatch = pathname.match(/^\/api\/document-requests\/([^/]+)$/);
  if (request.method === "DELETE" && documentRequestMatch) {
    const reqId = decodeURIComponent(documentRequestMatch[1]);
    const existing = (await getDocumentRequests()).find((item) => item.id === reqId);
    if (!existing) {
      sendJson(response, 404, { error: "Document request not found" });
      return;
    }
    if (scope) {
      ensurePartnerOwnsManager(request, existing.manager);
    }
    // Параллельно зачистим файлы на Drive (fire-and-forget, не блокируем удаление).
    const attsToDelete = Array.isArray(existing.attachments) ? existing.attachments.filter((a) => a.driveFileId) : [];
    if (attsToDelete.length) {
      Promise.all(attsToDelete.map((a) => googleDrive.deleteFile(a.driveFileId).catch(() => null))).catch(() => null);
    }
    const removed = await deleteDocumentRequest(reqId);
    sendJson(response, 200, { documentRequest: removed });
    return;
  }

  // ===== Google Drive integration (admin) =====

  // ===== Program types & categories taxonomy =====
  // GET доступны всем авторизованным (нужны диалогу программы БЗ).
  // CUD — admin only.

  if (request.method === "GET" && pathname === "/api/program-types") {
    sendJson(response, 200, { items: await getProgramTypes() });
    return;
  }
  if (request.method === "POST" && pathname === "/api/program-types") {
    requireRole(request, ["admin"]);
    const payload = await readBody(request);
    try {
      const item = await createProgramType(payload);
      sendJson(response, 201, { item });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }
  const programTypeMatch = pathname.match(/^\/api\/program-types\/([^/]+)$/);
  if (request.method === "PATCH" && programTypeMatch) {
    requireRole(request, ["admin"]);
    const id = decodeURIComponent(programTypeMatch[1]);
    const payload = await readBody(request);
    try {
      const item = await updateProgramType(id, payload);
      if (!item) { sendJson(response, 404, { error: "Не найдено" }); return; }
      sendJson(response, 200, { item });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }
  if (request.method === "DELETE" && programTypeMatch) {
    requireRole(request, ["admin"]);
    const id = decodeURIComponent(programTypeMatch[1]);
    const item = await deleteProgramType(id);
    if (!item) { sendJson(response, 404, { error: "Не найдено" }); return; }
    sendJson(response, 200, { item });
    return;
  }

  if (request.method === "GET" && pathname === "/api/program-categories") {
    sendJson(response, 200, { items: await getProgramCategories() });
    return;
  }
  if (request.method === "POST" && pathname === "/api/program-categories") {
    requireRole(request, ["admin"]);
    const payload = await readBody(request);
    try {
      const item = await createProgramCategory(payload);
      sendJson(response, 201, { item });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }
  const programCatMatch = pathname.match(/^\/api\/program-categories\/([^/]+)$/);
  if (request.method === "PATCH" && programCatMatch) {
    requireRole(request, ["admin"]);
    const id = decodeURIComponent(programCatMatch[1]);
    const payload = await readBody(request);
    try {
      const item = await updateProgramCategory(id, payload);
      if (!item) { sendJson(response, 404, { error: "Не найдено" }); return; }
      sendJson(response, 200, { item });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }
  if (request.method === "DELETE" && programCatMatch) {
    requireRole(request, ["admin"]);
    const id = decodeURIComponent(programCatMatch[1]);
    const item = await deleteProgramCategory(id);
    if (!item) { sendJson(response, 404, { error: "Не найдено" }); return; }
    sendJson(response, 200, { item });
    return;
  }

  if (request.method === "GET" && pathname === "/api/integrations") {
    requireRole(request, ["admin"]);
    const google = await googleDrive.getStatus();
    sendJson(response, 200, { google });
    return;
  }

  if (request.method === "GET" && pathname === "/api/integrations/google/auth-url") {
    requireRole(request, ["admin"]);
    if (!googleDrive.isConfigured()) {
      sendJson(response, 400, { error: "Google Drive не настроен: отсутствуют env GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI/OAUTH_TOKEN_ENCRYPTION_KEY" });
      return;
    }
    const state = createOAuthState(request.user.id);
    const authUrl = googleDrive.getAuthUrl(state);
    sendJson(response, 200, { url: authUrl });
    return;
  }

  if (request.method === "DELETE" && pathname === "/api/integrations/google") {
    requireRole(request, ["admin"]);
    await googleDrive.disconnect();
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "API route not found" });
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url.startsWith("/api/")) {
      await attachUser(request);
      await handleApi(request, response);
      return;
    }
    serveStatic(request, response);
  } catch (error) {
    if (error instanceof AuthError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    sendJson(response, 400, { error: error.message });
  }
});

// Safety net: ловим неперехваченные ошибки/реджекты, чтобы один сбойный
// upload или Drive-stream не валил весь процесс (контейнер потом перезапускается
// и теряет сессии, а клиент видит 502).
process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error?.stack || error?.message || error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason?.stack || reason?.message || reason);
});

// ===== Переотправка уведомлений по активным запросам документов =====

function daysSinceCreated(req) {
  const since = req.status === "fulfilled" ? (req.fulfilledAt || req.createdAt) : req.createdAt;
  if (!since) return null;
  const ms = Date.now() - new Date(since).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / (24 * 3600 * 1000));
}

async function performResendActiveRequests({ actor = null, trace = `resend-${Date.now().toString(36)}` } = {}) {
  const tlog = (...args) => console.log(`[${trace}]`, ...args);
  // Автоматический вызов (без actor) на выходных пропускаем. Ручной resend
  // администратором проходит независимо от дня недели.
  if (!actor && isMoscowWeekendNow()) {
    tlog("skip: MSK weekend");
    return { open: 0, fulfilled: 0, errors: 0, details: [], skipped: "weekend" };
  }
  const all = await getDocumentRequests();
  const active = all.filter((r) => r.status !== "delivered");
  tlog("resending", active.length, "active requests");
  const results = { open: 0, fulfilled: 0, errors: 0, details: [] };
  const managers = await getManagers();
  const allUsers = await users.listUsers();
  const driveStatus = await googleDrive.getStatus();
  for (const req of active) {
    try {
      const topicId = await resolveClientTopicId(req.clientName, req.manager);
      const processingDays = daysSinceCreated(req);
      const amounts = await resolveDealAmountsForDocRequest(req);
      if (req.status === "open") {
        // При переотправке удаляем старое уведомление и сохраняем id нового —
        // чтобы в топике не накапливались дубли запроса.
        if (req.openMessageId) {
          await telegram.deleteMessage({ messageId: req.openMessageId }).catch(() => null);
        }
        const sentRes = await telegram.notifyDocRequestCreated(req, { topicId, processingDays, ...amounts });
        const newMessageId = sentRes?.result?.message_id;
        if (newMessageId) {
          try { await setDocumentRequestOpenMessageId(req.id, newMessageId); }
          catch (e) { tlog("save openMessageId failed:", e.message); }
        }
        results.open += 1;
        results.details.push({ id: req.id, status: "open", clientName: req.clientName, processingDays, topicId });
      } else if (req.status === "fulfilled") {
        let recipientChatId = "";
        const nameKey = String(req.manager || "").trim().toLowerCase();
        const manager = managers.find((m) => String(m.name || "").trim().toLowerCase() === nameKey);
        if (manager) {
          const linked = (manager.userId && allUsers.find((u) => u.id === manager.userId))
            || allUsers.find((u) => String(u.fullName || "").trim().toLowerCase() === nameKey);
          recipientChatId = linked?.telegramChatId || "";
        }
        const attachments = Array.isArray(req.attachments) ? req.attachments.filter((a) => a.driveFileId) : [];
        const sources = [];
        if (driveStatus.connected && attachments.length) {
          for (const att of attachments) {
            try {
              const buffer = await googleDrive.getFileBuffer(att.driveFileId);
              sources.push({ fileName: att.fileName, mimeType: att.mimeType, buffer });
            } catch (e) {
              tlog(`download ${att.fileName} failed:`, e.message);
            }
          }
        }
        await telegram.notifyDocRequestFulfilled(req, { actor, recipientChatId, attachmentSources: sources, topicId, processingDays, ...amounts });
        // На всякий случай добиваем оставшиеся partial-сообщения (если первый /fulfill
        // их не удалил из-за сетевой ошибки) — переотправка пакета должна давать
        // чистый топик с одним финальным сообщением.
        const partialIds = Array.isArray(req.partialUploadMessageIds) ? req.partialUploadMessageIds : [];
        if (partialIds.length) {
          for (const mid of partialIds) {
            await telegram.deleteMessage({ messageId: mid }).catch(() => null);
          }
          try { await clearDocumentRequestPartialUploadMessageIds(req.id); } catch {}
        }
        results.fulfilled += 1;
        results.details.push({ id: req.id, status: "fulfilled", clientName: req.clientName, processingDays, topicId, files: sources.length });
      }
    } catch (e) {
      tlog("error on", req.id, e.message);
      results.errors += 1;
      results.details.push({ id: req.id, status: "error", error: e.message });
    }
  }
  tlog("DONE open=", results.open, "fulfilled=", results.fulfilled, "errors=", results.errors);
  return results;
}

// Утреннее уведомление аналитикам: для каждого аналитика с активными
// заявками собираем список (клиент → количество активных) и шлём
// в его привязанный TG-чат. CHECKABLE_STAGES активные = lead /
// documents_requested / submitted.
async function sendMorningCheckPings({ trace = `morning-${Date.now()}` } = {}) {
  const tlog = (...args) => console.log(`[${trace}]`, ...args);
  if (isMoscowWeekendNow()) {
    tlog("skip: MSK weekend");
    return { sent: 0, total: 0, skipped: "weekend" };
  }
  const allDeals = await getDeals();
  const managers = await getManagers();
  const allUsers = await users.listUsers();
  const activeKeys = await buildActiveClientKeySet();
  // Группируем активные заявки по аналитику и внутри — по клиенту.
  // Архивных/удалённых клиентов исключаем — их статусы не нужно проверять.
  const byAnalyst = new Map(); // analystName(lc) → Map<clientName, count>
  for (const d of allDeals) {
    if (!CHECKABLE_STAGES.has(d.stage)) continue;
    if (!activeKeys.has(dealClientKey(d))) continue;
    const key = String(d.manager || "").trim().toLowerCase();
    if (!key) continue;
    if (!byAnalyst.has(key)) byAnalyst.set(key, { analystName: d.manager, byClient: new Map() });
    const slot = byAnalyst.get(key);
    const cur = slot.byClient.get(d.client) || 0;
    slot.byClient.set(d.client, cur + 1);
  }
  let sent = 0;
  for (const [key, { analystName, byClient }] of byAnalyst) {
    try {
      const manager = managers.find((m) => String(m.name || "").trim().toLowerCase() === key);
      if (!manager) continue;
      const linked = (manager.userId && allUsers.find((u) => u.id === manager.userId))
        || allUsers.find((u) => String(u.fullName || "").trim().toLowerCase() === key);
      const chatId = linked?.telegramChatId || "";
      if (!chatId) {
        tlog("skip", analystName, "— no telegramChatId");
        continue;
      }
      const clientsList = [...byClient.entries()]
        .map(([clientName, count]) => ({ clientName, count }))
        .sort((a, b) => b.count - a.count || a.clientName.localeCompare(b.clientName, "ru"));
      const res = await telegram.notifyAnalystDailyCheck({ chatId, analystName, clientsList });
      if (res && res.ok !== false) sent += 1;
    } catch (e) {
      tlog("error for", analystName, e.message);
    }
  }
  return { sent, total: byAnalyst.size };
}

// ===== Ежедневный планировщик: 08:50 МСК =====
const DAILY_RESEND_HOUR_MSK = 8;
const DAILY_RESEND_MIN_MSK = 50;
let lastDailyResendDate = ""; // защита от двойного срабатывания

function moscowTimeParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const v = (type) => parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${v("year")}-${v("month")}-${v("day")}`,
    hour: Number(v("hour")),
    minute: Number(v("minute"))
  };
}

// Считает сколько миллисекунд до следующего наступления 08:50 в Europe/Moscow.
// Использует Intl для определения МСК-смещения.
function msUntilNextDailyResend() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const v = (type) => parts.find((p) => p.type === type)?.value || "";
  const mskNowMs = Date.UTC(Number(v("year")), Number(v("month")) - 1, Number(v("day")),
    Number(v("hour")), Number(v("minute")), Number(v("second")));
  const mskTargetToday = Date.UTC(Number(v("year")), Number(v("month")) - 1, Number(v("day")),
    DAILY_RESEND_HOUR_MSK, DAILY_RESEND_MIN_MSK, 0);
  let diff = mskTargetToday - mskNowMs;
  if (diff <= 0) diff += 24 * 60 * 60 * 1000; // сегодняшний слот уже прошёл — ждём завтрашний
  return diff;
}

function startDailyResendScheduler() {
  if (process.env.DISABLE_DAILY_RESEND === "1") {
    console.log("[scheduler] daily resend disabled by env DISABLE_DAILY_RESEND=1");
    return;
  }
  const scheduleNext = () => {
    const ms = msUntilNextDailyResend();
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    console.log(`[scheduler] next daily resend in ${hours}ч ${minutes}м`);
    const t = setTimeout(async () => {
      try {
        const today = moscowTimeParts().date;
        if (lastDailyResendDate !== today) {
          lastDailyResendDate = today;
          console.log(`[scheduler] daily resend trigger at ${today} 08:50 MSK`);
          const results = await performResendActiveRequests({ actor: null, trace: `daily-${today}` });
          console.log(`[scheduler] daily resend done: open=${results.open} fulfilled=${results.fulfilled} errors=${results.errors}`);
          // Утренний пинг аналитикам: список клиентов с активными заявками,
          // по которым нужно нажать «Заявка проверена» (lastCheckedAt сбросится
          // логически новым МСК-днём — кнопки сами «загорятся»).
          try {
            const morning = await sendMorningCheckPings({ trace: `morning-${today}` });
            console.log(`[scheduler] morning pings sent: ${morning.sent}/${morning.total} analysts`);
          } catch (e) {
            console.warn("[scheduler] morning pings error:", e.message);
          }
        } else {
          console.log("[scheduler] daily resend skipped (already done today)");
        }
      } catch (error) {
        console.warn("[scheduler] timer error:", error.message);
      } finally {
        scheduleNext(); // следующий слот — через ~24h
      }
    }, ms);
    t.unref();
  };
  scheduleNext();
  console.log(`[scheduler] daily resend armed for ${DAILY_RESEND_HOUR_MSK}:${String(DAILY_RESEND_MIN_MSK).padStart(2, "0")} MSK`);
}

async function start() {
  await initStore();
  await users.ensureBootstrapAdmin({ logger: console });
  // Bootstrap taxonomy: засеваем дефолтные типы/категории если коллекции пустые,
  // потом грузим актуальный список в process-кеш.
  try { await seedTaxonomyIfEmpty(); } catch (e) { console.warn("[taxonomy] seed error:", e.message); }
  try { await reloadTaxonomyCache(); } catch (e) { console.warn("[taxonomy] cache reload error:", e.message); }
  server.listen(PORT, () => {
    console.log(`Deal Monitor is running at http://localhost:${PORT}`);
  });
  startDailyResendScheduler();
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  acceptsGzip,
  buildSessionCookie,
  clearSessionCookie,
  computeEtag,
  parseCookies,
  sendCompressed,
  sendJson,
  server,
  staticCacheControl,
  start
};
