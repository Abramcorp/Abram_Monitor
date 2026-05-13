"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeDeal } = require("./analytics");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEALS_FILE = path.join(DATA_DIR, "deals.json");
const BANKS_FILE = path.join(DATA_DIR, "banks.json");

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

module.exports = {
  createBank,
  createDeal,
  getBanks,
  getDeals,
  updateDeal
};
