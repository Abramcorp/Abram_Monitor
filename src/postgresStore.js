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
  },
  tasks: {
    file: path.join(DATA_DIR, "tasks.json"),
    table: "app_tasks"
  },
  users: {
    file: path.join(DATA_DIR, "users.json"),
    table: "app_users"
  },
  document_requests: {
    file: path.join(DATA_DIR, "document_requests.json"),
    table: "app_document_requests"
  },
  integrations: {
    file: path.join(DATA_DIR, "integrations.json"),
    table: "app_integrations"
  },
  integration_audit: {
    file: path.join(DATA_DIR, "integration_audit.json"),
    table: "app_integration_audit"
  },
  program_types: {
    file: path.join(DATA_DIR, "program_types.json"),
    table: "app_program_types"
  },
  program_categories: {
    file: path.join(DATA_DIR, "program_categories.json"),
    table: "app_program_categories"
  }
};
const KNOWLEDGE_FILE = path.join(DATA_DIR, "knowledge.json");
const KNOWLEDGE_TABLE = "app_knowledge_programs";

let pool = null;
let readyPromise = null;

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function getDatabaseUrl() {
  return firstEnv("DATABASE_URL", "DATABASE_PRIVATE_URL", "DATABASE_PUBLIC_URL", "POSTGRES_URL");
}

function hasPgVariableConfig() {
  return Boolean(process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD);
}

function isPersistentStoreRequired() {
  if (String(process.env.ALLOW_EPHEMERAL_STORE || "").toLowerCase() === "true") {
    return false;
  }
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
}

function isEnabled() {
  return Boolean(getConnectionConfig());
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

function getConnectionConfig() {
  const connectionString = getDatabaseUrl();
  if (connectionString) {
    return {
      connectionString,
      ssl: getSslConfig()
    };
  }
  if (!hasPgVariableConfig()) {
    return null;
  }
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: getSslConfig()
  };
}

function getPool() {
  const config = getConnectionConfig();
  if (!config) {
    throw new Error("PostgreSQL is not configured");
  }
  if (!pool) {
    let Pool;
    try {
      ({ Pool } = require("pg"));
    } catch (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        throw new Error("PostgreSQL mode requires the \"pg\" package. Run npm install before starting with database variables.");
      }
      throw error;
    }
    pool = new Pool(config);
  }
  return pool;
}

async function ensureReady({ normalizeDeal, normalizeKnowledgeEntries }) {
  if (!isEnabled()) {
    if (isPersistentStoreRequired()) {
      throw new Error(
        "Persistent PostgreSQL storage is required on Railway. Configure DATABASE_URL=${{Postgres.DATABASE_URL}} on the web service, or provide PGHOST/PGDATABASE/PGUSER/PGPASSWORD. Refusing to use ephemeral JSON storage."
      );
    }
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

        CREATE TABLE IF NOT EXISTS app_tasks (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS app_tasks_due_idx
          ON app_tasks ((data->>'dueAt'));

        CREATE INDEX IF NOT EXISTS app_tasks_client_idx
          ON app_tasks (lower(data->>'manager'), lower(data->>'client'));

        CREATE TABLE IF NOT EXISTS app_users (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS app_users_login_idx
          ON app_users (lower(data->>'login'));

        CREATE TABLE IF NOT EXISTS app_document_requests (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS app_document_requests_deal_idx
          ON app_document_requests ((data->>'dealId'));

        CREATE INDEX IF NOT EXISTS app_document_requests_manager_idx
          ON app_document_requests (lower(data->>'manager'));

        CREATE TABLE IF NOT EXISTS app_integrations (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS app_integration_audit (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS app_integration_audit_created_idx
          ON app_integration_audit (created_at DESC);

        CREATE TABLE IF NOT EXISTS app_program_types (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS app_program_types_name_idx
          ON app_program_types (lower(data->>'name'));

        CREATE TABLE IF NOT EXISTS app_program_categories (
          id text PRIMARY KEY,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS app_program_categories_name_idx
          ON app_program_categories (lower(data->>'name'));

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
      await seedCollection("tasks", readJson(COLLECTIONS.tasks.file, []));
      await seedCollection("document_requests", readJson(COLLECTIONS.document_requests.file, []));
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
  const result = await getPool().query(`SELECT data, created_at, updated_at FROM ${table} ORDER BY created_at, id`);
  return result.rows.map((row) => {
    const data = row.data || {};
    return {
      ...data,
      createdAt: data.createdAt || row.created_at?.toISOString?.() || "",
      updatedAt: data.updatedAt || row.updated_at?.toISOString?.() || ""
    };
  });
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

async function deleteTasksByClient(managerName, clientName) {
  const result = await getPool().query(
    `DELETE FROM app_tasks
     WHERE lower(data->>'manager') = lower($1)
       AND lower(data->>'client') = lower($2)
     RETURNING data`,
    [String(managerName || ""), String(clientName || "")]
  );
  return result.rows.map((row) => row.data);
}

async function deleteDocumentRequestsByDeal(dealId) {
  const result = await getPool().query(
    `DELETE FROM app_document_requests WHERE data->>'dealId' = $1 RETURNING data`,
    [String(dealId || "")]
  );
  return result.rows.map((row) => row.data);
}

async function deleteDocumentRequestsByClient(managerName, clientName) {
  const result = await getPool().query(
    `DELETE FROM app_document_requests
     WHERE lower(data->>'manager') = lower($1)
       AND lower(data->>'clientName') = lower($2)
     RETURNING data`,
    [String(managerName || ""), String(clientName || "")]
  );
  return result.rows.map((row) => row.data);
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
  getDatabaseUrl,
  isPersistentStoreRequired,
  insertKnowledgeProgram,
  insertRow,
  isEnabled,
  listKnowledge,
  listRows,
  deleteDocumentRequestsByClient,
  deleteDocumentRequestsByDeal,
  deleteRow,
  deleteTasksByClient,
  updateKnowledgeProgram,
  updateRow
};
