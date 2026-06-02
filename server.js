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
  addDocumentRequestAttachment,
  archiveClient,
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
  getBanks,
  getClients,
  getDeals,
  getDocumentRequests,
  getKnowledge,
  getManagers,
  getTasks,
  removeDocumentRequestAttachment,
  updateDeal,
  updateKnowledgeProgram,
  updateManager,
  updateTask,
  initStore
} = require("./src/store");
const users = require("./src/users");
const { defaultStore: sessionStore } = require("./src/sessions");
const googleDrive = require("./src/googleDrive");
const telegram = require("./src/telegram");
const { setClientTelegramTopicId } = require("./src/store");
const Busboy = require("busboy");

// Резолвит/создаёт topic-id в форум-группе для клиента.
// Возвращает строковый thread_id или "" если не удалось.
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
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function clearSessionCookie({ secure = false } = {}) {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function shouldUseSecureCookie(request) {
  if (process.env.COOKIE_SECURE === "true") {
    return true;
  }
  if (process.env.COOKIE_SECURE === "false") {
    return false;
  }
  const forwardedProto = request?.headers?.["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.split(",")[0].trim() === "https") {
    return true;
  }
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
  const token = readBearerToken(request) || cookies[SESSION_COOKIE] || "";
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
    // Возвращаем токен и в Set-Cookie (HttpOnly), и в JSON-теле:
    // фронт хранит копию в localStorage и отправляет её как Bearer-фолбэк
    // на случай если cookie теряются за прокси/настройками браузера.
    sendJson(
      response,
      200,
      { user: users.publicUser(user), token: session.token, expiresAt: session.expiresAt },
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

  // documents_officer имеет доступ только к запросам документов.
  if (request.user.role === "documents_officer" && !pathname.startsWith("/api/document-requests")) {
    throw new AuthError(403, "Доступ только к запросам документов");
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
    if (scope) {
      const existing = (await getDeals()).find((deal) => deal.id === dealId);
      if (!existing) {
        sendJson(response, 404, { error: "Deal not found" });
        return;
      }
      ensurePartnerOwnsManager(request, existing.manager);
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
    sendJson(response, 201, { client: await createClient(payload) });
    return;
  }

  const clientArchiveMatch = pathname.match(/^\/api\/clients\/([^/]+)\/archive$/);
  if (request.method === "PATCH" && clientArchiveMatch) {
    const clientId = decodeURIComponent(clientArchiveMatch[1]);
    if (scope) {
      const existing = (await getClients()).find((client) => client.id === clientId);
      if (!existing) {
        sendJson(response, 404, { error: "Client not found" });
        return;
      }
      ensurePartnerOwnsManager(request, existing.manager);
    }
    const client = await archiveClient(clientId);
    if (!client) {
      sendJson(response, 404, { error: "Client not found" });
      return;
    }
    sendJson(response, 200, { client });
    return;
  }

  const clientMatch = pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (request.method === "DELETE" && clientMatch) {
    const clientId = decodeURIComponent(clientMatch[1]);
    if (scope) {
      const existing = (await getClients()).find((client) => client.id === clientId);
      if (!existing) {
        sendJson(response, 404, { error: "Client not found" });
        return;
      }
      ensurePartnerOwnsManager(request, existing.manager);
    }
    const client = await deleteClient(clientId);
    if (!client) {
      sendJson(response, 404, { error: "Client not found" });
      return;
    }
    sendJson(response, 200, { client });
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
    sendJson(response, 201, { task: await createTask(payload) });
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
      (async () => {
        const topicId = await resolveClientTopicId(req.clientName, req.manager);
        await telegram.notifyDocRequestCreated(req, { topicId });
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
    const tlog = (...args) => console.log(`[${trace}]`, ...args);
    try {
      const all = await getDocumentRequests();
      const active = all.filter((r) => r.status !== "delivered");
      tlog("resending", active.length, "active requests");
      const results = { open: 0, fulfilled: 0, errors: 0, details: [] };
      // Резолвим users 1 раз для производительности.
      const managers = await getManagers();
      const allUsers = await users.listUsers();
      // Параллельно — но осторожно: createForumTopic не любит большие batch.
      // Делаем последовательно, чтобы не словить flood-limit Telegram.
      for (const req of active) {
        try {
          const topicId = await resolveClientTopicId(req.clientName, req.manager);
          if (req.status === "open") {
            await telegram.notifyDocRequestCreated(req, { topicId });
            results.open += 1;
            results.details.push({ id: req.id, status: "open", clientName: req.clientName, topicId });
          } else if (req.status === "fulfilled") {
            // chatId аналитика
            let recipientChatId = "";
            const nameKey = String(req.manager || "").trim().toLowerCase();
            const manager = managers.find((m) => String(m.name || "").trim().toLowerCase() === nameKey);
            if (manager) {
              const linked = (manager.userId && allUsers.find((u) => u.id === manager.userId))
                || allUsers.find((u) => String(u.fullName || "").trim().toLowerCase() === nameKey);
              recipientChatId = linked?.telegramChatId || "";
            }
            // Файлы из Drive (если есть и Drive подключён).
            const attachments = Array.isArray(req.attachments) ? req.attachments.filter((a) => a.driveFileId) : [];
            const sources = [];
            const driveStatus = await googleDrive.getStatus();
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
            await telegram.notifyDocRequestFulfilled(req, { actor: request.user, recipientChatId, attachmentSources: sources, topicId });
            results.fulfilled += 1;
            results.details.push({ id: req.id, status: "fulfilled", clientName: req.clientName, topicId, files: sources.length });
          }
        } catch (e) {
          tlog("error on", req.id, e.message);
          results.errors += 1;
          results.details.push({ id: req.id, status: "error", error: e.message });
        }
      }
      tlog("DONE open=", results.open, "fulfilled=", results.fulfilled, "errors=", results.errors);
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
      const rootFolderId = googleDrive.extractFolderIdFromUrl(rootDriveUrl);
      if (!rootFolderId) {
        sendJson(response, 400, { error: "У клиента не указана ссылка на папку Google Drive (driveUrl)" });
        return;
      }
      log("rootFolderId=", rootFolderId);
      const driveStatus = await googleDrive.getStatus();
      log("driveStatus.connected=", driveStatus.connected, "configured=", driveStatus.configured);
      if (!driveStatus.connected) {
        sendJson(response, 400, { error: "Google Drive не подключён. Подключите в Настройки → Интеграции." });
        return;
      }
      const hasAccess = await googleDrive.checkParentAccess(rootFolderId).catch((e) => { log("checkParentAccess error:", e.message); return false; });
      log("hasAccess=", hasAccess);
      if (!hasAccess) {
        sendJson(response, 400, { error: "Подключённый Google-аккаунт не имеет доступа к папке клиента (нужны права редактора)" });
        return;
      }
      // ensureFolder: 5. ПОДАЧИ / <банк>
      let submissionsFolder;
      let bankFolder;
      try {
        submissionsFolder = await googleDrive.ensureFolder("5. ПОДАЧИ", rootFolderId);
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
            limits: { fileSize: MAX_FILE_BYTES, files: 20 }
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
          const originalName = info.filename || "file";
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
                  await addDocumentRequestAttachment(reqId, att);
                  uploaded.push({ ...att, originalName });
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
      const updated = await fulfillDocumentRequest(reqId, { actor: request.user });
      if (!updated) {
        sendJson(response, 404, { error: "Document request not found" });
        return;
      }
      sendJson(response, 200, { documentRequest: updated });
      // Отправка пакета в Telegram — fire-and-forget, файлы качаем в Buffer.
      (async () => {
        flog("TG dispatch start: downloading", attachments.length, "files from Drive");
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
          flog("no sources to send to TG");
          return;
        }
        try {
          const topicId = await resolveClientTopicId(updated.clientName, updated.manager);
          flog("calling notifyDocRequestFulfilled with", sources.length, "files, chat=", recipientChatId || "common", "topic=", topicId || "(none)");
          const result = await telegram.notifyDocRequestFulfilled(updated, { actor: request.user, recipientChatId, attachmentSources: sources, topicId });
          flog("TG result:", JSON.stringify(result?.ok !== undefined ? { ok: result.ok, count: result.results?.length } : result));
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
      await telegram.notifyDocRequestConfirmed(updated, { actor: request.user, topicId });
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

async function start() {
  await initStore();
  await users.ensureBootstrapAdmin({ logger: console });
  server.listen(PORT, () => {
    console.log(`Deal Monitor is running at http://localhost:${PORT}`);
  });
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
