"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "..", "data");
const COLLECTIONS = {
  banks: {
    file: path.join(DATA_DIR, "banks.json"),
    table: "app_banks"
  },
  clients: {
    file: path.join(DATA_DIR, "clients.json"),
    table: "app_clients"
  },
  deals: {
    file: path.join(DATA_DIR, "deals.json"),
    table: "app_deals"
  },
  managers: {
    file: path.join(DATA_DIR, "managers.json"),
    table: "app_managers"
  }
};
const KNOWLEDGE_FILE = path.join(DATA_DIR, "knowledge.json");
const KNOWLEDGE_TABLE = "app_knowledge_programs";

let pool = null;
let readyPromise = null;

function isEnabled() {
  return Boolean(process.env.DATABASE_URL);
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

function getSslConfig() {
  const mode = String(process.env.PGSSLMODE || process.env.POSTGRES_SSL || "").toLowerCase();
  if (!mode || mode === "disable" || mode === "false") {
    return undefined;
  }
  if (mode === "require" || mode === "no-verify" || mode === "true") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

function getPool() {
  if (!isEnabled()) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!pool) {
    let Pool;
    try {
      ({ Pool } = require("pg"));
    } catch (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        throw new Error("PostgreSQL mode requires the \"pg\" package. Run npm install before starting with DATABASE_URL.");
      }
      throw error;
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: getSslConfig()
    });
  }
  return pool;
}

async function ensureReady({ normalizeDeal, normalizeKnowledgeEntries }) {
  if (!isEnabled()) {
    return;
  }
  if (!readyPromise) {
    readyPromise = (async () => {
      const db = getPool();
      await db.query(`
        CREATE TABLE IF NOT EXISTS app_deals (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS app_clients (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS app_banks (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS app_managers (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS app_knowledge_programs (
          id text PRIMARY KEY,
          bank_id text NOT NULL,
          bank text NOT NULL,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS app_knowledge_programs_bank_idx
          ON app_knowledge_programs (lower(bank));
      `);

      await seedCollection("deals", readJson(COLLECTIONS.deals.file, []).map(normalizeDeal));
      await seedCollection("clients", readJson(COLLECTIONS.clients.file, []));
      await seedCollection("banks", readJson(COLLECTIONS.banks.file, []));
      await seedCollection("managers", readJson(COLLECTIONS.managers.file, []));
      await seedKnowledge(normalizeKnowledgeEntries(readJson(KNOWLEDGE_FILE, [])));
    })();
  }
  await readyPromise;
}

function getCollection(collection) {
  const config = COLLECTIONS[collection];
  if (!config) {
    throw new Error(`Unknown collection: ${collection}`);
  }
  return config;
}

async function seedCollection(collection, items) {
  const { table } = getCollection(collection);
  const db = getPool();
  const existing = await db.query(`SELECT count(*)::int AS count FROM ${table}`);
  if (existing.rows[0].count > 0) {
    return;
  }

  for (const item of items) {
    if (!item?.id) {
      continue;
    }
    await db.query(
      `INSERT INTO ${table} (id, data, created_at, updated_at)
       VALUES ($1, $2::jsonb, COALESCE($3::timestamptz, now()), COALESCE($4::timestamptz, now()))
       ON CONFLICT (id) DO NOTHING`,
      [item.id, JSON.stringify(item), item.createdAt || item.updatedAt || null, item.updatedAt || item.createdAt || null]
    );
  }
}

async function seedKnowledge(knowledge) {
  const db = getPool();
  const existing = await db.query(`SELECT count(*)::int AS count FROM ${KNOWLEDGE_TABLE}`);
  if (existing.rows[0].count > 0) {
    return;
  }

  for (const bank of knowledge) {
    for (const program of bank.programs || []) {
      if (!program?.id) {
        continue;
      }
      await db.query(
        `INSERT INTO ${KNOWLEDGE_TABLE} (id, bank_id, bank, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamptz, now()), COALESCE($6::timestamptz, now()))
         ON CONFLICT (id) DO NOTHING`,
        [
          program.id,
          bank.id || `bank-knowledge-${program.id}`,
          bank.bank,
          JSON.stringify(program),
          program.updatedAt || bank.updatedAt || null,
          program.updatedAt || bank.updatedAt || null
        ]
      );
    }
  }
}

async function listRows(collection) {
  const { table } = getCollection(collection);
  const result = await getPool().query(`SELECT data FROM ${table} ORDER BY created_at, id`);
  return result.rows.map((row) => row.data);
}

async function insertRow(collection, item) {
  const { table } = getCollection(collection);
  const result = await getPool().query(
    `INSERT INTO ${table} (id, data, created_at, updated_at)
     VALUES ($1, $2::jsonb, COALESCE($3::timestamptz, now()), COALESCE($4::timestamptz, now()))
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
     RETURNING data`,
    [item.id, JSON.stringify(item), item.createdAt || item.updatedAt || null, item.updatedAt || item.createdAt || null]
  );
  return result.rows[0].data;
}

async function updateRow(collection, id, buildNext) {
  const { table } = getCollection(collection);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(`SELECT data FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const next = await buildNext(current.rows[0].data);
    await client.query(
      `UPDATE ${table} SET data = $2::jsonb, updated_at = COALESCE($3::timestamptz, now()) WHERE id = $1`,
      [id, JSON.stringify(next), next.updatedAt || null]
    );
    await client.query("COMMIT");
    return next;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteRow(collection, id) {
  const { table } = getCollection(collection);
  const result = await getPool().query(`DELETE FROM ${table} WHERE id = $1 RETURNING data`, [id]);
  return result.rows[0]?.data || null;
}

async function listKnowledge() {
  const result = await getPool().query(
    `SELECT bank_id, bank, data, updated_at
     FROM ${KNOWLEDGE_TABLE}
     ORDER BY lower(bank), data->>'program', id`
  );
  const bankMap = new Map();

  for (const row of result.rows) {
    const key = row.bank.toLowerCase();
    if (!bankMap.has(key)) {
      bankMap.set(key, {
        id: row.bank_id,
        bank: row.bank,
        programs: [],
        updatedAt: row.updated_at?.toISOString?.() || ""
      });
    }
    const bank = bankMap.get(key);
    bank.programs.push(row.data);
    const rowUpdatedAt = row.updated_at?.toISOString?.() || "";
    if (rowUpdatedAt > bank.updatedAt) {
      bank.updatedAt = rowUpdatedAt;
    }
  }

  return Array.from(bankMap.values()).sort((left, right) => left.bank.localeCompare(right.bank, "ru"));
}

async function findKnowledgeBankId(bankName) {
  const result = await getPool().query(
    `SELECT bank_id FROM ${KNOWLEDGE_TABLE} WHERE lower(bank) = lower($1) LIMIT 1`,
    [bankName]
  );
  return result.rows[0]?.bank_id || `bank-knowledge-${Date.now()}`;
}

async function insertKnowledgeProgram(bankName, program) {
  const bankId = await findKnowledgeBankId(bankName);
  const result = await getPool().query(
    `INSERT INTO ${KNOWLEDGE_TABLE} (id, bank_id, bank, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamptz, now()), COALESCE($6::timestamptz, now()))
     ON CONFLICT (id) DO UPDATE SET bank_id = EXCLUDED.bank_id, bank = EXCLUDED.bank, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
     RETURNING bank, data`,
    [program.id, bankId, bankName, JSON.stringify(program), program.updatedAt || null, program.updatedAt || null]
  );
  return { bank: result.rows[0].bank, program: result.rows[0].data };
}

async function updateKnowledgeProgram(programId, buildNext) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT bank_id, bank, data FROM ${KNOWLEDGE_TABLE} WHERE id = $1 FOR UPDATE`,
      [programId]
    );
    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const next = await buildNext({
      bank: current.rows[0].bank,
      bankId: current.rows[0].bank_id,
      program: current.rows[0].data
    });
    const targetBankId = next.bank.toLowerCase() === current.rows[0].bank.toLowerCase()
      ? current.rows[0].bank_id
      : await findKnowledgeBankId(next.bank);

    await client.query(
      `UPDATE ${KNOWLEDGE_TABLE}
       SET bank_id = $2, bank = $3, data = $4::jsonb, updated_at = COALESCE($5::timestamptz, now())
       WHERE id = $1`,
      [programId, targetBankId, next.bank, JSON.stringify(next.program), next.program.updatedAt || null]
    );
    await client.query("COMMIT");
    return { bank: next.bank, program: next.program };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureReady,
  insertKnowledgeProgram,
  insertRow,
  isEnabled,
  listKnowledge,
  listRows,
  deleteRow,
  updateKnowledgeProgram,
  updateRow
};
