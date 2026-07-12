"use strict";

const crypto = require("node:crypto");

const SERVICE_ROLE = "service_analytics";
const VALID_SCOPES = new Set(["read", "write_plan", "write_status", "write_analytics"]);
const PROGRAM_DISCOVERY_STATUSES = new Set([
  "discovered",
  "official_verified",
  "hypothesis",
  "pilot",
  "rejected",
  "stale"
]);
const PROGRAM_DISCOVERY_SOURCE_TYPES = new Set(["official", "advertising", "seo", "aggregator", "manual"]);
const NEGATIVE_STAGES = new Set(["rejected", "blocked"]);
const TERMINAL_STAGES = new Set(["approved", "rejected", "blocked"]);
const KNOWN_STAGES = new Set([
  "planned",
  "lead",
  "documents_requested",
  "submitted",
  "approved",
  "rejected",
  "blocked"
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseServiceScopes(value) {
  const scopes = new Set(
    cleanText(value || "read")
      .split(/[\s,]+/)
      .map((scope) => scope.trim().toLowerCase())
      .filter((scope) => VALID_SCOPES.has(scope))
  );
  if (!scopes.size) scopes.add("read");
  return scopes;
}

function serviceApiKey(env = process.env) {
  const key = cleanText(env.ABRAM_MONITOR_JARVIS_API_KEY || env.JARVIS_ANALYTICS_API_KEY);
  return key.length >= 32 ? key : "";
}

function authenticateServiceBearer(token, env = process.env) {
  const expected = serviceApiKey(env);
  if (!expected || !secureEqual(token, expected)) return null;
  const scopes = parseServiceScopes(env.ABRAM_MONITOR_JARVIS_SCOPES || env.JARVIS_ANALYTICS_API_SCOPES);
  return {
    user: {
      id: "service-jarvis-analytics",
      login: "jarvis-analytics",
      fullName: "Jarvis Analytics",
      role: SERVICE_ROLE
    },
    scopes
  };
}

function normalizeInn(value) {
  const inn = cleanText(value).replace(/\D/g, "");
  if (inn && !/^\d{10}(?:\d{2})?$/.test(inn)) {
    throw new Error("ИНН должен содержать 10 или 12 цифр");
  }
  return inn;
}

function normalizeIdentityName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/^индивидуальный\s+предприниматель\s+/u, "")
    .replace(/^ип\s+/u, "")
    .replace(/[^a-zа-я0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(value) {
  return sha256(canonicalJson(value));
}

function normalizeConditions(value) {
  const input = Array.isArray(value) ? value : cleanText(value) ? [value] : [];
  return input.map(cleanText).filter(Boolean).slice(0, 20);
}

function normalizeHttpUrl(value, fieldName = "URL") {
  const raw = cleanText(value);
  if (!raw) return "";
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${fieldName} должен быть корректным URL`); }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error(`${fieldName} должен использовать http или https`);
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeProgramDiscovery(payload = {}, previous = {}) {
  const sourceUrl = normalizeHttpUrl(
    payload.sourceUrl === undefined ? previous.sourceUrl : payload.sourceUrl,
    "sourceUrl"
  );
  if (!sourceUrl) throw new Error("sourceUrl обязателен");
  const officialUrl = normalizeHttpUrl(
    payload.officialUrl === undefined ? previous.officialUrl : payload.officialUrl,
    "officialUrl"
  );
  const sourceType = cleanText(payload.sourceType === undefined ? previous.sourceType : payload.sourceType).toLowerCase();
  if (!PROGRAM_DISCOVERY_SOURCE_TYPES.has(sourceType)) throw new Error("Неизвестный sourceType");
  const status = cleanText(payload.status === undefined ? previous.status : payload.status).toLowerCase() || "discovered";
  if (!PROGRAM_DISCOVERY_STATUSES.has(status)) throw new Error("Неизвестный статус кандидата программы");
  const confidence = cleanText(payload.confidence === undefined ? previous.confidence : payload.confidence).toLowerCase() || "low";
  if (!["low", "medium", "high"].includes(confidence)) throw new Error("confidence должен быть low, medium или high");
  const bank = cleanText(payload.bank === undefined ? previous.bank : payload.bank).slice(0, 160);
  const program = cleanText(payload.program === undefined ? previous.program : payload.program).slice(0, 200);
  const title = cleanText(payload.title === undefined ? previous.title : payload.title).slice(0, 300);
  const snippet = cleanText(payload.snippet === undefined ? previous.snippet : payload.snippet).slice(0, 2000);
  const contentHash = cleanText(payload.contentHash === undefined ? previous.contentHash : payload.contentHash).toLowerCase();
  if (contentHash && !/^[a-f0-9]{64}$/u.test(contentHash)) throw new Error("contentHash должен быть SHA-256");
  const extracted = payload.extracted === undefined ? (previous.extracted || {}) : payload.extracted;
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
    throw new Error("extracted должен быть объектом");
  }
  return {
    bank,
    program,
    sourceType,
    sourceUrl,
    officialUrl,
    status,
    confidence,
    title,
    snippet,
    contentHash,
    extracted
  };
}

function normalizeCreditAnalysisBundle(payload = {}) {
  const caseRef = cleanText(payload.caseRef);
  if (!caseRef) throw new Error("caseRef обязателен");
  const snapshot = objectValue(payload.snapshot, "snapshot");
  const modelInput = objectValue(payload.modelInput, "modelInput");
  const rules = objectValue(payload.rules, "rules");
  const modelReview = objectValue(payload.modelReview, "modelReview");
  const conclusion = objectValue(payload.conclusion, "conclusion");
  if (!cleanText(snapshot.version) || !cleanText(snapshot.contentHash)) throw new Error("snapshot version/contentHash обязательны");
  if (!cleanText(conclusion.version) || !cleanText(conclusion.contentHash)) throw new Error("conclusion version/contentHash обязательны");
  if (cleanText(conclusion.status) !== "owner_review") throw new Error("новое заключение должно начинаться со статуса owner_review");
  const modelSerialized = JSON.stringify(modelInput);
  if (/"(?:inn|clientName|phone|passport|account|operational|internalScoring|internal_scoring)"\s*:/u.test(modelSerialized)) {
    throw new Error("modelInput содержит PII, operational context или internal scoring");
  }
  const conclusionSerialized = JSON.stringify(conclusion);
  if (/"(?:sendToWhatsapp|send_to_whatsapp|moveCrmStage|move_crm_stage)"\s*:/u.test(conclusionSerialized)) {
    throw new Error("conclusion содержит запрещённую команду побочного действия");
  }
  return {
    caseRef,
    identity: {
      inn: normalizeInn(payload.identity?.inn || ""),
      clientName: cleanText(payload.identity?.clientName),
      crmLeadRef: cleanText(payload.identity?.crmLeadRef),
      responsible: cleanText(payload.identity?.responsible),
      partner: cleanText(payload.identity?.partner)
    },
    snapshot,
    modelInput,
    rules,
    ruleHash: cleanText(payload.ruleHash) || requestHash(rules),
    modelReview,
    modelReviewHash: cleanText(payload.modelReviewHash) || requestHash(modelReview),
    internalScoring: payload.internalScoring ? objectValue(payload.internalScoring, "internalScoring") : null,
    internalScoringHash: payload.internalScoring ? (cleanText(payload.internalScoringHash) || requestHash(payload.internalScoring)) : "",
    conclusion,
    requestHash: requestHash({ caseRef, snapshotHash: snapshot.contentHash, conclusionHash: conclusion.contentHash })
  };
}

function objectValue(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} должен быть объектом`);
  return value;
}

function validateIntegrationDecision(payload = {}, previous = {}) {
  const stage = cleanText(payload.stage === undefined ? previous.stage : payload.stage).toLowerCase();
  const amountApproved = Number(payload.amountApproved === undefined ? previous.amountApproved : payload.amountApproved) || 0;
  const decisionType = cleanText(payload.decisionType === undefined ? previous.decisionType : payload.decisionType).toLowerCase();
  const refusalReasonCode = cleanText(
    payload.refusalReasonCode === undefined ? previous.refusalReasonCode : payload.refusalReasonCode
  ).toLowerCase();

  if (!KNOWN_STAGES.has(stage)) throw new Error("Неизвестный статус заявки");
  if (stage === "approved" && amountApproved <= 0) throw new Error("Для одобрения нужна положительная сумма");
  if (stage !== "approved" && amountApproved > 0) throw new Error("Сумма одобрения допустима только в статусе approved");
  if (NEGATIVE_STAGES.has(stage) && !refusalReasonCode) {
    throw new Error("Для отказа или блокировки нужен refusalReasonCode");
  }
  if (decisionType && !["final", "conditional"].includes(decisionType)) {
    throw new Error("decisionType должен быть final или conditional");
  }
  if (decisionType === "conditional" && stage !== "approved") {
    throw new Error("Условное решение допустимо только в статусе approved");
  }
  return {
    stage,
    amountApproved,
    decisionType,
    refusalReasonCode,
    conditions: normalizeConditions(payload.conditions === undefined ? previous.conditions : payload.conditions)
  };
}

function auditDealQuality(deal = {}) {
  const errors = [];
  const warnings = [];
  const stage = cleanText(deal.stage).toLowerCase();
  const amountApproved = Number(deal.amountApproved || 0);
  if (!deal.id) errors.push("missing_deal_id");
  if (!KNOWN_STAGES.has(stage)) errors.push("unknown_stage");
  if (stage === "approved" && amountApproved <= 0) errors.push("approved_without_amount");
  if (stage !== "approved" && amountApproved > 0) errors.push("approved_amount_on_non_approved_stage");
  if ((stage === "lead" || stage === "documents_requested") && !deal.inquiryAt) errors.push("lead_without_inquiry_date");
  if (stage === "submitted" && !deal.signedAt) errors.push("submitted_without_signed_date");
  if (NEGATIVE_STAGES.has(stage) && !cleanText(deal.refusalReasonCode || deal.comment)) {
    warnings.push("negative_outcome_without_reason");
  }
  if (!deal.clientId) warnings.push("missing_client_id");
  let inn = "";
  try { inn = normalizeInn(deal.inn); } catch { errors.push("invalid_inn"); }
  if (!inn) warnings.push("missing_inn");
  if (!cleanText(deal.crmLeadId)) warnings.push("missing_crm_lead_id");
  if (!cleanText(deal.knowledgeProgramId)) warnings.push("missing_knowledge_program_id");
  const identityComplete = Boolean(deal.clientId && inn && cleanText(deal.crmLeadId));
  return {
    errors,
    warnings,
    terminal: TERMINAL_STAGES.has(stage),
    learnable: TERMINAL_STAGES.has(stage)
      && errors.length === 0
      && identityComplete
      && Boolean(cleanText(deal.knowledgeProgramId))
  };
}

function updatedAtOf(item) {
  const value = cleanText(item?.updatedAt || item?.createdAt);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function filterUpdated(items, updatedSince, snapshotAt) {
  const since = updatedSince ? Date.parse(updatedSince) : 0;
  const ceiling = Date.parse(snapshotAt);
  if (updatedSince && !Number.isFinite(since)) throw new Error("updatedSince должен быть ISO-датой");
  return (Array.isArray(items) ? items : []).filter((item) => {
    const updated = updatedAtOf(item);
    if (!updatedSince) return !updated || updated <= ceiling;
    return updated > since && updated <= ceiling;
  });
}

function flattenKnowledge(knowledge) {
  return (Array.isArray(knowledge) ? knowledge : []).flatMap((bank) =>
    (Array.isArray(bank.programs) ? bank.programs : []).map((program) => ({
      ...program,
      bank: cleanText(program.bank || bank.bank),
      bankId: cleanText(bank.id),
      updatedAt: cleanText(program.updatedAt || bank.updatedAt)
    }))
  );
}

function buildChangeSet({ deals, clients, knowledge, documentRequests, updatedSince = "", snapshotAt }) {
  const cursor = cleanText(snapshotAt) || new Date().toISOString();
  return {
    schemaVersion: 1,
    cursor,
    updatedSince: cleanText(updatedSince),
    clients: filterUpdated(clients, updatedSince, cursor),
    deals: filterUpdated(deals, updatedSince, cursor),
    knowledgePrograms: filterUpdated(flattenKnowledge(knowledge), updatedSince, cursor),
    documentRequests: filterUpdated(documentRequests, updatedSince, cursor)
  };
}

function summarizeQuality(deals) {
  const issueCounts = {};
  const samples = {};
  let learnable = 0;
  for (const deal of Array.isArray(deals) ? deals : []) {
    const audit = auditDealQuality(deal);
    if (audit.learnable) learnable += 1;
    for (const issue of [...audit.errors, ...audit.warnings]) {
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
      if (!samples[issue]) samples[issue] = [];
      if (samples[issue].length < 10) samples[issue].push(cleanText(deal.id));
    }
  }
  return { total: Array.isArray(deals) ? deals.length : 0, learnable, issueCounts, samples };
}

module.exports = {
  SERVICE_ROLE,
  auditDealQuality,
  authenticateServiceBearer,
  buildChangeSet,
  canonicalJson,
  flattenKnowledge,
  normalizeConditions,
  normalizeIdentityName,
  normalizeInn,
  normalizeProgramDiscovery,
  normalizeCreditAnalysisBundle,
  parseServiceScopes,
  requestHash,
  sha256,
  summarizeQuality,
  validateIntegrationDecision
};
