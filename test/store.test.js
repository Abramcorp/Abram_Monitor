"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStatusChangeAction, normalizeClient, normalizeKnowledgeProgram, normalizeManager, validateDealDates } = require("../src/store");

test("validateDealDates requires inquiry date for lead applications", () => {
  assert.throws(
    () => validateDealDates({ stage: "lead" }),
    /Дата обращения обязательна/
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
    createdAt: "2026-05-10T10:00:00+03:00",
    updatedAt: "2026-05-11T12:30:00+03:00"
  });

  assert.equal(client.name, "ООО Архив");
  assert.equal(client.manager, "Анна Орлова");
  assert.equal(client.contact, "Иван");
  assert.equal(client.createdAt, "2026-05-10T07:00:00.000Z");
  assert.equal(client.updatedAt, "2026-05-11T09:30:00.000Z");
});
