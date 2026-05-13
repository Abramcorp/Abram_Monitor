"use strict";

const CURRENT_STAGES = [
  { id: "lead", label: "Новая заявка" },
  { id: "documents", label: "Запрос документов" },
  { id: "ki_check", label: "Проверка КИ" },
  { id: "submitted", label: "Подана в банк" },
  { id: "review", label: "На рассмотрении" },
  { id: "approved", label: "Одобрено" }
];

const COMPLETED_STAGES = [
  { id: "issued", label: "Выдано" },
  { id: "rejected", label: "Отказ" },
  { id: "withdrawn", label: "Клиент отказался" }
];

const ALL_STAGES = [...CURRENT_STAGES, ...COMPLETED_STAGES];
const STAGE_LABELS = Object.fromEntries(ALL_STAGES.map((stage) => [stage.id, stage.label]));
const CURRENT_STAGE_IDS = new Set(CURRENT_STAGES.map((stage) => stage.id));
const COMPLETED_STAGE_IDS = new Set(COMPLETED_STAGES.map((stage) => stage.id));

function cleanText(value) {
  return String(value ?? "").trim();
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const normalized = cleanText(value)
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function latestIsoDate(values) {
  const timestamps = values
    .map(toIsoDate)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a);

  return timestamps.length ? new Date(timestamps[0]).toISOString() : "";
}

function stageFromLegacyStatus(rawStage, rawStatus) {
  const stage = cleanText(rawStage).toLowerCase();
  if (CURRENT_STAGE_IDS.has(stage) || COMPLETED_STAGE_IDS.has(stage)) {
    return stage;
  }

  const status = cleanText(rawStatus).toLowerCase();
  if (/выдан|финансирован|закрыт/.test(status)) return "issued";
  if (/отказ/.test(status)) return "rejected";
  if (/клиент.*отказ|отозван|withdraw/.test(status)) return "withdrawn";
  if (/одобрен/.test(status)) return "approved";
  if (/рассмотр/.test(status)) return "review";
  if (/подан|банк/.test(status)) return "submitted";
  if (/ки|кредитн/.test(status)) return "ki_check";
  if (/документ|обращение/.test(status)) return "documents";
  return "lead";
}

function normalizeDeal(raw = {}) {
  const stage = stageFromLegacyStatus(raw.stage, raw.status);
  const completed = COMPLETED_STAGE_IDS.has(stage);
  const now = new Date().toISOString();
  const rawCreatedAt = toIsoDate(raw.createdAt);
  const rawUpdatedAt = toIsoDate(raw.updatedAt);
  const createdAt = rawCreatedAt || rawUpdatedAt || now;
  const updatedAt = rawUpdatedAt || rawCreatedAt || now;
  const submittedAt = toIsoDate(raw.submittedAt);
  const kiRequestedAt = toIsoDate(raw.kiRequestedAt);
  const analystCallAt = toIsoDate(raw.analystCallAt);
  const nextActionAt = toIsoDate(raw.nextActionAt);
  const creditVisibleAt = toIsoDate(raw.creditVisibleAt);
  const completedAt = completed ? toIsoDate(raw.completedAt) || updatedAt : "";
  const lastActionAt = latestIsoDate([
    rawUpdatedAt,
    analystCallAt,
    submittedAt,
    kiRequestedAt,
    creditVisibleAt,
    completedAt,
    rawCreatedAt
  ]) || updatedAt;

  return {
    id: cleanText(raw.id) || `deal-${Date.now()}`,
    client: cleanText(raw.client) || "Без названия",
    manager: cleanText(raw.manager) || "Без менеджера",
    bank: cleanText(raw.bank) || "Банк не выбран",
    stage,
    stageLabel: STAGE_LABELS[stage],
    status: cleanText(raw.status) || STAGE_LABELS[stage],
    statusGroup: completed ? "completed" : "current",
    amountRequested: toNumber(raw.amountRequested),
    amountApproved: toNumber(raw.amountApproved),
    bureau: cleanText(raw.bureau),
    submittedAt,
    kiRequestedAt,
    analystCallAt,
    nextActionAt,
    creditVisibleAt,
    completedAt,
    lastActionAt,
    timeline: cleanText(raw.timeline),
    comment: cleanText(raw.comment),
    createdAt,
    updatedAt
  };
}

function sum(items, field) {
  return items.reduce((total, item) => total + toNumber(item[field]), 0);
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item) || "Не указано";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
    return groups;
  }, new Map());
}

function formatGroup(groups, mapper) {
  return Array.from(groups.entries())
    .map(([name, items]) => mapper(name, items))
    .sort((a, b) => b.count - a.count || b.amountRequested - a.amountRequested);
}

function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  return Math.max(0, Math.round((endDate - startDate) / 86400000));
}

function toApplicationSummary(deal) {
  return {
    id: deal.id,
    client: deal.client,
    manager: deal.manager,
    bank: deal.bank,
    stage: deal.stage,
    stageLabel: deal.stageLabel,
    status: deal.stageLabel,
    statusGroup: deal.statusGroup,
    amountRequested: deal.amountRequested,
    amountApproved: deal.amountApproved,
    bureau: deal.bureau,
    lastActionAt: deal.lastActionAt,
    nextActionAt: deal.nextActionAt,
    completedAt: deal.completedAt,
    comment: deal.comment,
    timeline: deal.timeline
  };
}

function sortByLastAction(items) {
  return items.sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0));
}

function buildClientGroup(client, clientDeals) {
  const applications = sortByLastAction(clientDeals.map(toApplicationSummary));
  const activeApplications = applications.filter((deal) => deal.statusGroup === "current");
  const completedApplications = applications.filter((deal) => deal.statusGroup === "completed");

  return {
    client,
    count: applications.length,
    activeCount: activeApplications.length,
    completedCount: completedApplications.length,
    amountRequested: sum(clientDeals, "amountRequested"),
    amountApproved: sum(clientDeals, "amountApproved"),
    lastActionAt: applications[0]?.lastActionAt || "",
    activeApplications,
    currentApplications: activeApplications,
    completedApplications,
    applications
  };
}

function buildManagerClientGroups(deals) {
  return Array.from(groupBy(deals, (deal) => deal.manager).entries())
    .map(([manager, managerDeals]) => {
      const clients = Array.from(groupBy(managerDeals, (deal) => deal.client).entries())
        .map(([client, clientDeals]) => buildClientGroup(client, clientDeals))
        .sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0) || b.count - a.count);
      const currentDeals = managerDeals.filter((deal) => deal.statusGroup === "current");
      const completedDeals = managerDeals.filter((deal) => deal.statusGroup === "completed");

      return {
        manager,
        clientCount: clients.length,
        currentClientCount: clients.filter((client) => client.activeCount > 0).length,
        completedClientCount: clients.filter((client) => client.completedCount > 0).length,
        count: managerDeals.length,
        activeCount: currentDeals.length,
        completedCount: completedDeals.length,
        amountRequested: sum(managerDeals, "amountRequested"),
        amountApproved: sum(managerDeals, "amountApproved"),
        currentAmountRequested: sum(currentDeals, "amountRequested"),
        completedAmountRequested: sum(completedDeals, "amountRequested"),
        lastActionAt: clients[0]?.lastActionAt || "",
        currentClients: clients.filter((client) => client.activeCount > 0),
        completedClients: clients.filter((client) => client.completedCount > 0),
        clients
      };
    })
    .sort((a, b) => b.count - a.count || a.manager.localeCompare(b.manager, "ru"));
}

function buildCurrentManagerGroups(currentDeals) {
  return buildManagerClientGroups(currentDeals).map((manager) => ({
    ...manager,
    clients: manager.currentClients
  }));
}

function calculateDashboard(rawDeals, clock = new Date()) {
  const deals = rawDeals.map(normalizeDeal);
  const currentDeals = deals.filter((deal) => deal.statusGroup === "current");
  const completedDeals = deals.filter((deal) => deal.statusGroup === "completed");
  const issuedDeals = completedDeals.filter((deal) => deal.stage === "issued");
  const overdueDeals = currentDeals.filter((deal) => {
    if (!deal.nextActionAt) {
      return false;
    }
    return new Date(deal.nextActionAt).getTime() < clock.getTime();
  });

  const currentFunnel = CURRENT_STAGES.map((stage) => {
    const items = currentDeals.filter((deal) => deal.stage === stage.id);
    return {
      ...stage,
      count: items.length,
      amountRequested: sum(items, "amountRequested"),
      amountApproved: sum(items, "amountApproved")
    };
  });

  const completedByResult = COMPLETED_STAGES.map((stage) => {
    const items = completedDeals.filter((deal) => deal.stage === stage.id);
    return {
      ...stage,
      count: items.length,
      amountRequested: sum(items, "amountRequested"),
      amountApproved: sum(items, "amountApproved")
    };
  });

  const completedByBank = formatGroup(groupBy(completedDeals, (deal) => deal.bank), (bank, items) => {
    const issued = items.filter((deal) => deal.stage === "issued");
    const amountApproved = sum(items, "amountApproved");
    return {
      bank,
      count: items.length,
      issuedCount: issued.length,
      conversionRate: items.length ? Math.round((issued.length / items.length) * 100) : 0,
      amountRequested: sum(items, "amountRequested"),
      amountApproved,
      averageApproved: issued.length ? Math.round(sum(issued, "amountApproved") / issued.length) : 0
    };
  });

  const currentByBank = formatGroup(groupBy(currentDeals, (deal) => deal.bank), (bank, items) => ({
    bank,
    count: items.length,
    amountRequested: sum(items, "amountRequested"),
    amountApproved: sum(items, "amountApproved")
  }));

  const nextActions = currentDeals
    .filter((deal) => deal.nextActionAt)
    .sort((a, b) => new Date(a.nextActionAt) - new Date(b.nextActionAt))
    .slice(0, 8);

  const completedDurations = completedDeals
    .map((deal) => daysBetween(deal.createdAt, deal.completedAt || deal.updatedAt))
    .filter((days) => days !== null);

  const amountRequestedCurrent = sum(currentDeals, "amountRequested");
  const amountRequestedCompleted = sum(completedDeals, "amountRequested");
  const amountApprovedCompleted = sum(completedDeals, "amountApproved");

  return {
    generatedAt: clock.toISOString(),
    stages: {
      current: CURRENT_STAGES,
      completed: COMPLETED_STAGES,
      all: ALL_STAGES
    },
    totals: {
      all: deals.length,
      current: currentDeals.length,
      completed: completedDeals.length,
      issued: issuedDeals.length,
      overdue: overdueDeals.length,
      amountRequestedCurrent,
      amountRequestedCompleted,
      amountApprovedCompleted,
      averageCycleDays: completedDurations.length
        ? Math.round(completedDurations.reduce((total, days) => total + days, 0) / completedDurations.length)
        : 0,
      completedConversionRate: completedDeals.length ? Math.round((issuedDeals.length / completedDeals.length) * 100) : 0
    },
    currentFunnel,
    managerClientGroups: buildManagerClientGroups(deals),
    currentSummary: {
      overdueDeals,
      nextActions,
      byBank: currentByBank,
      byManager: buildCurrentManagerGroups(currentDeals),
      needsDocuments: currentDeals.filter((deal) => deal.stage === "documents").length,
      inBankReview: currentDeals.filter((deal) => ["submitted", "review", "approved"].includes(deal.stage)).length
    },
    completedAnalytics: {
      byResult: completedByResult,
      byBank: completedByBank
    },
    deals
  };
}

module.exports = {
  ALL_STAGES,
  COMPLETED_STAGES,
  CURRENT_STAGES,
  buildCurrentManagerGroups,
  buildManagerClientGroups,
  calculateDashboard,
  latestIsoDate,
  normalizeDeal,
  toNumber
};
