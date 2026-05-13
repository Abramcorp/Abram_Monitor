"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { calculateDashboard } = require("./src/analytics");
const { createBank, createDeal, getBanks, getDeals, updateDeal } = require("./src/store");

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
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
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
    sendJson(response, 200, calculateDashboard(getDeals()));
    return;
  }

  if (request.method === "GET" && pathname === "/api/deals") {
    sendJson(response, 200, { deals: getDeals() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/deals") {
    const payload = await readBody(request);
    sendJson(response, 201, { deal: createDeal(payload) });
    return;
  }

  const dealMatch = pathname.match(/^\/api\/deals\/([^/]+)$/);
  if (request.method === "PATCH" && dealMatch) {
    const payload = await readBody(request);
    const deal = updateDeal(decodeURIComponent(dealMatch[1]), payload);
    if (!deal) {
      sendJson(response, 404, { error: "Deal not found" });
      return;
    }
    sendJson(response, 200, { deal });
    return;
  }

  if (request.method === "GET" && pathname === "/api/banks") {
    sendJson(response, 200, { banks: getBanks() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/banks") {
    const payload = await readBody(request);
    sendJson(response, 201, { bank: createBank(payload) });
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

server.listen(PORT, () => {
  console.log(`Deal Monitor is running at http://localhost:${PORT}`);
});
