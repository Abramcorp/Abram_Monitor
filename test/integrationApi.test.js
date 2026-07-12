"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SERVICE_ROLE,
  auditDealQuality,
  authenticateServiceBearer,
  buildChangeSet,
  normalizeIdentityName,
  normalizeInn,
  normalizeCreditAnalysisBundle,
  normalizeCreditAnalysisDecision,
  normalizeProgramDiscovery,
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
  assert.deepEqual(
    [...parseServiceScopes("read,write_plan,admin,write_status,write_analytics")],
    ["read", "write_plan", "write_status", "write_analytics"]
  );
});

test("program discovery normalization keeps research separate and validates sources", () => {
  const item = normalizeProgramDiscovery({
    bank: "Точка",
    program: "Экспресс",
    sourceType: "official",
    sourceUrl: "https://tochka.com/credits/loan/#terms",
    officialUrl: "https://tochka.com/credits/loan/",
    status: "official_verified",
    confidence: "high",
    contentHash: "a".repeat(64),
    extracted: { maxAmountRub: 10_000_000 }
  });
  assert.equal(item.sourceUrl, "https://tochka.com/credits/loan/");
  assert.equal(item.status, "official_verified");
  assert.equal(item.extracted.maxAmountRub, 10_000_000);
  assert.throws(() => normalizeProgramDiscovery({ sourceType: "seo", sourceUrl: "file:///tmp/x" }), /http или https/);
  assert.throws(() => normalizeProgramDiscovery({ sourceType: "unknown", sourceUrl: "https://example.com" }), /sourceType/);
});

test("credit analysis bundle is owner-gated and model input contains no PII or CRM score", () => {
  const bundle = normalizeCreditAnalysisBundle({
    caseRef: "case-abc",
    identity: { inn: "770123456789", clientName: "ИП Тест", crmLeadRef: "42" },
    snapshot: { version: "client-fact-snapshot-v1", contentHash: "s".repeat(64), creditHistory: { factPackHash: "f".repeat(64) } },
    modelInput: { caseRef: "case-anonymous", creditHistory: { activeContractCount: 1 } },
    rules: { modelVersion: "borrower-rules-v2", grade: "B" },
    modelReview: { version: "credit-analyst-v1", grade: "B" },
    internalScoring: { grade: "C", score: 70 },
    conclusion: { version: "borrower-conclusion-v1", contentHash: "c".repeat(64), status: "owner_review", ownerText: "review" }
  });
  assert.equal(bundle.caseRef, "case-abc");
  assert.equal(bundle.identity.inn, "770123456789");
  assert.throws(() => normalizeCreditAnalysisBundle({ ...bundle, modelInput: { inn: "770123456789" } }), /PII/u);
  assert.throws(() => normalizeCreditAnalysisBundle({ ...bundle, conclusion: { ...bundle.conclusion, status: "approved" } }), /owner_review/u);
});

test("credit analysis conclusion decision accepts only explicit owner actions", () => {
  assert.deepEqual(normalizeCreditAnalysisDecision({ caseRef: "case-1", decision: "approve", actor: "Abram" }, "c".repeat(64)), {
    caseRef: "case-1", conclusionHash: "c".repeat(64), decision: "approve", actor: "Abram"
  });
  assert.throws(() => normalizeCreditAnalysisDecision({ caseRef: "case-1", decision: "send" }, "c".repeat(64)), /approve или reject/u);
});

test("INN normalization accepts legal entities and IP", () => {
  assert.equal(normalizeInn("77 1234 5678"), "7712345678");
  assert.equal(normalizeInn("123-456-789-012"), "123456789012");
  assert.throws(() => normalizeInn("123"), /10 или 12/);
});

test("identity names tolerate legal-form and punctuation differences", () => {
  assert.equal(normalizeIdentityName("ИП Иванов Иван Иванович"), "иванов иван иванович");
  assert.equal(normalizeIdentityName("Индивидуальный предприниматель Иванов Иван Иванович"), "иванов иван иванович");
  assert.notEqual(normalizeIdentityName("Иванов Иван"), normalizeIdentityName("Иванов Илья"));
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

test("quality audit requires stable client identity before learning", () => {
  const incomplete = auditDealQuality({
    id: "deal-legacy",
    stage: "approved",
    amountApproved: 3_000_000,
    knowledgeProgramId: "program-1"
  });
  assert.equal(incomplete.errors.length, 0);
  assert.equal(incomplete.learnable, false);

  const linked = auditDealQuality({
    id: "deal-linked",
    clientId: "client-1",
    inn: "123456789012",
    crmLeadId: "42",
    stage: "approved",
    amountApproved: 3_000_000,
    knowledgeProgramId: "program-1"
  });
  assert.equal(linked.learnable, true);
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
