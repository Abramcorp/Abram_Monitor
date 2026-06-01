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
  archiveClient,
  createBank,
  createClient,
  createDeal,
  createKnowledgeEntry,
  createManager,
  createTask,
  deleteClient,
  deleteDeal,
  deleteManager,
  deleteTask,
  getBanks,
  getClients,
  getDeals,
  getKnowledge,
  getManagers,
  getTasks,
  updateDeal,
  updateKnowledgeProgram,
  updateTask,
  initStore
} = require("./src/store");
const users = require("./src/users");
const { defaultStore: sessionStore } = require("./src/sessions");

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

  // Все остальные /api/* требуют авторизации.
  requireAuth(request);
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
    const managers = await getManagers();
    sendJson(response, 200, { managers: scope ? filterByManager(managers, scope, (manager) => manager.name) : managers });
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
