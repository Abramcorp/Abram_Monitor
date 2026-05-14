"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeDeal } = require("./analytics");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEALS_FILE = path.join(DATA_DIR, "deals.json");
const BANKS_FILE = path.join(DATA_DIR, "banks.json");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const KNOWLEDGE_FILE = path.join(DATA_DIR, "knowledge.json");

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

function getDeals() {
  return readJson(DEALS_FILE, []).map(normalizeDeal);
}

function saveDeals(deals) {
  writeJson(DEALS_FILE, deals.map(normalizeDeal));
}

function createDeal(payload) {
  const now = new Date().toISOString();
  const deal = normalizeDeal({
    ...payload,
    id: payload.id || `deal-${Date.now()}`,
    createdAt: payload.createdAt || now,
    updatedAt: now
  });
  const deals = getDeals();
  deals.push(deal);
  saveDeals(deals);
  return deal;
}

function updateDeal(id, patch) {
  const deals = getDeals();
  const index = deals.findIndex((deal) => deal.id === id);
  if (index === -1) {
    return null;
  }

  const next = normalizeDeal({
    ...deals[index],
    ...patch,
    id,
    updatedAt: new Date().toISOString()
  });

  deals[index] = next;
  saveDeals(deals);
  return next;
}

function getBanks() {
  return readJson(BANKS_FILE, []);
}

function createBank(payload) {
  const banks = getBanks();
  const bank = {
    id: payload.id || `bank-${Date.now()}`,
    name: String(payload.name || "").trim(),
    region: String(payload.region || "").trim(),
    programs: Array.isArray(payload.programs) ? payload.programs : []
  };

  if (!bank.name) {
    throw new Error("Bank name is required");
  }

  banks.push(bank);
  writeJson(BANKS_FILE, banks);
  return bank;
}

function getClients() {
  return readJson(CLIENTS_FILE, []);
}

function createClient(payload) {
  const clients = getClients();
  const client = {
    id: payload.id || `client-${Date.now()}`,
    name: String(payload.name || payload.client || "").trim(),
    manager: String(payload.manager || "").trim() || "Без менеджера",
    contact: String(payload.contact || "").trim(),
    phone: String(payload.phone || "").trim(),
    comment: String(payload.comment || "").trim()
  };

  if (!client.name) {
    throw new Error("Client name is required");
  }

  clients.push(client);
  writeJson(CLIENTS_FILE, clients);
  return client;
}

function getKnowledge() {
  return normalizeKnowledgeEntries(readJson(KNOWLEDGE_FILE, []));
}

function createKnowledgeEntry(payload) {
  const banks = getKnowledge();
  const now = new Date().toISOString();
  const bankName = cleanText(payload.bank);
  const program = normalizeKnowledgeProgram({
    id: payload.id || `kb-${Date.now()}`,
    program: payload.program || payload.topic,
    requirements: payload.requirements || payload,
    notes: payload.notes,
    updatedAt: now
  });

  if (!bankName || !program.program) {
    throw new Error("Bank and program are required");
  }

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

function normalizeKnowledgeProgram(raw = {}) {
  const requirements = raw.requirements && !Array.isArray(raw.requirements) ? raw.requirements : raw;
  const legacyRequirements = Array.isArray(raw.requirements) ? normalizeList(raw.requirements).join("\n") : "";
  const legacyDocuments = Array.isArray(raw.documents) ? normalizeList(raw.documents).join("\n") : normalizeRequirementText(raw.documents);

  return {
    id: cleanText(raw.id) || `kb-${Date.now()}`,
    program: cleanText(raw.program || raw.topic || raw.name),
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
  createBank,
  createClient,
  createDeal,
  createKnowledgeEntry,
  getBanks,
  getClients,
  getDeals,
  getKnowledge,
  updateDeal
};
