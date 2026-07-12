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

        CREATE SCHEMA IF NOT EXISTS credit_analytics;

        CREATE TABLE IF NOT EXISTS credit_analytics.program_discoveries (
          id text PRIMARY KEY,
          bank text NOT NULL DEFAULT '',
          program text NOT NULL DEFAULT '',
          source_type text NOT NULL,
          source_url text NOT NULL,
          official_url text NOT NULL DEFAULT '',
          status text NOT NULL DEFAULT 'discovered',
          confidence text NOT NULL DEFAULT 'low',
          first_seen_at timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now(),
          official_verified_at timestamptz,
          current_snapshot_hash text NOT NULL DEFAULT '',
          details jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS credit_analytics_program_discoveries_url_idx
          ON credit_analytics.program_discoveries (source_url);
        CREATE INDEX IF NOT EXISTS credit_analytics_program_discoveries_status_idx
          ON credit_analytics.program_discoveries (status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS credit_analytics.program_discovery_snapshots (
          id bigserial PRIMARY KEY,
          discovery_id text NOT NULL REFERENCES credit_analytics.program_discoveries(id) ON DELETE CASCADE,
          content_hash text NOT NULL,
          captured_at timestamptz NOT NULL DEFAULT now(),
          title text NOT NULL DEFAULT '',
          snippet text NOT NULL DEFAULT '',
          extracted jsonb NOT NULL DEFAULT '{}'::jsonb,
          UNIQUE(discovery_id, content_hash)
        );

        CREATE INDEX IF NOT EXISTS credit_analytics_program_snapshots_captured_idx
          ON credit_analytics.program_discovery_snapshots (captured_at DESC);

        CREATE TABLE IF NOT EXISTS credit_analytics.client_cases (
          case_ref text PRIMARY KEY,
          inn text NOT NULL DEFAULT '',
          client_name text NOT NULL DEFAULT '',
          crm_lead_ref text NOT NULL DEFAULT '',
          responsible text NOT NULL DEFAULT '',
          partner text NOT NULL DEFAULT '',
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS credit_analytics.client_fact_snapshots (
          id bigserial PRIMARY KEY,
          case_ref text NOT NULL REFERENCES credit_analytics.client_cases(case_ref) ON DELETE CASCADE,
          snapshot_hash text NOT NULL,
          snapshot_version text NOT NULL,
          fact_pack_hash text NOT NULL,
          payload jsonb NOT NULL,
          model_input jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(case_ref, snapshot_hash)
        );

        CREATE TABLE IF NOT EXISTS credit_analytics.borrower_rule_assessments (
          id bigserial PRIMARY KEY,
          case_ref text NOT NULL REFERENCES credit_analytics.client_cases(case_ref) ON DELETE CASCADE,
          snapshot_hash text NOT NULL,
          content_hash text NOT NULL,
          rules_version text NOT NULL,
          payload jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(case_ref, snapshot_hash, content_hash)
        );

        CREATE TABLE IF NOT EXISTS credit_analytics.borrower_model_reviews (
          id bigserial PRIMARY KEY,
          case_ref text NOT NULL REFERENCES credit_analytics.client_cases(case_ref) ON DELETE CASCADE,
          snapshot_hash text NOT NULL,
          content_hash text NOT NULL,
          review_version text NOT NULL,
          model_name text NOT NULL DEFAULT '',
          model_ok boolean NOT NULL DEFAULT false,
          payload jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(case_ref, snapshot_hash, content_hash)
        );

        CREATE TABLE IF NOT EXISTS credit_analytics.internal_scoring_snapshots (
          id bigserial PRIMARY KEY,
          case_ref text NOT NULL REFERENCES credit_analytics.client_cases(case_ref) ON DELETE CASCADE,
          content_hash text NOT NULL,
          payload jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(case_ref, content_hash)
        );

        CREATE TABLE IF NOT EXISTS credit_analytics.borrower_conclusions (
          id bigserial PRIMARY KEY,
          case_ref text NOT NULL REFERENCES credit_analytics.client_cases(case_ref) ON DELETE CASCADE,
          snapshot_hash text NOT NULL,
          conclusion_hash text NOT NULL,
          conclusion_version text NOT NULL,
          status text NOT NULL DEFAULT 'owner_review',
          payload jsonb NOT NULL,
          owner_text text NOT NULL,
          crm_text text NOT NULL DEFAULT '',
          agent_text text NOT NULL DEFAULT '',
          approved_at timestamptz,
          approved_by text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(case_ref, conclusion_hash)
        );

        CREATE TABLE IF NOT EXISTS credit_analytics.analysis_audit_events (
          id bigserial PRIMARY KEY,
          case_ref text NOT NULL DEFAULT '',
          event_type text NOT NULL,
          request_hash text NOT NULL DEFAULT '',
          details jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS credit_analytics_snapshots_case_idx ON credit_analytics.client_fact_snapshots(case_ref, created_at DESC);
        CREATE INDEX IF NOT EXISTS credit_analytics_conclusions_status_idx ON credit_analytics.borrower_conclusions(status, created_at DESC);
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

async function listProgramDiscoveries({ status = "", limit = 200 } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const params = [];
  let where = "";
  if (String(status || "").trim()) {
    params.push(String(status).trim());
    where = `WHERE d.status = $${params.length}`;
  }
  params.push(safeLimit);
  const result = await getPool().query(
    `SELECT d.*, COALESCE(s.snapshot_count, 0)::int AS snapshot_count
     FROM credit_analytics.program_discoveries d
     LEFT JOIN (
       SELECT discovery_id, count(*) AS snapshot_count
       FROM credit_analytics.program_discovery_snapshots
       GROUP BY discovery_id
     ) s ON s.discovery_id = d.id
     ${where}
     ORDER BY d.updated_at DESC, d.id
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map((row) => ({
    id: row.id,
    bank: row.bank,
    program: row.program,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    officialUrl: row.official_url,
    status: row.status,
    confidence: row.confidence,
    firstSeenAt: row.first_seen_at?.toISOString?.() || "",
    lastSeenAt: row.last_seen_at?.toISOString?.() || "",
    officialVerifiedAt: row.official_verified_at?.toISOString?.() || "",
    currentSnapshotHash: row.current_snapshot_hash,
    details: row.details || {},
    snapshotCount: Number(row.snapshot_count || 0)
  }));
}

async function upsertProgramDiscovery(item) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const now = item.seenAt || new Date().toISOString();
    const officialVerifiedAt = item.status === "official_verified" ? (item.officialVerifiedAt || now) : null;
    const result = await client.query(
      `INSERT INTO credit_analytics.program_discoveries (
         id, bank, program, source_type, source_url, official_url, status,
         confidence, first_seen_at, last_seen_at, official_verified_at,
         current_snapshot_hash, details, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         COALESCE($9::timestamptz, now()), COALESCE($9::timestamptz, now()),
         $10::timestamptz, $11, $12::jsonb, now(), now()
       )
       ON CONFLICT (source_url) DO UPDATE SET
         bank = CASE WHEN EXCLUDED.bank <> '' THEN EXCLUDED.bank ELSE credit_analytics.program_discoveries.bank END,
         program = CASE WHEN EXCLUDED.program <> '' THEN EXCLUDED.program ELSE credit_analytics.program_discoveries.program END,
         source_type = EXCLUDED.source_type,
         official_url = CASE WHEN EXCLUDED.official_url <> '' THEN EXCLUDED.official_url ELSE credit_analytics.program_discoveries.official_url END,
         status = EXCLUDED.status,
         confidence = EXCLUDED.confidence,
         last_seen_at = EXCLUDED.last_seen_at,
         official_verified_at = COALESCE(EXCLUDED.official_verified_at, credit_analytics.program_discoveries.official_verified_at),
         current_snapshot_hash = CASE WHEN EXCLUDED.current_snapshot_hash <> '' THEN EXCLUDED.current_snapshot_hash ELSE credit_analytics.program_discoveries.current_snapshot_hash END,
         details = EXCLUDED.details,
         updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        item.id,
        item.bank,
        item.program,
        item.sourceType,
        item.sourceUrl,
        item.officialUrl,
        item.status,
        item.confidence,
        now,
        officialVerifiedAt,
        item.contentHash,
        JSON.stringify(item.details || {})
      ]
    );
    const discoveryId = result.rows[0].id;
    let snapshotInserted = false;
    if (item.contentHash) {
      const snapshot = await client.query(
        `INSERT INTO credit_analytics.program_discovery_snapshots (
           discovery_id, content_hash, captured_at, title, snippet, extracted
         ) VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6::jsonb)
         ON CONFLICT (discovery_id, content_hash) DO NOTHING
         RETURNING id`,
        [
          discoveryId,
          item.contentHash,
          now,
          item.title || "",
          item.snippet || "",
          JSON.stringify(item.extracted || {})
        ]
      );
      snapshotInserted = snapshot.rowCount > 0;
    }
    await client.query("COMMIT");
    return { id: discoveryId, inserted: Boolean(result.rows[0].inserted), snapshotInserted };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertCreditAnalysisBundle(bundle) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const identity = bundle.identity || {};
    await client.query(
      `INSERT INTO credit_analytics.client_cases(case_ref, inn, client_name, crm_lead_ref, responsible, partner, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT(case_ref) DO UPDATE SET
         inn = CASE WHEN EXCLUDED.inn <> '' THEN EXCLUDED.inn ELSE credit_analytics.client_cases.inn END,
         client_name = CASE WHEN EXCLUDED.client_name <> '' THEN EXCLUDED.client_name ELSE credit_analytics.client_cases.client_name END,
         crm_lead_ref = CASE WHEN EXCLUDED.crm_lead_ref <> '' THEN EXCLUDED.crm_lead_ref ELSE credit_analytics.client_cases.crm_lead_ref END,
         responsible = CASE WHEN EXCLUDED.responsible <> '' THEN EXCLUDED.responsible ELSE credit_analytics.client_cases.responsible END,
         partner = CASE WHEN EXCLUDED.partner <> '' THEN EXCLUDED.partner ELSE credit_analytics.client_cases.partner END,
         updated_at = now()`,
      [bundle.caseRef, identity.inn || "", identity.clientName || "", identity.crmLeadRef || "", identity.responsible || "", identity.partner || ""]
    );
    const snapshot = bundle.snapshot;
    await client.query(
      `INSERT INTO credit_analytics.client_fact_snapshots(case_ref, snapshot_hash, snapshot_version, fact_pack_hash, payload, model_input)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT(case_ref, snapshot_hash) DO NOTHING`,
      [bundle.caseRef, snapshot.contentHash, snapshot.version, snapshot.creditHistory?.factPackHash || "", JSON.stringify(snapshot), JSON.stringify(bundle.modelInput || {})]
    );
    const rules = bundle.rules;
    await client.query(
      `INSERT INTO credit_analytics.borrower_rule_assessments(case_ref, snapshot_hash, content_hash, rules_version, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT(case_ref, snapshot_hash, content_hash) DO NOTHING`,
      [bundle.caseRef, snapshot.contentHash, bundle.ruleHash, rules.modelVersion || rules.version || "", JSON.stringify(rules)]
    );
    const review = bundle.modelReview;
    await client.query(
      `INSERT INTO credit_analytics.borrower_model_reviews(case_ref, snapshot_hash, content_hash, review_version, model_name, model_ok, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT(case_ref, snapshot_hash, content_hash) DO NOTHING`,
      [bundle.caseRef, snapshot.contentHash, bundle.modelReviewHash, review.version || "", review.model || "", Boolean(review.modelOk), JSON.stringify(review)]
    );
    if (bundle.internalScoring) {
      await client.query(
        `INSERT INTO credit_analytics.internal_scoring_snapshots(case_ref, content_hash, payload)
         VALUES ($1, $2, $3::jsonb) ON CONFLICT(case_ref, content_hash) DO NOTHING`,
        [bundle.caseRef, bundle.internalScoringHash, JSON.stringify(bundle.internalScoring)]
      );
    }
    const conclusion = bundle.conclusion;
    await client.query(
      `INSERT INTO credit_analytics.borrower_conclusions(case_ref, snapshot_hash, conclusion_hash, conclusion_version, status, payload, owner_text, crm_text, agent_text)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       ON CONFLICT(case_ref, conclusion_hash) DO NOTHING`,
      [bundle.caseRef, snapshot.contentHash, conclusion.contentHash, conclusion.version || "", conclusion.status || "owner_review", JSON.stringify(conclusion), conclusion.ownerText || "", conclusion.crmText || "", conclusion.agentText || ""]
    );
    await client.query(
      `INSERT INTO credit_analytics.analysis_audit_events(case_ref, event_type, request_hash, details)
       VALUES ($1, 'analysis_bundle_upsert', $2, $3::jsonb)`,
      [bundle.caseRef, bundle.requestHash || "", JSON.stringify({ snapshotHash: snapshot.contentHash, conclusionHash: conclusion.contentHash, status: conclusion.status || "owner_review" })]
    );
    await client.query("COMMIT");
    return { caseRef: bundle.caseRef, snapshotHash: snapshot.contentHash, conclusionHash: conclusion.contentHash, status: conclusion.status || "owner_review" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function decideCreditAnalysisConclusion({ caseRef, conclusionHash, decision, actor }) {
  const status = decision === "approve" ? "approved" : "rejected";
  const result = await getPool().query(
    `UPDATE credit_analytics.borrower_conclusions
     SET status = $1, approved_at = now(), approved_by = $2
     WHERE case_ref = $3 AND conclusion_hash = $4 AND status = 'owner_review'
     RETURNING case_ref, conclusion_hash, status, approved_at, approved_by`,
    [status, actor, caseRef, conclusionHash]
  );
  if (!result.rowCount) {
    const current = await getPool().query(
      `SELECT case_ref, conclusion_hash, status, approved_at, approved_by
       FROM credit_analytics.borrower_conclusions WHERE case_ref = $1 AND conclusion_hash = $2`,
      [caseRef, conclusionHash]
    );
    if (!current.rowCount) throw new Error("Заключение не найдено");
    return current.rows[0];
  }
  return result.rows[0];
}

module.exports = {
  ensureReady,
  getDatabaseUrl,
  isPersistentStoreRequired,
  insertKnowledgeProgram,
  insertRow,
  isEnabled,
  listKnowledge,
  listProgramDiscoveries,
  listRows,
  deleteDocumentRequestsByClient,
  deleteDocumentRequestsByDeal,
  deleteRow,
  deleteTasksByClient,
  updateKnowledgeProgram,
  upsertProgramDiscovery,
  upsertCreditAnalysisBundle,
  decideCreditAnalysisConclusion,
  updateRow
};
