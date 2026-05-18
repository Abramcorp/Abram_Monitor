"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeDeal } = require("./analytics");
const postgresStore = require("./postgresStore");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEALS_FILE = path.join(DATA_DIR, "deals.json");
const BANKS_FILE = path.join(DATA_DIR, "banks.json");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const KNOWLEDGE_FILE = path.join(DATA_DIR, "knowledge.json");
const MANAGERS_FILE = path.join(DATA_DIR, "managers.json");
const PROGRAM_TYPES = ["Экспресс", "Стандарт", "Физическое лицо", "Добивка"];

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

function toIsoDate(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
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

function validateDealDates(deal, previousDeal = null) {
  if (deal.stage === "lead" && !deal.inquiryAt) {
    throw new Error("Дата обращения обязательна для статуса \"Закинули лид\"");
  }
  if (deal.stage === "submitted" && !deal.signedAt) {
    throw new Error("Дата подписания обязательна для статуса \"Подписали заявку ждем решение\"");
  }
  if (previousDeal?.stage === "lead" && deal.stage === "submitted" && !deal.inquiryAt) {
    throw new Error("Дата обращения обязательна при переходе из статуса \"Закинули лид\"");
  }
}

function buildStatusChangeAction(previousDeal, nextDeal, actionAt) {
  if (previousDeal.stage === nextDeal.stage) {
    return null;
  }

  return {
    id: `action-status-${Date.now()}`,
    action: `Смена статуса: ${previousDeal.stageLabel} → ${nextDeal.stageLabel}`,
    actionAt
  };
}

function createDeal(payload) {
  const now = new Date().toISOString();
  const deal = normalizeDeal({
    ...payload,
    id: payload.id || `deal-${Date.now()}`,
    createdAt: payload.createdAt || now,
    updatedAt: now
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

function updateDeal(id, patch) {
  if (postgresStore.isEnabled()) {
    return updateDealPostgres(id, patch);
  }

  const deals = getDeals();
  const index = deals.findIndex((deal) => deal.id === id);
  if (index === -1) {
    return null;
  }

  const updatedAt = new Date().toISOString();
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
  const updated = await postgresStore.updateRow("deals", id, (rawDeal) => {
    const previous = normalizeDeal(rawDeal);
    const updatedAt = new Date().toISOString();
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

function addDealAction(id, payload) {
  if (postgresStore.isEnabled()) {
    return addDealActionPostgres(id, payload);
  }

  const deals = getDeals();
  const index = deals.findIndex((deal) => deal.id === id);
  if (index === -1) {
    return null;
  }

  const action = cleanText(payload.action || payload.comment);
  if (!action) {
    throw new Error("Действие или комментарий обязательны");
  }

  const actionAt = toIsoDate(payload.actionAt) || new Date().toISOString();
  const actionEntry = {
    id: payload.id || `action-${Date.now()}`,
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

  const actionAt = toIsoDate(payload.actionAt) || new Date().toISOString();
  const actionEntry = {
    id: payload.id || `action-${Date.now()}`,
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
    archivedAt,
    createdAt,
    updatedAt: updatedAt || createdAt
  };
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
    program: payload.program || payload.topic,
    programType: payload.programType,
    amountRange: payload.amountRange,
    requirements: payload.requirements || payload,
    notes: payload.notes,
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
  return PROGRAM_TYPES.includes(text) ? text : "Стандарт";
}

function normalizeKnowledgeProgram(raw = {}) {
  const requirements = raw.requirements && !Array.isArray(raw.requirements) ? raw.requirements : raw;
  const legacyRequirements = Array.isArray(raw.requirements) ? normalizeList(raw.requirements).join("\n") : "";
  const legacyDocuments = Array.isArray(raw.documents) ? normalizeList(raw.documents).join("\n") : normalizeRequirementText(raw.documents);

  return {
    id: cleanText(raw.id) || `kb-${Date.now()}`,
    program: cleanText(raw.program || raw.topic || raw.name),
    programType: normalizeProgramType(raw.programType || raw.type || raw.category),
    amountRange: cleanText(raw.amountRange || raw.amount || raw.limit || raw.sum),
    requirements: normalizeRequirements({
      ...requirements,
      documentation: requirements.documentation || legacyDocuments,
      revenue: requirements.revenue || legacyRequirements
    }),
    notes: cleanText(raw.notes),
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
        programs: [],
        updatedAt: cleanText(entry.updatedAt)
      });
    }

    const bank = bankMap.get(bankName.toLowerCase());
    const programs = Array.isArray(entry.programs) ? entry.programs : [entry];
    for (const rawProgram of programs) {
      const program = normalizeKnowledgeProgram(rawProgram);
      if (program.program) {
        bank.programs.push(program);
      }
    }
    bank.updatedAt = bank.updatedAt || bank.programs[0]?.updatedAt || "";
  }

  return Array.from(bankMap.values()).sort((left, right) => left.bank.localeCompare(right.bank, "ru"));
}

module.exports = {
  addDealAction,
  archiveClient,
  buildStatusChangeAction,
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
  initStore,
  normalizeClient,
  normalizeManager,
  normalizeKnowledgeProgram,
  validateDealDates,
  updateDeal,
  updateKnowledgeProgram
};
