"use strict";

// Google Drive интеграция: OAuth-обмен, хранение зашифрованного refresh_token,
// операции с папками/файлами клиента (ensureFolder, uploadStream, getFileStream).
//
// ENV:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  — OAuth client из Google Cloud Console (Web app)
//   GOOGLE_REDIRECT_URI                     — например https://<host>/api/google/callback
//   OAUTH_TOKEN_ENCRYPTION_KEY              — 64-символьная hex (32 байта), `openssl rand -hex 32`
//
// Токен — singleton (один общий аккаунт), хранится в коллекции "integrations"
// под id = "google_drive".

const crypto = require("node:crypto");
const { google } = require("googleapis");
const postgresStore = require("./postgresStore");

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const INTEGRATION_ID = "google_drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function getEnv(name) {
  return String(process.env[name] || "").trim();
}

const REQUIRED_ENV_VARS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "OAUTH_TOKEN_ENCRYPTION_KEY"
];

function missingEnvVars() {
  return REQUIRED_ENV_VARS.filter((name) => !getEnv(name));
}

function isConfigured() {
  return missingEnvVars().length === 0;
}

function getEncryptionKey() {
  const hex = getEnv("OAUTH_TOKEN_ENCRYPTION_KEY");
  if (!hex || hex.length !== 64) {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY должен быть 64-символьной hex-строкой (32 байта)");
  }
  return Buffer.from(hex, "hex");
}

// ===== Шифрование refresh_token =====

function encrypt(plaintext) {
  if (!plaintext) return "";
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // формат: base64(iv) "." base64(tag) "." base64(ct)
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

function decrypt(payload) {
  if (!payload) return "";
  const parts = String(payload).split(".");
  if (parts.length !== 3) return "";
  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const ct = Buffer.from(parts[2], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// ===== Хранение токена =====

async function readIntegration() {
  if (!postgresStore.isEnabled()) return null;
  const rows = await postgresStore.listRows("integrations");
  return rows.find((r) => r.id === INTEGRATION_ID) || null;
}

async function writeIntegration(data) {
  if (!postgresStore.isEnabled()) {
    throw new Error("Postgres недоступен — Google Drive интеграция требует БД");
  }
  const now = new Date().toISOString();
  const existing = await readIntegration();
  const next = {
    id: INTEGRATION_ID,
    ...existing,
    ...data,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  await postgresStore.insertRow("integrations", next); // insertRow делает ON CONFLICT DO UPDATE
  return next;
}

async function clearIntegration() {
  if (!postgresStore.isEnabled()) return;
  await postgresStore.deleteRow("integrations", INTEGRATION_ID);
}

// ===== OAuth =====

function createOAuthClient() {
  if (!isConfigured()) {
    throw new Error("Google Drive не настроен (нет env GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI/OAUTH_TOKEN_ENCRYPTION_KEY)");
  }
  return new google.auth.OAuth2(
    getEnv("GOOGLE_CLIENT_ID"),
    getEnv("GOOGLE_CLIENT_SECRET"),
    getEnv("GOOGLE_REDIRECT_URI")
  );
}

function getAuthUrl(state = "") {
  const oauth = createOAuthClient();
  return oauth.generateAuthUrl({
    access_type: "offline",     // нужен refresh_token
    prompt: "consent",          // форсируем выдачу refresh_token даже если уже выдавали раньше
    scope: SCOPES,
    state: state || ""
  });
}

async function handleOAuthCallback(code) {
  if (!code) throw new Error("OAuth: отсутствует code");
  const oauth = createOAuthClient();
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google не выдал refresh_token. Удалите доступ приложения в Google Account → Security → Third-party access и попробуйте снова.");
  }
  oauth.setCredentials(tokens);
  // узнаём email подключённого аккаунта
  let connectedEmail = "";
  try {
    const userinfo = await google.oauth2({ version: "v2", auth: oauth }).userinfo.get();
    connectedEmail = userinfo.data.email || "";
  } catch (error) {
    console.warn("[gdrive] не удалось прочитать userinfo:", error.message);
  }
  await writeIntegration({
    refreshTokenEnc: encrypt(tokens.refresh_token),
    connectedEmail,
    scope: tokens.scope || SCOPES.join(" "),
    connectedAt: new Date().toISOString()
  });
  return { connectedEmail };
}

async function getStatus() {
  const integration = await readIntegration();
  const missing = missingEnvVars();
  const redirectUri = getEnv("GOOGLE_REDIRECT_URI");
  return {
    configured: missing.length === 0,
    missingEnvs: missing,
    redirectUri: redirectUri || "",
    connected: Boolean(integration?.refreshTokenEnc),
    email: integration?.connectedEmail || "",
    connectedAt: integration?.connectedAt || ""
  };
}

async function disconnect() {
  const integration = await readIntegration();
  if (integration?.refreshTokenEnc) {
    try {
      const oauth = createOAuthClient();
      oauth.setCredentials({ refresh_token: decrypt(integration.refreshTokenEnc) });
      await oauth.revokeCredentials().catch(() => null);
    } catch {
      // ignore — токен мог уже отозваться
    }
  }
  await clearIntegration();
}

// ===== Авторизованный Drive-клиент =====

async function getAuthorizedClient() {
  const integration = await readIntegration();
  if (!integration?.refreshTokenEnc) {
    throw new Error("Google Drive не подключён. Зайдите в Настройки → Интеграции.");
  }
  const oauth = createOAuthClient();
  oauth.setCredentials({ refresh_token: decrypt(integration.refreshTokenEnc) });
  // googleapis сам обновит access_token по refresh при первом запросе
  return oauth;
}

async function getDrive() {
  const auth = await getAuthorizedClient();
  return google.drive({ version: "v3", auth });
}

// ===== Drive операции =====

// Извлекает folder ID из любой ссылки вида:
//   https://drive.google.com/drive/folders/<ID>
//   https://drive.google.com/drive/u/0/folders/<ID>?usp=sharing
//   https://drive.google.com/open?id=<ID>
// Или просто принимает ID как есть.
function extractFolderIdFromUrl(url) {
  if (!url) return "";
  const s = String(url).trim();
  // folder URL
  const folderMatch = s.match(/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  // open?id=
  const idMatch = s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  // выглядит как чистый ID (25-50 символов, base64-safe)
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return "";
}

async function findFolder(drive, name, parentId) {
  const escapedName = String(name).replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escapedName}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return res.data.files?.[0] || null;
}

async function createFolder(drive, name, parentId) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId]
    },
    fields: "id, name",
    supportsAllDrives: true
  });
  return res.data;
}

async function ensureFolder(name, parentId) {
  const drive = await getDrive();
  const existing = await findFolder(drive, name, parentId);
  if (existing) return existing;
  return createFolder(drive, name, parentId);
}

async function uploadStream({ fileName, parentId, stream, mimeType }) {
  const drive = await getDrive();
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentId]
    },
    media: {
      mimeType: mimeType || "application/octet-stream",
      body: stream
    },
    fields: "id, name, size, mimeType, webViewLink, webContentLink",
    supportsAllDrives: true
  });
  return res.data;
}

async function getFileStream(fileId) {
  const drive = await getDrive();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  return res.data;
}

async function getFileMeta(fileId) {
  const drive = await getDrive();
  const res = await drive.files.get({
    fileId,
    fields: "id, name, size, mimeType, webViewLink",
    supportsAllDrives: true
  });
  return res.data;
}

async function deleteFile(fileId) {
  const drive = await getDrive();
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
    return true;
  } catch (error) {
    // если уже удалён — считаем успехом
    if (error?.code === 404) return true;
    throw error;
  }
}

async function checkParentAccess(parentId) {
  // Возвращает true, если у сервиса есть права писать в эту папку.
  const drive = await getDrive();
  try {
    const res = await drive.files.get({
      fileId: parentId,
      fields: "id, name, capabilities(canAddChildren), trashed",
      supportsAllDrives: true
    });
    if (res.data.trashed) return false;
    return Boolean(res.data.capabilities?.canAddChildren);
  } catch {
    return false;
  }
}

module.exports = {
  isConfigured,
  missingEnvVars,
  getAuthUrl,
  handleOAuthCallback,
  getStatus,
  disconnect,
  extractFolderIdFromUrl,
  ensureFolder,
  uploadStream,
  getFileStream,
  getFileMeta,
  deleteFile,
  checkParentAccess
};
