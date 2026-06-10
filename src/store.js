"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeDeal } = require("./analytics");
const postgresStore = require("./postgresStore");
const telegram = require("./telegram");
const { getMoscowNowIso, toIsoDate } = require("./time");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEALS_FILE = path.join(DATA_DIR, "deals.json");
const BANKS_FILE = path.join(DATA_DIR, "banks.json");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const KNOWLEDGE_FILE = path.join(DATA_DIR, "knowledge.json");
const MANAGERS_FILE = path.join(DATA_DIR, "managers.json");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const DOCUMENT_REQUESTS_FILE = path.join(DATA_DIR, "document_requests.json");
// Дефолтные списки. Используются:
//   а) для bootstrap (засев пустых коллекций при первом запуске);
//   б) как fallback при чтении, если коллекции ещё не инициализированы.
// Изменение типов/категорий — через API /api/program-types и /api/program-categories.
const DEFAULT_PROGRAM_TYPES = ["Экспресс", "Стандарт", "Физическое лицо", "Добивка"];
const DEFAULT_PROGRAM_CATEGORIES = [
  "1 КАТЕГОРИЯ",
  "2 КАТЕГОРИЯ",
  "3 КАТЕГОРИЯ",
  "РЕГИОНАЛЬНЫЕ",
  "СВОЯ ВЫРУЧКА",
  "НАЛОГОВАЯ ДЕКЛАРАЦИЯ",
  "ФИЗАВТО",
  "ТЕСТОВЫЕ БАНКИ"
];

// Совместимость с легаси-кодом (нормализация программ): pre-merge сохраняем
// те же имена, но теперь это динамические значения из БД при первом обращении.
let PROGRAM_TYPES = [...DEFAULT_PROGRAM_TYPES];
let PROGRAM_CATEGORIES = [...DEFAULT_PROGRAM_CATEGORIES];

function readJson(filePath, fallback) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text);
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

function cleanText(value) {
  return String(value || "").trim();
}

function initStore() {
  return postgresStore.ensureReady({ normalizeDeal, normalizeKnowledgeEntries });
}

function getDeals() {
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.listRows("deals")).then((deals) => deals.map(normalizeDeal));
  }
  return readJson(DEALS_FILE, []).map(normalizeDeal);
}

function saveDeals(deals) {
  writeJson(DEALS_FILE, deals.map(normalizeDeal));
}

const LEAD_BUCKET_STAGE_IDS = new Set(["lead", "documents_requested"]);

function validateDealDates(deal, previousDeal = null) {
  if (LEAD_BUCKET_STAGE_IDS.has(deal.stage) && !deal.inquiryAt) {
    throw new Error("Дата обращения обязательна для этого статуса");
  }
  if (deal.stage === "submitted" && !deal.signedAt) {
    throw new Error("Дата подписания обязательна для статуса \"Подписали заявку ждем решение\"");
  }
  if (LEAD_BUCKET_STAGE_IDS.has(previousDeal?.stage) && deal.stage === "submitted" && !deal.inquiryAt) {
    throw new Error("Дата обращения обязательна при переходе на \"Подписали заявку\"");
  }
  // Для статуса «Одобрено» сумма одобрения должна быть заполнена и положительна.
  // Иначе теряется ключевой показатель — без него отчёты и уведомления неинформативны.
  if (deal.stage === "approved") {
    const approved = Number(deal.amountApproved || 0);
    if (!Number.isFinite(approved) || approved <= 0) {
      throw new Error("Укажите сумму одобрения перед переводом заявки в «Одобрено»");
    }
  }
}

function buildStatusChangeAction(previousDeal, nextDeal, actionAt) {
  if (previousDeal.stage === nextDeal.stage) {
    return null;
  }

  return {
    id: `action-status-${new Date(actionAt).getTime()}`,
    action: `Смена статуса: ${previousDeal.stageLabel} → ${nextDeal.stageLabel}`,
    actionAt
  };
}

function buildInitialCommentAction(payload, actionAt) {
  const action = cleanText(payload.comment);
  const normalizedActionAt = toIsoDate(actionAt) || new Date().toISOString();
  if (!action) {
    return null;
  }

  return {
    id: `action-comment-${new Date(normalizedActionAt).getTime()}`,
    action,
    actionAt: normalizedActionAt
  };
}

async function createDeal(payload) {
  const now = await getMoscowNowIso();
  const createdAt = toIsoDate(payload.createdAt) || now;
  const initialCommentAction = buildInitialCommentAction(payload, createdAt);
  const deal = normalizeDeal({
    ...payload,
    id: payload.id || `deal-${new Date(now).getTime()}`,
    createdAt,
    updatedAt: now,
    actions: initialCommentAction ? [...(Array.isArray(payload.actions) ? payload.actions : []), initialCommentAction] : payload.actions
  });
  validateDealDates(deal);
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.insertRow("deals", deal)).then(normalizeDeal);
  }

  const deals = getDeals();
  deals.push(deal);
  saveDeals(deals);
  return deal;
}

// Стадии заявки, по которым включается ежедневная проверка статусов.
const CHECKABLE_STAGES = new Set(["lead", "documents_requested", "submitted"]);

// Метки времени в МСК (по точному дню). Используется для проверки
// «отмечено сегодня». dayKeyMsk возвращает "YYYY-MM-DD" по Europe/Moscow.
function dayKeyMsk(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(d).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isDealCheckedToday(deal, nowIso = new Date().toISOString()) {
  if (!deal?.lastCheckedAt) return false;
  return dayKeyMsk(deal.lastCheckedAt) === dayKeyMsk(nowIso);
}

function dealNeedsCheck(deal, nowIso = new Date().toISOString()) {
  if (!deal) return false;
  if (!CHECKABLE_STAGES.has(deal.stage)) return false;
  return !isDealCheckedToday(deal, nowIso);
}

async function markDealChecked(id) {
  const now = await getMoscowNowIso();
  if (postgresStore.isEnabled()) {
    await initStore();
    const updated = await postgresStore.updateRow("deals", id, (raw) => {
      const previous = normalizeDeal(raw);
      return normalizeDeal({ ...previous, lastCheckedAt: now, updatedAt: now });
    });
    return updated ? normalizeDeal(updated) : null;
  }
  const deals = getDeals();
  const index = deals.findIndex((d) => d.id === id);
  if (index === -1) return null;
  deals[index] = normalizeDeal({ ...deals[index], lastCheckedAt: now, updatedAt: now });
  saveDeals(deals);
  return deals[index];
}

async function updateDeal(id, patch) {
  if (postgresStore.isEnabled()) {
    return updateDealPostgres(id, patch);
  }

  const updatedAt = await getMoscowNowIso();
  const deals = getDeals();
  const index = deals.findIndex((deal) => deal.id === id);
  if (index === -1) {
    return null;
  }

  const next = normalizeDeal({
    ...deals[index],
    ...patch,
    id,
    updatedAt
  });
  validateDealDates(next, deals[index]);

  const statusChangeAction = buildStatusChangeAction(deals[index], next, updatedAt);
  deals[index] = statusChangeAction
    ? normalizeDeal({
        ...next,
        actions: [...(next.actions || []), statusChangeAction],
        updatedAt
      })
    : next;
  saveDeals(deals);
  return deals[index];
}

async function updateDealPostgres(id, patch) {
  await initStore();
  const updatedAt = await getMoscowNowIso();
  const updated = await postgresStore.updateRow("deals", id, (rawDeal) => {
    const previous = normalizeDeal(rawDeal);
    const next = normalizeDeal({
      ...previous,
      ...patch,
      id,
      updatedAt
    });
    validateDealDates(next, previous);

    const statusChangeAction = buildStatusChangeAction(previous, next, updatedAt);
    return statusChangeAction
      ? normalizeDeal({
          ...next,
          actions: [...(next.actions || []), statusChangeAction],
          updatedAt
        })
      : next;
  });
  return updated ? normalizeDeal(updated) : null;
}

async function addDealAction(id, payload) {
  if (postgresStore.isEnabled()) {
    return addDealActionPostgres(id, payload);
  }

  const now = await getMoscowNowIso();
  const deals = getDeals();
  const index = deals.findIndex((deal) => deal.id === id);
  if (index === -1) {
    return null;
  }

  const action = cleanText(payload.action || payload.comment);
  if (!action) {
    throw new Error("Действие или комментарий обязательны");
  }

  const actionAt = toIsoDate(payload.actionAt) || now;
  const actionEntry = {
    id: payload.id || `action-${new Date(actionAt).getTime()}`,
    action,
    actionAt
  };
  const next = normalizeDeal({
    ...deals[index],
    actions: [...(deals[index].actions || []), actionEntry],
    updatedAt: actionAt
  });

  deals[index] = next;
  saveDeals(deals);
  return next;
}

async function addDealActionPostgres(id, payload) {
  await initStore();
  const action = cleanText(payload.action || payload.comment);
  if (!action) {
    throw new Error("Действие или комментарий обязательны");
  }

  const now = await getMoscowNowIso();
  const actionAt = toIsoDate(payload.actionAt) || now;
  const actionEntry = {
    id: payload.id || `action-${new Date(actionAt).getTime()}`,
    action,
    actionAt
  };
  const updated = await postgresStore.updateRow("deals", id, (rawDeal) => normalizeDeal({
    ...normalizeDeal(rawDeal),
    actions: [...(normalizeDeal(rawDeal).actions || []), actionEntry],
    updatedAt: actionAt
  }));
  return updated ? normalizeDeal(updated) : null;
}

function getBanks() {
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.listRows("banks"));
  }
  return readJson(BANKS_FILE, []);
}

function normalizeManager(raw = {}) {
  const now = new Date().toISOString();
  const name = cleanText(raw.name || raw.manager);
  return {
    id: cleanText(raw.id) || `manager-${Date.now()}`,
    name,
    userId: cleanText(raw.userId),
    createdAt: toIsoDate(raw.createdAt) || now,
    updatedAt: toIsoDate(raw.updatedAt) || now
  };
}

function getManagers() {
  if (postgresStore.isEnabled()) {
    return initStore()
      .then(() => postgresStore.listRows("managers"))
      .then((managers) => managers.map(normalizeManager).filter((manager) => manager.name).sort((a, b) => a.name.localeCompare(b.name, "ru")));
  }
  return readJson(MANAGERS_FILE, [])
    .map(normalizeManager)
    .filter((manager) => manager.name)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function createManager(payload) {
  const now = new Date().toISOString();
  const manager = normalizeManager({
    id: payload.id || `manager-${Date.now()}`,
    name: payload.name,
    userId: payload.userId,
    createdAt: payload.createdAt || now,
    updatedAt: now
  });

  if (!manager.name) {
    throw new Error("Имя аналитика обязательно");
  }

  if (postgresStore.isEnabled()) {
    return initStore()
      .then(() => postgresStore.listRows("managers"))
      .then((managers) => {
        if (managers.some((item) => cleanText(item.name).toLowerCase() === manager.name.toLowerCase())) {
          throw new Error("Аналитик с таким именем уже есть");
        }
        return postgresStore.insertRow("managers", manager);
      });
  }

  const managers = getManagers();
  if (managers.some((item) => item.name.toLowerCase() === manager.name.toLowerCase())) {
    throw new Error("Аналитик с таким именем уже есть");
  }
  managers.push(manager);
  writeJson(MANAGERS_FILE, managers);
  return manager;
}

async function updateManager(id, patch) {
  if (postgresStore.isEnabled()) {
    await initStore();
    const updated = await postgresStore.updateRow("managers", id, (current) => normalizeManager({
      ...current,
      ...patch,
      id,
      updatedAt: new Date().toISOString()
    }));
    return updated ? normalizeManager(updated) : null;
  }
  const managers = getManagers();
  const index = managers.findIndex((m) => m.id === id);
  if (index === -1) {
    return null;
  }
  managers[index] = normalizeManager({
    ...managers[index],
    ...patch,
    id,
    updatedAt: new Date().toISOString()
  });
  writeJson(MANAGERS_FILE, managers);
  return managers[index];
}

function deleteManager(id) {
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.deleteRow("managers", id));
  }

  const managers = getManagers();
  const index = managers.findIndex((manager) => manager.id === id);
  if (index === -1) {
    return null;
  }
  const [deleted] = managers.splice(index, 1);
  writeJson(MANAGERS_FILE, managers);
  return deleted;
}

function createBank(payload) {
  const bank = {
    id: payload.id || `bank-${Date.now()}`,
    name: String(payload.name || "").trim(),
    region: String(payload.region || "").trim(),
    programs: Array.isArray(payload.programs) ? payload.programs : []
  };

  if (!bank.name) {
    throw new Error("Bank name is required");
  }

  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.insertRow("banks", bank));
  }

  const banks = getBanks();
  banks.push(bank);
  writeJson(BANKS_FILE, banks);
  return bank;
}

function getClients() {
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.listRows("clients")).then((clients) => clients.map(normalizeClient));
  }
  return readJson(CLIENTS_FILE, []).map(normalizeClient);
}

function normalizeClient(raw = {}) {
  const createdAt = toIsoDate(raw.createdAt);
  const updatedAt = toIsoDate(raw.updatedAt);
  const archivedAt = toIsoDate(raw.archivedAt);
  return {
    id: cleanText(raw.id) || `client-${Date.now()}`,
    name: cleanText(raw.name || raw.client),
    manager: cleanText(raw.manager) || "Без аналитика",
    contact: cleanText(raw.contact),
    phone: cleanText(raw.phone),
    crmUrl: cleanText(raw.crmUrl || raw.crmLink),
    driveUrl: cleanText(raw.driveUrl || raw.diskUrl || raw.driveLink),
    instructionUrl: cleanText(raw.instructionUrl || raw.instructionLink),
    comment: cleanText(raw.comment),
    telegramTopicId: cleanText(raw.telegramTopicId),
    archivedAt,
    createdAt,
    updatedAt: updatedAt || createdAt
  };
}

async function setClientTelegramTopicId(id, topicId) {
  const patch = (current) => normalizeClient({
    ...current,
    telegramTopicId: String(topicId || ""),
    updatedAt: new Date().toISOString()
  });
  if (postgresStore.isEnabled()) {
    await initStore();
    const updated = await postgresStore.updateRow("clients", id, patch);
    return updated ? normalizeClient(updated) : null;
  }
  const list = getClients();
  const index = list.findIndex((c) => c.id === id);
  if (index === -1) return null;
  list[index] = patch(list[index]);
  writeJson(CLIENTS_FILE, list);
  return list[index];
}

function createClient(payload) {
  const now = new Date().toISOString();
  const client = normalizeClient({
    ...payload,
    id: payload.id || `client-${Date.now()}`,
    createdAt: payload.createdAt || now,
    updatedAt: now
  });

  if (!client.name) {
    throw new Error("Client name is required");
  }

  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.insertRow("clients", client));
  }

  const clients = getClients();
  clients.push(client);
  writeJson(CLIENTS_FILE, clients);
  return client;
}

function archiveClient(id) {
  if (postgresStore.isEnabled()) {
    return archiveClientPostgres(id);
  }

  const clients = getClients();
  const index = clients.findIndex((client) => client.id === id);
  if (index === -1) {
    return null;
  }

  const archivedAt = new Date().toISOString();
  clients[index] = normalizeClient({
    ...clients[index],
    archivedAt,
    updatedAt: archivedAt
  });
  writeJson(CLIENTS_FILE, clients);
  return clients[index];
}

async function archiveClientPostgres(id) {
  await initStore();
  const archivedAt = new Date().toISOString();
  const updated = await postgresStore.updateRow("clients", id, (rawClient) => normalizeClient({
    ...normalizeClient(rawClient),
    archivedAt,
    updatedAt: archivedAt
  }));
  return updated ? normalizeClient(updated) : null;
}

// Все незавершённые заявки клиента переводим в stage=blocked с указанной
// причиной (закрытие работы с клиентом). Возвращает количество переведённых.
// «Незавершённая» = statusGroup === "current" (planned/lead/documents_requested/submitted).
async function bulkBlockClientDeals(clientName, managerName, reason) {
  const reasonText = String(reason || "").trim() || "Закончили работу с клиентом";
  const nameKey = String(clientName || "").trim().toLowerCase();
  const mgrKey = String(managerName || "").trim().toLowerCase();
  if (!nameKey) return 0;
  const matches = (d) => {
    if (String(d.client || "").trim().toLowerCase() !== nameKey) return false;
    if (mgrKey && String(d.manager || "").trim().toLowerCase() !== mgrKey) return false;
    return d.statusGroup === "current";
  };
  let blocked = 0;
  if (postgresStore.isEnabled()) {
    await initStore();
    const all = await postgresStore.listRows("deals");
    const target = all.map(normalizeDeal).filter(matches);
    for (const deal of target) {
      try {
        await postgresStore.updateRow("deals", deal.id, (raw) => {
          const previous = normalizeDeal(raw);
          const now = new Date().toISOString();
          const next = normalizeDeal({
            ...previous,
            stage: "blocked",
            comment: reasonText,
            updatedAt: now
          });
          const action = buildStatusChangeAction(previous, next, now);
          return action ? normalizeDeal({ ...next, actions: [...(next.actions || []), action] }) : next;
        });
        blocked += 1;
      } catch (e) {
        console.warn("[bulkBlockClientDeals] update error:", deal.id, e.message);
      }
    }
    return blocked;
  }
  const deals = getDeals();
  for (let i = 0; i < deals.length; i += 1) {
    if (!matches(deals[i])) continue;
    const previous = deals[i];
    const now = new Date().toISOString();
    const next = normalizeDeal({
      ...previous,
      stage: "blocked",
      comment: reasonText,
      updatedAt: now
    });
    const action = buildStatusChangeAction(previous, next, now);
    deals[i] = action ? normalizeDeal({ ...next, actions: [...(next.actions || []), action] }) : next;
    blocked += 1;
  }
  if (blocked > 0) saveDeals(deals);
  return blocked;
}

async function deleteClient(id) {
  if (postgresStore.isEnabled()) {
    await initStore();
    const deleted = await postgresStore.deleteRow("clients", id);
    if (deleted) {
      await postgresStore.deleteTasksByClient(deleted.manager || "", deleted.name || "");
      await postgresStore.deleteDocumentRequestsByClient(deleted.manager || "", deleted.name || "");
    }
    return deleted;
  }
  const clients = getClients();
  const index = clients.findIndex((client) => client.id === id);
  if (index === -1) {
    return null;
  }
  const [deleted] = clients.splice(index, 1);
  writeJson(CLIENTS_FILE, clients);
  cascadeDeleteTasksByClient(deleted.manager, deleted.name);
  cascadeDeleteDocumentRequestsByClient(deleted.manager, deleted.name);
  return deleted;
}

function cascadeDeleteTasksByClient(managerName, clientName) {
  const targetManager = cleanText(managerName).toLowerCase();
  const targetClient = cleanText(clientName).toLowerCase();
  if (!targetManager || !targetClient) {
    return;
  }
  const tasks = readJson(TASKS_FILE, []);
  const remaining = tasks.filter((task) => {
    const m = cleanText(task.manager).toLowerCase();
    const c = cleanText(task.client).toLowerCase();
    return !(m === targetManager && c === targetClient);
  });
  if (remaining.length !== tasks.length) {
    saveTasks(remaining);
  }
}

function cascadeDeleteDocumentRequestsByClient(managerName, clientName) {
  const targetManager = cleanText(managerName).toLowerCase();
  const targetClient = cleanText(clientName).toLowerCase();
  if (!targetManager || !targetClient) {
    return;
  }
  const list = readJson(DOCUMENT_REQUESTS_FILE, []);
  const remaining = list.filter((req) => {
    const m = cleanText(req.manager).toLowerCase();
    const c = cleanText(req.clientName).toLowerCase();
    return !(m === targetManager && c === targetClient);
  });
  if (remaining.length !== list.length) {
    saveDocumentRequests(remaining);
  }
}

function cascadeDeleteDocumentRequestsByDeal(dealId) {
  const target = cleanText(dealId);
  if (!target) {
    return;
  }
  const list = readJson(DOCUMENT_REQUESTS_FILE, []);
  const remaining = list.filter((req) => cleanText(req.dealId) !== target);
  if (remaining.length !== list.length) {
    saveDocumentRequests(remaining);
  }
}

async function deleteDeal(id) {
  if (postgresStore.isEnabled()) {
    await initStore();
    const deleted = await postgresStore.deleteRow("deals", id);
    if (deleted) {
      await postgresStore.deleteDocumentRequestsByDeal(id);
    }
    return deleted;
  }
  const deals = getDeals();
  const index = deals.findIndex((deal) => deal.id === id);
  if (index === -1) {
    return null;
  }
  const [deleted] = deals.splice(index, 1);
  saveDeals(deals);
  cascadeDeleteDocumentRequestsByDeal(id);
  return deleted;
}

function normalizeTask(raw = {}) {
  const createdAt = toIsoDate(raw.createdAt);
  const updatedAt = toIsoDate(raw.updatedAt);
  return {
    id: cleanText(raw.id) || `task-${Date.now()}`,
    manager: cleanText(raw.manager),
    client: cleanText(raw.client),
    title: cleanText(raw.title || raw.text || raw.action),
    dueAt: toIsoDate(raw.dueAt),
    completedAt: toIsoDate(raw.completedAt),
    createdAt: createdAt,
    updatedAt: updatedAt || createdAt
  };
}

function getTasks() {
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.listRows("tasks")).then((tasks) => tasks.map(normalizeTask));
  }
  return readJson(TASKS_FILE, []).map(normalizeTask);
}

function saveTasks(tasks) {
  writeJson(TASKS_FILE, tasks.map(normalizeTask));
}

function validateTask(task) {
  if (!task.manager) {
    throw new Error("Аналитик обязателен");
  }
  if (!task.client) {
    throw new Error("Клиент обязателен");
  }
  if (!task.title) {
    throw new Error("Описание задачи обязательно");
  }
  if (!task.dueAt) {
    throw new Error("Срок исполнения обязателен");
  }
}

async function createTask(payload) {
  const now = await getMoscowNowIso();
  const task = normalizeTask({
    ...payload,
    id: payload.id || `task-${new Date(now).getTime()}`,
    createdAt: payload.createdAt || now,
    updatedAt: now
  });
  validateTask(task);
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.insertRow("tasks", task)).then(normalizeTask);
  }
  const tasks = getTasks();
  tasks.push(task);
  saveTasks(tasks);
  return task;
}

async function updateTask(id, patch) {
  if (postgresStore.isEnabled()) {
    return updateTaskPostgres(id, patch);
  }

  const updatedAt = await getMoscowNowIso();
  const tasks = getTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) {
    return null;
  }
  const next = normalizeTask({
    ...tasks[index],
    ...patch,
    id,
    updatedAt
  });
  if (patch.completed === true && !next.completedAt) {
    next.completedAt = updatedAt;
  }
  if (patch.completed === false) {
    next.completedAt = "";
  }
  validateTask(next);
  tasks[index] = next;
  saveTasks(tasks);
  return tasks[index];
}

async function updateTaskPostgres(id, patch) {
  await initStore();
  const updatedAt = await getMoscowNowIso();
  const updated = await postgresStore.updateRow("tasks", id, (rawTask) => {
    const previous = normalizeTask(rawTask);
    const next = normalizeTask({
      ...previous,
      ...patch,
      id,
      updatedAt
    });
    if (patch.completed === true && !next.completedAt) {
      next.completedAt = updatedAt;
    }
    if (patch.completed === false) {
      next.completedAt = "";
    }
    validateTask(next);
    return next;
  });
  return updated ? normalizeTask(updated) : null;
}

function deleteTask(id) {
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.deleteRow("tasks", id));
  }
  const tasks = getTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) {
    return null;
  }
  const [deleted] = tasks.splice(index, 1);
  saveTasks(tasks);
  return deleted;
}

// ===== Document requests =====

function normalizeDocumentRequestAttachment(raw = {}) {
  return {
    id: cleanText(raw.id) || `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: cleanText(raw.fileName),
    mimeType: cleanText(raw.mimeType),
    size: Number(raw.size) || 0,
    driveFileId: cleanText(raw.driveFileId),
    driveLink: cleanText(raw.driveLink),
    uploadedAt: toIsoDate(raw.uploadedAt) || new Date().toISOString(),
    uploadedBy: cleanText(raw.uploadedBy),
    uploadedByLogin: cleanText(raw.uploadedByLogin)
  };
}

function normalizeDocumentRequest(raw = {}) {
  const createdAt = toIsoDate(raw.createdAt);
  const updatedAt = toIsoDate(raw.updatedAt);
  const fulfilledAt = toIsoDate(raw.fulfilledAt);
  const deliveredAt = toIsoDate(raw.deliveredAt);
  let status;
  if (deliveredAt) {
    status = "delivered";
  } else if (fulfilledAt) {
    status = "fulfilled";
  } else {
    status = cleanText(raw.status) || "open";
  }
  return {
    id: cleanText(raw.id) || `docreq-${Date.now()}`,
    dealId: cleanText(raw.dealId),
    clientId: cleanText(raw.clientId),
    clientName: cleanText(raw.clientName || raw.client),
    manager: cleanText(raw.manager),
    program: cleanText(raw.program),
    bank: cleanText(raw.bank),
    driveUrl: cleanText(raw.driveUrl),
    items: cleanText(raw.items),
    period: cleanText(raw.period),
    openMessageId: cleanText(raw.openMessageId),
    partialUploadMessageIds: Array.isArray(raw.partialUploadMessageIds)
      ? raw.partialUploadMessageIds.map((v) => String(v == null ? "" : v)).filter(Boolean)
      : [],
    status,
    createdBy: cleanText(raw.createdBy),
    createdByLogin: cleanText(raw.createdByLogin),
    fulfilledBy: cleanText(raw.fulfilledBy),
    fulfilledByLogin: cleanText(raw.fulfilledByLogin),
    deliveredBy: cleanText(raw.deliveredBy),
    deliveredByLogin: cleanText(raw.deliveredByLogin),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map(normalizeDocumentRequestAttachment) : [],
    createdAt,
    updatedAt: updatedAt || createdAt,
    fulfilledAt,
    deliveredAt
  };
}

function getDocumentRequests() {
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.listRows("document_requests")).then((rows) => rows.map(normalizeDocumentRequest));
  }
  return readJson(DOCUMENT_REQUESTS_FILE, []).map(normalizeDocumentRequest);
}

function saveDocumentRequests(items) {
  writeJson(DOCUMENT_REQUESTS_FILE, items.map(normalizeDocumentRequest));
}

function validateDocumentRequest(req) {
  if (!req.dealId) {
    throw new Error("Заявка обязательна");
  }
  if (!req.manager) {
    throw new Error("Аналитик обязателен");
  }
  if (!req.clientName) {
    throw new Error("Клиент обязателен");
  }
  if (!req.items) {
    throw new Error("Список документов обязателен");
  }
  if (!req.period) {
    throw new Error("Период обязателен");
  }
}

async function createDocumentRequest(payload, { author } = {}) {
  const now = await getMoscowNowIso();
  const dealId = cleanText(payload.dealId);
  if (!dealId) {
    throw new Error("Заявка обязательна");
  }
  const deals = await getDeals();
  const deal = deals.find((item) => item.id === dealId);
  if (!deal) {
    throw new Error("Заявка не найдена");
  }
  const clients = await getClients();
  const client = clients.find((item) =>
    cleanText(item.name).toLowerCase() === cleanText(deal.client).toLowerCase() &&
    cleanText(item.manager).toLowerCase() === cleanText(deal.manager).toLowerCase()
  );
  const req = normalizeDocumentRequest({
    id: payload.id || `docreq-${new Date(now).getTime()}`,
    dealId: deal.id,
    clientId: client?.id || "",
    clientName: deal.client,
    manager: deal.manager,
    program: deal.program || deal.bank,
    bank: deal.bank,
    driveUrl: client?.driveUrl || "",
    items: payload.items,
    period: payload.period,
    status: "open",
    createdBy: cleanText(author?.fullName),
    createdByLogin: cleanText(author?.login),
    createdAt: now,
    updatedAt: now,
    fulfilledAt: ""
  });
  validateDocumentRequest(req);
  let saved;
  if (postgresStore.isEnabled()) {
    saved = await initStore().then(() => postgresStore.insertRow("document_requests", req)).then(normalizeDocumentRequest);
  } else {
    const list = getDocumentRequests();
    list.push(req);
    saveDocumentRequests(list);
    saved = req;
  }
  // Логируем в хронологию сделки.
  try {
    const itemsCount = Array.isArray(saved.items) ? saved.items.length : 0;
    const itemsTail = itemsCount ? ` — ${itemsCount} ${itemsCount === 1 ? "позиция" : itemsCount < 5 ? "позиции" : "позиций"}` : "";
    const byTail = author?.fullName ? ` (${author.fullName})` : "";
    await addDealAction(saved.dealId, { action: `Запрошены документы${itemsTail}${byTail}`, actionAt: saved.createdAt });
  } catch {
    // если хронология не пишется — не валим основной поток
  }
  // Telegram-уведомление отправляется из server.js (там доступ к topicId клиента).
  return saved;
}

async function setDocumentRequestOpenMessageId(id, messageId) {
  const patch = (current) => normalizeDocumentRequest({
    ...current,
    openMessageId: String(messageId == null ? "" : messageId),
    updatedAt: new Date().toISOString()
  });
  if (postgresStore.isEnabled()) {
    await initStore();
    const updated = await postgresStore.updateRow("document_requests", id, patch);
    return updated ? normalizeDocumentRequest(updated) : null;
  }
  const list = getDocumentRequests();
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return null;
  list[index] = patch(list[index]);
  saveDocumentRequests(list);
  return list[index];
}

// Накопительно добавляет message_id уведомления о частичной подгрузке.
// Используется чтобы потом подчистить все промежуточные сообщения из топика
// в момент завершения запроса (fulfill).
async function addDocumentRequestPartialUploadMessageId(id, messageId) {
  const mid = String(messageId == null ? "" : messageId);
  if (!mid) return null;
  const patch = (current) => {
    const list = Array.isArray(current.partialUploadMessageIds) ? current.partialUploadMessageIds.slice() : [];
    if (!list.includes(mid)) list.push(mid);
    return normalizeDocumentRequest({
      ...current,
      partialUploadMessageIds: list,
      updatedAt: new Date().toISOString()
    });
  };
  if (postgresStore.isEnabled()) {
    await initStore();
    const updated = await postgresStore.updateRow("document_requests", id, patch);
    return updated ? normalizeDocumentRequest(updated) : null;
  }
  const list = getDocumentRequests();
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return null;
  list[index] = patch(list[index]);
  saveDocumentRequests(list);
  return list[index];
}

async function clearDocumentRequestPartialUploadMessageIds(id) {
  const patch = (current) => normalizeDocumentRequest({
    ...current,
    partialUploadMessageIds: [],
    updatedAt: new Date().toISOString()
  });
  if (postgresStore.isEnabled()) {
    await initStore();
    const updated = await postgresStore.updateRow("document_requests", id, patch);
    return updated ? normalizeDocumentRequest(updated) : null;
  }
  const list = getDocumentRequests();
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return null;
  list[index] = patch(list[index]);
  saveDocumentRequests(list);
  return list[index];
}

// originalName = всё после префикса "YYYY-MM-DD_HH-mm__"; если префикса нет, возвращает имя как есть.
function stripFilePrefix(fileName) {
  const s = String(fileName || "");
  const match = s.match(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}__(.+)$/);
  return match ? match[1] : s;
}

async function addDocumentRequestAttachment(id, attachment) {
  const att = normalizeDocumentRequestAttachment(attachment);
  // Возвращает: { request, attachment, duplicate: bool }
  // Дедуп: тот же driveFileId → точно дубль (один и тот же файл на Drive).
  //        тот же originalName+size → семантически тот же файл из новой загрузки.
  let duplicate = false;
  const patch = (current) => {
    const existing = Array.isArray(current.attachments) ? current.attachments : [];
    const newOriginal = stripFilePrefix(att.fileName);
    const isDup = existing.some((e) => {
      if (att.driveFileId && e.driveFileId && e.driveFileId === att.driveFileId) return true;
      const eOriginal = stripFilePrefix(e.fileName);
      if (eOriginal && eOriginal === newOriginal && Number(e.size) > 0 && Number(e.size) === Number(att.size)) return true;
      return false;
    });
    if (isDup) {
      duplicate = true;
      return normalizeDocumentRequest(current); // no-op
    }
    return normalizeDocumentRequest({
      ...current,
      attachments: [...existing, att],
      updatedAt: new Date().toISOString()
    });
  };
  let result;
  if (postgresStore.isEnabled()) {
    await initStore();
    const updated = await postgresStore.updateRow("document_requests", id, patch);
    result = updated ? normalizeDocumentRequest(updated) : null;
  } else {
    const list = getDocumentRequests();
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) return { request: null, attachment: null, duplicate: false };
    list[index] = patch(list[index]);
    saveDocumentRequests(list);
    result = list[index];
  }
  return { request: result, attachment: duplicate ? null : att, duplicate };
}

async function removeDocumentRequestAttachment(id, attachmentId) {
  let removed = null;
  const patch = (current) => {
    const list = Array.isArray(current.attachments) ? current.attachments : [];
    const next = list.filter((att) => {
      if (att.id === attachmentId) {
        removed = att;
        return false;
      }
      return true;
    });
    return normalizeDocumentRequest({
      ...current,
      attachments: next,
      updatedAt: new Date().toISOString()
    });
  };
  if (postgresStore.isEnabled()) {
    await initStore();
    const updated = await postgresStore.updateRow("document_requests", id, patch);
    return { request: updated ? normalizeDocumentRequest(updated) : null, attachment: removed };
  }
  const list = getDocumentRequests();
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return { request: null, attachment: null };
  list[index] = patch(list[index]);
  saveDocumentRequests(list);
  return { request: list[index], attachment: removed };
}

async function fulfillDocumentRequest(id, { actor, recipientChatId } = {}) {
  const now = await getMoscowNowIso();
  const patch = (current) => {
    // Guard: переводить можно только из open → fulfilled.
    // Иначе двойной клик / параллельный запрос мог бы перезаписать fulfilledAt.
    const currentStatus = cleanText(current?.status) || "open";
    if (currentStatus !== "open") {
      const err = new Error("Запрос уже не в статусе «открыт»");
      err.code = "INVALID_STATE";
      throw err;
    }
    return normalizeDocumentRequest({
      ...current,
      status: "fulfilled",
      fulfilledAt: now,
      fulfilledBy: cleanText(actor?.fullName),
      fulfilledByLogin: cleanText(actor?.login),
      updatedAt: now
    });
  };
  let updated;
  if (postgresStore.isEnabled()) {
    await initStore();
    const raw = await postgresStore.updateRow("document_requests", id, patch);
    updated = raw ? normalizeDocumentRequest(raw) : null;
  } else {
    const list = getDocumentRequests();
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }
    list[index] = patch(list[index]);
    saveDocumentRequests(list);
    updated = list[index];
  }
  if (updated?.dealId) {
    try {
      const filesCount = Array.isArray(updated.attachments) ? updated.attachments.length : 0;
      const filesTail = filesCount ? ` — ${filesCount} ${filesCount === 1 ? "файл" : (filesCount < 5 ? "файла" : "файлов")}` : "";
      const byTail = actor?.fullName ? ` (${actor.fullName})` : "";
      await addDealAction(updated.dealId, { action: `Документы загружены и готовы к отправке${filesTail}${byTail}`, actionAt: updated.fulfilledAt });
    } catch { /* skip */ }
  }
  // Telegram-уведомление: отправляется из server.js, потому что там есть доступ к Drive-стримам.
  // (Раньше тут стоял fire-and-forget notifyDocRequestFulfilled — теперь это делает server fulfill-handler.)
  return updated;
}

async function confirmDocumentRequest(id, { actor } = {}) {
  const now = await getMoscowNowIso();
  const patch = (current) => {
    // Guard: переводить можно только из fulfilled → delivered.
    const currentStatus = cleanText(current?.status) || "open";
    if (currentStatus !== "fulfilled") {
      const err = new Error("Подтверждать можно только запросы со статусом «документы загружены»");
      err.code = "INVALID_STATE";
      throw err;
    }
    return normalizeDocumentRequest({
      ...current,
      status: "delivered",
      deliveredAt: now,
      deliveredBy: cleanText(actor?.fullName),
      deliveredByLogin: cleanText(actor?.login),
      updatedAt: now
    });
  };
  let updated;
  if (postgresStore.isEnabled()) {
    await initStore();
    const raw = await postgresStore.updateRow("document_requests", id, patch);
    updated = raw ? normalizeDocumentRequest(raw) : null;
  } else {
    const list = getDocumentRequests();
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }
    list[index] = patch(list[index]);
    saveDocumentRequests(list);
    updated = list[index];
  }
  if (updated?.dealId) {
    try {
      const byTail = actor?.fullName ? ` (${actor.fullName})` : "";
      await addDealAction(updated.dealId, { action: `Документы получены аналитиком${byTail}`, actionAt: updated.deliveredAt });
    } catch { /* skip */ }
  }
  // Telegram-уведомление отправляется из server.js (там доступ к topicId клиента).
  return updated;
}

function deleteDocumentRequest(id) {
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.deleteRow("document_requests", id));
  }
  const list = getDocumentRequests();
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  const [deleted] = list.splice(index, 1);
  saveDocumentRequests(list);
  return deleted;
}

function getKnowledge() {
  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.listKnowledge()).then(normalizeKnowledgeEntries);
  }
  return normalizeKnowledgeEntries(readJson(KNOWLEDGE_FILE, []));
}

function createKnowledgeEntry(payload) {
  const now = new Date().toISOString();
  const bankName = cleanText(payload.bank);
  const program = normalizeKnowledgeProgram({
    id: payload.id || `kb-${Date.now()}`,
    bankPhone: payload.bankPhone,
    program: payload.program || payload.topic,
    programUrl: payload.programUrl,
    programType: payload.programType,
    category: payload.category,
    amountRange: payload.amountRange,
    termRange: payload.termRange,
    reviewTermDeclared: payload.reviewTermDeclared,
    requirements: payload.requirements || payload,
    notes: payload.notes,
    changeHistory: payload.changeHistory,
    updatedAt: now
  });

  if (!bankName || !program.program) {
    throw new Error("Bank and program are required");
  }

  if (postgresStore.isEnabled()) {
    return initStore().then(() => postgresStore.insertKnowledgeProgram(bankName, program));
  }

  const banks = getKnowledge();
  let bank = banks.find((item) => item.bank.toLowerCase() === bankName.toLowerCase());
  if (!bank) {
    bank = {
      id: `bank-knowledge-${Date.now()}`,
      bank: bankName,
      programs: [],
      updatedAt: now
    };
    banks.push(bank);
  }

  bank.programs.push(program);
  bank.updatedAt = now;
  writeJson(KNOWLEDGE_FILE, banks);
  return { bank: bank.bank, program };
}

function updateKnowledgeProgram(programId, payload) {
  if (postgresStore.isEnabled()) {
    return updateKnowledgeProgramPostgres(programId, payload);
  }

  const banks = getKnowledge();
  const now = new Date().toISOString();
  let sourceBank = null;
  let sourceProgram = null;

  for (const bank of banks) {
    const program = bank.programs.find((item) => item.id === programId);
    if (program) {
      sourceBank = bank;
      sourceProgram = program;
      break;
    }
  }

  if (!sourceBank || !sourceProgram) {
    return null;
  }

  const bankName = cleanText(payload.bank) || sourceBank.bank;
  const updatedProgram = normalizeKnowledgeProgram({
    ...sourceProgram,
    ...payload,
    id: sourceProgram.id,
    requirements: {
      ...(sourceProgram.requirements || {}),
      ...(payload.requirements || payload)
    },
    updatedAt: now
  });

  sourceBank.programs = sourceBank.programs.filter((program) => program.id !== programId);
  if (!sourceBank.programs.length) {
    const index = banks.indexOf(sourceBank);
    if (index !== -1) {
      banks.splice(index, 1);
    }
  } else {
    sourceBank.updatedAt = now;
  }

  let targetBank = banks.find((bank) => bank.bank.toLowerCase() === bankName.toLowerCase());
  if (!targetBank) {
    targetBank = {
      id: `bank-knowledge-${Date.now()}`,
      bank: bankName,
      programs: [],
      updatedAt: now
    };
    banks.push(targetBank);
  }

  targetBank.programs.push(updatedProgram);
  targetBank.updatedAt = now;
  writeJson(KNOWLEDGE_FILE, banks);
  return { bank: targetBank.bank, program: updatedProgram };
}

async function updateKnowledgeProgramPostgres(programId, payload) {
  await initStore();
  return postgresStore.updateKnowledgeProgram(programId, ({ bank, program }) => {
    const now = new Date().toISOString();
    const bankName = cleanText(payload.bank) || bank;
    const updatedProgram = normalizeKnowledgeProgram({
      ...program,
      ...payload,
      id: program.id,
      requirements: {
        ...(program.requirements || {}),
        ...(payload.requirements || payload)
      },
      updatedAt: now
    });
    return { bank: bankName, program: updatedProgram };
  });
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRequirementText(value) {
  if (Array.isArray(value)) {
    return normalizeList(value).join("\n");
  }
  return cleanText(value);
}

function normalizeRequirements(source = {}) {
  return {
    businessRegion: normalizeRequirementText(source.businessRegion || source.region || source.business_region),
    ipAge: normalizeRequirementText(source.ipAge || source.age || source.ip_age),
    revenue: normalizeRequirementText(source.revenue || source.turnover),
    documentation: normalizeRequirementText(source.documentation || source.documents),
    okved: normalizeRequirementText(source.okved || source.okveds),
    accountPresence: normalizeRequirementText(source.accountPresence || source.account || source.account_presence)
  };
}

function normalizeProgramType(value) {
  const text = cleanText(value);
  if (!text) return "Стандарт";
  // Сначала пробуем найти совпадение в актуальном (динамическом) списке —
  // case-insensitive, чтобы данные не потерялись после переименования.
  const match = PROGRAM_TYPES.find((t) => t.toLowerCase() === text.toLowerCase());
  if (match) return match;
  // Если в текущем списке нет такого — всё равно сохраняем как есть (free-form).
  // Аналитики увидят как "прочие" в группировках; админ может либо добавить
  // в список, либо переименовать программу.
  return text;
}

function isLegacySourceNote(value) {
  return /^Источник:/i.test(cleanText(value));
}

function normalizeProgramCategory(value) {
  const text = cleanText(value);
  if (!text) return "";
  const upper = text.toUpperCase();
  const match = PROGRAM_CATEGORIES.find((category) => category.toUpperCase() === upper);
  if (match) return match;
  return text;
}

function normalizeKnowledgeProgram(raw = {}) {
  const requirements = raw.requirements && !Array.isArray(raw.requirements) ? raw.requirements : raw;
  const legacyRequirements = Array.isArray(raw.requirements) ? normalizeList(raw.requirements).join("\n") : "";
  const legacyDocuments = Array.isArray(raw.documents) ? normalizeList(raw.documents).join("\n") : normalizeRequirementText(raw.documents);
  const rawNotes = cleanText(raw.notes);
  const legacyHistory = isLegacySourceNote(rawNotes) ? rawNotes : "";

  return {
    id: cleanText(raw.id) || `kb-${Date.now()}`,
    bankPhone: cleanText(raw.bankPhone || raw.phone || raw.bank_phone),
    program: cleanText(raw.program || raw.topic || raw.name),
    programUrl: cleanText(raw.programUrl || raw.url || raw.link || raw.programLink),
    programType: normalizeProgramType(raw.programType || raw.type),
    category: normalizeProgramCategory(raw.category || raw.section),
    amountRange: cleanText(raw.amountRange || raw.amount || raw.limit || raw.sum),
    termRange: cleanText(raw.termRange || raw.term || raw.period || raw.duration || raw.creditTerm),
    reviewTermDeclared: cleanText(raw.reviewTermDeclared || raw.reviewTerm || raw.declaredReviewTerm || raw.reviewPeriod),
    requirements: normalizeRequirements({
      ...requirements,
      documentation: requirements.documentation || legacyDocuments,
      revenue: requirements.revenue || legacyRequirements
    }),
    notes: legacyHistory ? "" : rawNotes,
    changeHistory: normalizeRequirementText(raw.changeHistory || raw.history || raw.changeLog || raw.sources || raw.source || raw.dataSources || legacyHistory),
    updatedAt: cleanText(raw.updatedAt) || new Date().toISOString()
  };
}

function normalizeKnowledgeEntries(entries) {
  const bankMap = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const bankName = cleanText(entry.bank || entry.name);
    if (!bankName) {
      continue;
    }

    if (!bankMap.has(bankName.toLowerCase())) {
      bankMap.set(bankName.toLowerCase(), {
        id: cleanText(entry.id) || `bank-knowledge-${bankMap.size + 1}`,
        bank: bankName,
        phone: cleanText(entry.phone || entry.bankPhone || entry.bank_phone),
        programs: [],
        updatedAt: cleanText(entry.updatedAt)
      });
    }

    const bank = bankMap.get(bankName.toLowerCase());
    const programs = Array.isArray(entry.programs) ? entry.programs : [entry];
    for (const rawProgram of programs) {
      const program = normalizeKnowledgeProgram(rawProgram);
      if (program.program) {
        if (!bank.phone && program.bankPhone) {
          bank.phone = program.bankPhone;
        }
        bank.programs.push(program);
      }
    }
    bank.updatedAt = bank.updatedAt || bank.programs[0]?.updatedAt || "";
  }

  return Array.from(bankMap.values()).sort((left, right) => left.bank.localeCompare(right.bank, "ru"));
}

// ===== Program types & categories (admin taxonomy) =====

function normalizeTaxonomyItem(raw = {}) {
  const now = new Date().toISOString();
  return {
    id: cleanText(raw.id) || `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanText(raw.name),
    sortOrder: Number(raw.sortOrder) || 0,
    createdAt: toIsoDate(raw.createdAt) || now,
    updatedAt: toIsoDate(raw.updatedAt) || now
  };
}

async function listTaxonomy(collection) {
  if (postgresStore.isEnabled()) {
    await initStore();
    const rows = await postgresStore.listRows(collection);
    return rows.map(normalizeTaxonomyItem).filter((it) => it.name).sort(taxonomySort);
  }
  // file-mode fallback (юзается локально)
  const file = collection === "program_types"
    ? path.join(DATA_DIR, "program_types.json")
    : path.join(DATA_DIR, "program_categories.json");
  return readJson(file, []).map(normalizeTaxonomyItem).filter((it) => it.name).sort(taxonomySort);
}

function taxonomySort(a, b) {
  const so = (a.sortOrder || 0) - (b.sortOrder || 0);
  if (so !== 0) return so;
  return String(a.name || "").localeCompare(String(b.name || ""), "ru");
}

async function createTaxonomyItem(collection, payload) {
  const item = normalizeTaxonomyItem({
    name: payload.name,
    sortOrder: payload.sortOrder,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  if (!item.name) throw new Error("Имя обязательно");
  // dedup case-insensitive
  const existing = await listTaxonomy(collection);
  const lower = item.name.toLowerCase();
  if (existing.some((e) => e.name.toLowerCase() === lower)) {
    throw new Error("Такое значение уже есть");
  }
  if (postgresStore.isEnabled()) {
    await initStore();
    await postgresStore.insertRow(collection, item);
  } else {
    const file = collection === "program_types"
      ? path.join(DATA_DIR, "program_types.json")
      : path.join(DATA_DIR, "program_categories.json");
    const list = readJson(file, []);
    list.push(item);
    writeJson(file, list);
  }
  await reloadTaxonomyCache();
  return item;
}

async function updateTaxonomyItem(collection, id, patch) {
  const cleanPatch = {};
  if (patch.name !== undefined) cleanPatch.name = cleanText(patch.name);
  if (patch.sortOrder !== undefined) cleanPatch.sortOrder = Number(patch.sortOrder) || 0;
  if (cleanPatch.name === "") throw new Error("Имя обязательно");
  // dedup
  if (cleanPatch.name) {
    const existing = await listTaxonomy(collection);
    const lower = cleanPatch.name.toLowerCase();
    if (existing.some((e) => e.id !== id && e.name.toLowerCase() === lower)) {
      throw new Error("Такое значение уже есть");
    }
  }
  let updated;
  if (postgresStore.isEnabled()) {
    await initStore();
    updated = await postgresStore.updateRow(collection, id, (current) => normalizeTaxonomyItem({
      ...current,
      ...cleanPatch,
      updatedAt: new Date().toISOString()
    }));
  } else {
    const file = collection === "program_types"
      ? path.join(DATA_DIR, "program_types.json")
      : path.join(DATA_DIR, "program_categories.json");
    const list = readJson(file, []);
    const idx = list.findIndex((it) => it.id === id);
    if (idx === -1) return null;
    list[idx] = normalizeTaxonomyItem({ ...list[idx], ...cleanPatch, updatedAt: new Date().toISOString() });
    writeJson(file, list);
    updated = list[idx];
  }
  await reloadTaxonomyCache();
  return updated ? normalizeTaxonomyItem(updated) : null;
}

async function deleteTaxonomyItem(collection, id) {
  let removed;
  if (postgresStore.isEnabled()) {
    await initStore();
    removed = await postgresStore.deleteRow(collection, id);
  } else {
    const file = collection === "program_types"
      ? path.join(DATA_DIR, "program_types.json")
      : path.join(DATA_DIR, "program_categories.json");
    const list = readJson(file, []);
    const idx = list.findIndex((it) => it.id === id);
    if (idx === -1) return null;
    [removed] = list.splice(idx, 1);
    writeJson(file, list);
  }
  await reloadTaxonomyCache();
  return removed ? normalizeTaxonomyItem(removed) : null;
}

// Засев списков при первом старте, если коллекции пустые. Идемпотентно.
async function seedTaxonomyIfEmpty() {
  for (const [collection, defaults] of [
    ["program_types", DEFAULT_PROGRAM_TYPES],
    ["program_categories", DEFAULT_PROGRAM_CATEGORIES]
  ]) {
    const existing = await listTaxonomy(collection);
    if (existing.length > 0) continue;
    for (let i = 0; i < defaults.length; i += 1) {
      try {
        await createTaxonomyItem(collection, { name: defaults[i], sortOrder: (i + 1) * 10 });
      } catch { /* ignore */ }
    }
  }
}

async function reloadTaxonomyCache() {
  try {
    const types = await listTaxonomy("program_types");
    if (types.length) PROGRAM_TYPES = types.map((t) => t.name);
    const cats = await listTaxonomy("program_categories");
    if (cats.length) PROGRAM_CATEGORIES = cats.map((c) => c.name);
  } catch { /* silent */ }
}

// Public API для server.js
const getProgramTypes = () => listTaxonomy("program_types");
const getProgramCategories = () => listTaxonomy("program_categories");
const createProgramType = (payload) => createTaxonomyItem("program_types", payload);
const updateProgramType = (id, patch) => updateTaxonomyItem("program_types", id, patch);
const deleteProgramType = (id) => deleteTaxonomyItem("program_types", id);
const createProgramCategory = (payload) => createTaxonomyItem("program_categories", payload);
const updateProgramCategory = (id, patch) => updateTaxonomyItem("program_categories", id, patch);
const deleteProgramCategory = (id) => deleteTaxonomyItem("program_categories", id);

module.exports = {
  addDealAction,
  addDocumentRequestAttachment,
  archiveClient,
  bulkBlockClientDeals,
  buildInitialCommentAction,
  buildStatusChangeAction,
  createBank,
  createClient,
  createDeal,
  confirmDocumentRequest,
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
  initStore,
  normalizeClient,
  normalizeDocumentRequest,
  normalizeDocumentRequestAttachment,
  removeDocumentRequestAttachment,
  setDocumentRequestOpenMessageId,
  addDocumentRequestPartialUploadMessageId,
  clearDocumentRequestPartialUploadMessageIds,
  setClientTelegramTopicId,
  normalizeManager,
  normalizeKnowledgeProgram,
  normalizeTask,
  validateDealDates,
  validateDocumentRequest,
  validateTask,
  updateDeal,
  markDealChecked,
  dealNeedsCheck,
  isDealCheckedToday,
  CHECKABLE_STAGES,
  updateKnowledgeProgram,
  updateManager,
  updateTask,
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
};
