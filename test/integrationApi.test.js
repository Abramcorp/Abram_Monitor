"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SERVICE_ROLE,
  auditDealQuality,
  authenticateServiceBearer,
  buildChangeSet,
  normalizeInn,
  parseServiceScopes,
  requestHash,
  summarizeQuality,
  validateIntegrationDecision
} = require("../src/integrationApi");

test("service bearer uses a dedicated role and read-only default", () => {
  const key = "correct-secret-at-least-32-characters";
  const auth = authenticateServiceBearer(key, {
    ABRAM_MONITOR_JARVIS_API_KEY: key
  });
  assert.equal(auth.user.role, SERVICE_ROLE);
  assert.deepEqual([...auth.scopes], ["read"]);
  assert.equal(authenticateServiceBearer("wrong", { ABRAM_MONITOR_JARVIS_API_KEY: key }), null);
  assert.equal(authenticateServiceBearer("short", { ABRAM_MONITOR_JARVIS_API_KEY: "short" }), null);
});

test("service scopes ignore unknown permissions", () => {
  assert.deepEqual([...parseServiceScopes("read,write_plan,admin,write_status")], ["read", "write_plan", "write_status"]);
});

test("INN normalization accepts legal entities and IP", () => {
  assert.equal(normalizeInn("77 1234 5678"), "7712345678");
  assert.equal(normalizeInn("123-456-789-012"), "123456789012");
  assert.throws(() => normalizeInn("123"), /10 или 12/);
});

test("request hash is stable across object key order", () => {
  assert.equal(requestHash({ a: 1, b: 2 }), requestHash({ b: 2, a: 1 }));
});

test("decision validation keeps approved and refusal facts consistent", () => {
  assert.deepEqual(
    validateIntegrationDecision({ stage: "approved", amountApproved: 3_000_000, decisionType: "conditional", conditions: ["Открыть счёт"] }),
    {
      stage: "approved",
      amountApproved: 3_000_000,
      decisionType: "conditional",
      refusalReasonCode: "",
      conditions: ["Открыть счёт"]
    }
  );
  assert.throws(() => validateIntegrationDecision({ stage: "rejected", amountApproved: 1 }), /только в статусе approved/);
  assert.throws(() => validateIntegrationDecision({ stage: "rejected", amountApproved: 0 }), /refusalReasonCode/);
});

test("quality audit quarantines contradictory outcomes", () => {
  const dirty = auditDealQuality({
    id: "deal-1",
    stage: "rejected",
    amountApproved: 1_000_000,
    knowledgeProgramId: "program-1"
  });
  assert.equal(dirty.learnable, false);
  assert.ok(dirty.errors.includes("approved_amount_on_non_approved_stage"));
  const summary = summarizeQuality([{ id: "deal-1", stage: "rejected", amountApproved: 1_000_000 }]);
  assert.equal(summary.issueCounts.approved_amount_on_non_approved_stage, 1);
});

test("change set supports full snapshot and ISO cursor", () => {
  const full = buildChangeSet({
    clients: [{ id: "c1", updatedAt: "" }],
    deals: [{ id: "d1", updatedAt: "2026-07-11T10:00:00.000Z" }],
    knowledge: [{ id: "b1", bank: "Банк", updatedAt: "2026-07-11T10:00:00.000Z", programs: [{ id: "p1" }] }],
    documentRequests: [],
    snapshotAt: "2026-07-11T12:00:00.000Z"
  });
  assert.equal(full.clients.length, 1);
  assert.equal(full.knowledgePrograms[0].id, "p1");

  const delta = buildChangeSet({
    clients: [],
    deals: [
      { id: "old", updatedAt: "2026-07-11T09:00:00.000Z" },
      { id: "new", updatedAt: "2026-07-11T11:00:00.000Z" }
    ],
    knowledge: [],
    documentRequests: [],
    updatedSince: "2026-07-11T10:00:00.000Z",
    snapshotAt: "2026-07-11T12:00:00.000Z"
  });
  assert.deepEqual(delta.deals.map((deal) => deal.id), ["new"]);
});
