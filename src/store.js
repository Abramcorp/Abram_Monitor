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
  return readJson(KNOWLEDGE_FILE, []);
}

function createKnowledgeEntry(payload) {
  const entries = getKnowledge();
  const now = new Date().toISOString();
  const entry = {
    id: payload.id || `kb-${Date.now()}`,
    bank: String(payload.bank || "").trim(),
    topic: String(payload.topic || "").trim(),
    requirements: normalizeList(payload.requirements),
    documents: normalizeList(payload.documents),
    notes: String(payload.notes || "").trim(),
    updatedAt: now
  };

  if (!entry.bank || !entry.topic) {
    throw new Error("Bank and topic are required");
  }

  entries.push(entry);
  writeJson(KNOWLEDGE_FILE, entries);
  return entry;
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
