"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const postgresStore = require("../src/postgresStore");
const {
  buildInitialCommentAction,
  buildStatusChangeAction,
  initStore,
  normalizeClient,
  normalizeKnowledgeProgram,
  normalizeManager,
  validateDealDates
} = require("../src/store");

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test("validateDealDates requires inquiry date for lead applications", () => {
  assert.throws(
    () => validateDealDates({ stage: "lead" }),
    /Дата обращения обязательна/
  );
});

test("postgres store accepts Railway public database url", (context) => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousPublicUrl = process.env.DATABASE_PUBLIC_URL;
  const previousPrivateUrl = process.env.DATABASE_PRIVATE_URL;
  const previousPostgresUrl = process.env.POSTGRES_URL;

  context.after(() => {
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("DATABASE_PUBLIC_URL", previousPublicUrl);
    restoreEnv("DATABASE_PRIVATE_URL", previousPrivateUrl);
    restoreEnv("POSTGRES_URL", previousPostgresUrl);
  });

  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_PRIVATE_URL;
  delete process.env.POSTGRES_URL;
  process.env.DATABASE_PUBLIC_URL = "postgresql://user:pass@localhost:5432/app";

  assert.equal(postgresStore.getDatabaseUrl(), "postgresql://user:pass@localhost:5432/app");
  assert.equal(postgresStore.isEnabled(), true);
});

test("postgres store requires persistence on Railway unless explicitly allowed", (context) => {
  const previousRailwayEnvironment = process.env.RAILWAY_ENVIRONMENT;
  const previousAllowEphemeralStore = process.env.ALLOW_EPHEMERAL_STORE;

  context.after(() => {
    restoreEnv("RAILWAY_ENVIRONMENT", previousRailwayEnvironment);
    restoreEnv("ALLOW_EPHEMERAL_STORE", previousAllowEphemeralStore);
  });

  process.env.RAILWAY_ENVIRONMENT = "production";
  delete process.env.ALLOW_EPHEMERAL_STORE;
  assert.equal(postgresStore.isPersistentStoreRequired(), true);

  process.env.ALLOW_EPHEMERAL_STORE = "true";
  assert.equal(postgresStore.isPersistentStoreRequired(), false);
});

test("store refuses Railway startup without PostgreSQL variables", async (context) => {
  const names = [
    "DATABASE_URL",
    "DATABASE_PUBLIC_URL",
    "DATABASE_PRIVATE_URL",
    "POSTGRES_URL",
    "PGHOST",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "RAILWAY_ENVIRONMENT",
    "ALLOW_EPHEMERAL_STORE"
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  context.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      restoreEnv(name, value);
    }
  });

  for (const name of names) {
    delete process.env[name];
  }
  process.env.RAILWAY_ENVIRONMENT = "production";

  await assert.rejects(
    () => initStore(),
    /Persistent PostgreSQL storage is required on Railway/
  );
});

test("validateDealDates requires signed date for submitted applications", () => {
  assert.throws(
    () => validateDealDates({ stage: "submitted" }),
    /Дата подписания обязательна/
  );
});

test("validateDealDates keeps inquiry date mandatory from lead to submitted", () => {
  assert.throws(
    () => validateDealDates({ stage: "submitted", signedAt: "2026-05-14T10:00:00.000Z" }, { stage: "lead" }),
    /Дата обращения обязательна/
  );
});

test("buildStatusChangeAction records status transition for history", () => {
  const action = buildStatusChangeAction(
    { stage: "planned", stageLabel: "Плановая" },
    { stage: "lead", stageLabel: "Закинули лид" },
    "2026-05-15T09:30:00.000Z"
  );

  assert.equal(action.action, "Смена статуса: Плановая → Закинули лид");
  assert.equal(action.actionAt, "2026-05-15T09:30:00.000Z");
});

test("buildStatusChangeAction skips unchanged status", () => {
  assert.equal(
    buildStatusChangeAction(
      { stage: "planned", stageLabel: "Плановая" },
      { stage: "planned", stageLabel: "Плановая" },
      "2026-05-15T09:30:00.000Z"
    ),
    null
  );
});

test("buildInitialCommentAction records application creation comment", () => {
  const action = buildInitialCommentAction(
    { comment: "Клиент просит ускорить подачу" },
    "2026-05-16T12:00:00+03:00"
  );

  assert.equal(action.action, "Клиент просит ускорить подачу");
  assert.equal(action.actionAt, "2026-05-16T09:00:00.000Z");
});

test("buildInitialCommentAction skips empty application comments", () => {
  assert.equal(buildInitialCommentAction({ comment: "   " }, "2026-05-16T12:00:00+03:00"), null);
});

test("normalizeKnowledgeProgram keeps program type and amount range", () => {
  const program = normalizeKnowledgeProgram({
    program: "Оборотный",
    programType: "Экспресс",
    amountRange: "от 5 до 50 млн",
    documentation: "Анкета и выписка"
  });

  assert.equal(program.programType, "Экспресс");
  assert.equal(program.amountRange, "от 5 до 50 млн");
  assert.equal(program.requirements.documentation, "Анкета и выписка");
});

test("normalizeManager keeps the account card name", () => {
  const manager = normalizeManager({
    id: "manager-1",
    name: "Анна Орлова",
    createdAt: "2026-05-15T10:00:00.000Z",
    updatedAt: "2026-05-15T10:30:00.000Z"
  });

  assert.equal(manager.id, "manager-1");
  assert.equal(manager.name, "Анна Орлова");
  assert.equal(manager.createdAt, "2026-05-15T10:00:00.000Z");
  assert.equal(manager.updatedAt, "2026-05-15T10:30:00.000Z");
});

test("normalizeClient keeps client card dates when present", () => {
  const client = normalizeClient({
    id: "client-1",
    name: "ООО Архив",
    manager: "Анна Орлова",
    contact: "Иван",
    crmUrl: "https://crm.example/client-1",
    driveUrl: "https://drive.example/folder",
    instructionUrl: "https://docs.example/instruction",
    archivedAt: "2026-05-12T09:00:00+03:00",
    createdAt: "2026-05-10T10:00:00+03:00",
    updatedAt: "2026-05-11T12:30:00+03:00"
  });

  assert.equal(client.name, "ООО Архив");
  assert.equal(client.manager, "Анна Орлова");
  assert.equal(client.contact, "Иван");
  assert.equal(client.crmUrl, "https://crm.example/client-1");
  assert.equal(client.driveUrl, "https://drive.example/folder");
  assert.equal(client.instructionUrl, "https://docs.example/instruction");
  assert.equal(client.archivedAt, "2026-05-12T06:00:00.000Z");
  assert.equal(client.createdAt, "2026-05-10T07:00:00.000Z");
  assert.equal(client.updatedAt, "2026-05-11T09:30:00.000Z");
});
