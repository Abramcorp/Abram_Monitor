"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
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
  deleteManager,
  getBanks,
  getClients,
  getDeals,
  getKnowledge,
  getManagers,
  updateDeal,
  updateKnowledgeProgram,
  initStore
} = require("./src/store");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Pragma": "no-cache"
  });
  response.end(JSON.stringify(payload));
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

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(content);
  });
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/api/dashboard") {
    const time = await getMoscowNow();
    sendJson(response, 200, calculateDashboard(await getDeals(), new Date(time.iso), time));
    return;
  }

  if (request.method === "GET" && pathname === "/api/time") {
    sendJson(response, 200, { time: await getMoscowNow() });
    return;
  }

  if (request.method === "GET" && pathname === "/api/deals") {
    sendJson(response, 200, { deals: await getDeals() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/deals") {
    const payload = await readBody(request);
    sendJson(response, 201, { deal: await createDeal(payload) });
    return;
  }

  const dealActionMatch = pathname.match(/^\/api\/deals\/([^/]+)\/actions$/);
  if (request.method === "POST" && dealActionMatch) {
    const payload = await readBody(request);
    const deal = await addDealAction(decodeURIComponent(dealActionMatch[1]), payload);
    if (!deal) {
      sendJson(response, 404, { error: "Deal not found" });
      return;
    }
    sendJson(response, 201, { deal });
    return;
  }

  const dealMatch = pathname.match(/^\/api\/deals\/([^/]+)$/);
  if (request.method === "PATCH" && dealMatch) {
    const payload = await readBody(request);
    const deal = await updateDeal(decodeURIComponent(dealMatch[1]), payload);
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
    const payload = await readBody(request);
    sendJson(response, 201, { bank: await createBank(payload) });
    return;
  }

  if (request.method === "GET" && pathname === "/api/clients") {
    sendJson(response, 200, { clients: await getClients() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/clients") {
    const payload = await readBody(request);
    sendJson(response, 201, { client: await createClient(payload) });
    return;
  }

  const clientArchiveMatch = pathname.match(/^\/api\/clients\/([^/]+)\/archive$/);
  if (request.method === "PATCH" && clientArchiveMatch) {
    const client = await archiveClient(decodeURIComponent(clientArchiveMatch[1]));
    if (!client) {
      sendJson(response, 404, { error: "Client not found" });
      return;
    }
    sendJson(response, 200, { client });
    return;
  }

  if (request.method === "GET" && pathname === "/api/managers") {
    sendJson(response, 200, { managers: await getManagers() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/managers") {
    const payload = await readBody(request);
    sendJson(response, 201, { manager: await createManager(payload) });
    return;
  }

  const managerMatch = pathname.match(/^\/api\/managers\/([^/]+)$/);
  if (request.method === "DELETE" && managerMatch) {
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
    const payload = await readBody(request);
    sendJson(response, 201, { entry: await createKnowledgeEntry(payload) });
    return;
  }

  const knowledgeProgramMatch = pathname.match(/^\/api\/knowledge\/programs\/([^/]+)$/);
  if (request.method === "PATCH" && knowledgeProgramMatch) {
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
      await handleApi(request, response);
      return;
    }
    serveStatic(request, response);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
});

async function start() {
  await initStore();
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
  sendJson,
  server,
  start
};
