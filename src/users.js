"use strict";

const fs = require("node:fs");
const path = require("node:path");
const postgresStore = require("./postgresStore");
const { hashPassword, verifyPassword } = require("./passwords");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const USER_ROLES = ["admin", "analyst_abram", "partner", "documents_officer"];
const USER_ROLE_SET = new Set(USER_ROLES);
// Совместимости ради экспортируем шаблон, но больше не применяем его при валидации.
const LOGIN_PATTERN = /^.+$/;

function cleanText(value) {
  return String(value ?? "").trim();
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function normalizeRole(value) {
  const text = cleanText(value).toLowerCase();
  return USER_ROLE_SET.has(text) ? text : "";
}

function normalizeLogin(value) {
  return cleanText(value).toLowerCase();
}

function normalizeUser(raw = {}) {
  const now = new Date().toISOString();
  return {
    id: cleanText(raw.id) || `user-${Date.now()}`,
    login: normalizeLogin(raw.login || raw.username),
    fullName: cleanText(raw.fullName || raw.name) || cleanText(raw.login),
    role: normalizeRole(raw.role) || "partner",
    passwordHash: cleanText(raw.passwordHash) || "",
    createdAt: cleanText(raw.createdAt) || now,
    updatedAt: cleanText(raw.updatedAt) || cleanText(raw.createdAt) || now
  };
}

function publicUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    login: user.login,
    fullName: user.fullName,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function validateLogin(login) {
  const normalized = normalizeLogin(login);
  if (!normalized) {
    throw new Error("Логин обязателен");
  }
  return normalized;
}

function validateRole(role) {
  const normalized = normalizeRole(role);
  if (!normalized) {
    throw new Error(`Роль должна быть одной из: ${USER_ROLES.join(", ")}`);
  }
  return normalized;
}

async function listUsers() {
  if (postgresStore.isEnabled()) {
    return postgresStore.listRows("users").then((rows) => rows.map(normalizeUser));
  }
  return readJson(USERS_FILE, []).map(normalizeUser);
}

async function findUserByLogin(login) {
  const normalized = normalizeLogin(login);
  if (!normalized) {
    return null;
  }
  const users = await listUsers();
  return users.find((user) => user.login === normalized) || null;
}

async function findUserById(id) {
  if (!id) {
    return null;
  }
  const users = await listUsers();
  return users.find((user) => user.id === id) || null;
}

async function createUser({ login, password, fullName, role, id, createdAt }) {
  const normalizedLogin = validateLogin(login);
  const normalizedRole = validateRole(role);
  const normalizedFullName = cleanText(fullName) || normalizedLogin;
  if (!password) {
    throw new Error("Пароль обязателен");
  }
  const existing = await findUserByLogin(normalizedLogin);
  if (existing) {
    throw new Error("Пользователь с таким логином уже существует");
  }
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const user = normalizeUser({
    id: id || `user-${Date.now()}`,
    login: normalizedLogin,
    fullName: normalizedFullName,
    role: normalizedRole,
    passwordHash,
    createdAt: createdAt || now,
    updatedAt: now
  });
  if (postgresStore.isEnabled()) {
    await postgresStore.insertRow("users", user);
    return publicUser(user);
  }
  const users = readJson(USERS_FILE, []);
  users.push(user);
  writeJson(USERS_FILE, users);
  return publicUser(user);
}

async function updateUser(id, patch = {}) {
  const current = await findUserById(id);
  if (!current) {
    return null;
  }
  const updates = { ...current };
  if (patch.fullName !== undefined) {
    updates.fullName = cleanText(patch.fullName) || current.fullName;
  }
  if (patch.role !== undefined) {
    updates.role = validateRole(patch.role);
  }
  if (patch.password) {
    updates.passwordHash = await hashPassword(patch.password);
  }
  updates.updatedAt = new Date().toISOString();
  const next = normalizeUser(updates);
  if (postgresStore.isEnabled()) {
    await postgresStore.updateRow("users", id, () => next);
    return publicUser(next);
  }
  const users = readJson(USERS_FILE, []);
  const index = users.findIndex((user) => user.id === id);
  if (index === -1) {
    return null;
  }
  users[index] = next;
  writeJson(USERS_FILE, users);
  return publicUser(next);
}

async function deleteUser(id) {
  if (postgresStore.isEnabled()) {
    const removed = await postgresStore.deleteRow("users", id);
    return removed ? publicUser(normalizeUser(removed)) : null;
  }
  const users = readJson(USERS_FILE, []);
  const index = users.findIndex((user) => user.id === id);
  if (index === -1) {
    return null;
  }
  const [removed] = users.splice(index, 1);
  writeJson(USERS_FILE, users);
  return publicUser(normalizeUser(removed));
}

async function authenticate(login, password) {
  const user = await findUserByLogin(login);
  if (!user) {
    return null;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

async function ensureBootstrapAdmin({ logger = console } = {}) {
  const login = normalizeLogin(process.env.ADMIN_LOGIN);
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!login || !password) {
    return null;
  }
  const existing = await findUserByLogin(login);
  if (existing) {
    return null;
  }
  try {
    const user = await createUser({
      login,
      password,
      fullName: cleanText(process.env.ADMIN_FULL_NAME) || "Администратор",
      role: "admin"
    });
    logger.info?.(`[users] bootstrap admin "${login}" создан`);
    return user;
  } catch (error) {
    logger.warn?.(`[users] bootstrap admin failed: ${error.message}`);
    return null;
  }
}

module.exports = {
  USER_ROLES,
  LOGIN_PATTERN,
  authenticate,
  createUser,
  deleteUser,
  ensureBootstrapAdmin,
  findUserById,
  findUserByLogin,
  listUsers,
  normalizeUser,
  publicUser,
  updateUser
};
