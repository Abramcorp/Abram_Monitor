"use strict";

const CURRENT_STAGES = [
  { id: "planned", label: "Плановая" },
  { id: "lead", label: "Закинули лид" },
  { id: "submitted", label: "Подписали заявку ждем решение" }
];

const COMPLETED_STAGES = [
  { id: "approved", label: "Одобрено" },
  { id: "rejected", label: "Отклонено" },
  { id: "blocked", label: "Нет возможности завести заявку (УКАЗАТЬ ПРИЧИНУ)" }
];

const ALL_STAGES = [...CURRENT_STAGES, ...COMPLETED_STAGES];
const STAGE_LABELS = Object.fromEntries(ALL_STAGES.map((stage) => [stage.id, stage.label]));
const CURRENT_STAGE_IDS = new Set(CURRENT_STAGES.map((stage) => stage.id));
const COMPLETED_STAGE_IDS = new Set(COMPLETED_STAGES.map((stage) => stage.id));
const LEGACY_STAGE_MAP = {
  documents: "lead",
  ki_check: "lead",
  review: "submitted",
  issued: "approved",
  withdrawn: "blocked"
};

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

function earliestIsoDate(values) {
  const timestamps = values
    .map(toIsoDate)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  return timestamps.length ? new Date(timestamps[0]).toISOString() : "";
}

function normalizeDealAction(raw = {}, index = 0) {
  const action = cleanText(raw.action || raw.comment || raw.text);
  const actionAt = toIsoDate(raw.actionAt || raw.date || raw.createdAt);
  if (!action || !actionAt) {
    return null;
  }

  return {
    id: cleanText(raw.id) || `action-${index + 1}`,
    action,
    actionAt
  };
}

function stageFromLegacyStatus(rawStage, rawStatus) {
  const stage = cleanText(rawStage).toLowerCase();
  if (CURRENT_STAGE_IDS.has(stage) || COMPLETED_STAGE_IDS.has(stage)) {
    return stage;
  }
  if (LEGACY_STAGE_MAP[stage]) {
    return LEGACY_STAGE_MAP[stage];
  }

  const status = cleanText(rawStatus).toLowerCase();
  if (/нет возможности|невозможно|не.*завести|блок|отозван|клиент.*отказ|withdraw/.test(status)) return "blocked";
  if (/отказ|отклон/.test(status)) return "rejected";
  if (/одобрен|выдан|финансирован|закрыт/.test(status)) return "approved";
  if (/подпис|рассмотр|подан|банк/.test(status)) return "submitted";
  if (/лид|документ|обращение|ки|кредитн/.test(status)) return "lead";
  if (/план/.test(status)) return "planned";
  return "planned";
}

function normalizeDeal(raw = {}) {
  const stage = stageFromLegacyStatus(raw.stage, raw.status);
  const completed = COMPLETED_STAGE_IDS.has(stage);
  const now = new Date().toISOString();
  const rawCreatedAt = toIsoDate(raw.createdAt);
  const rawUpdatedAt = toIsoDate(raw.updatedAt);
  const createdAt = rawCreatedAt || rawUpdatedAt || now;
  const updatedAt = rawUpdatedAt || rawCreatedAt || now;
  const inquiryAt = toIsoDate(raw.inquiryAt);
  const submittedAt = toIsoDate(raw.submittedAt);
  const signedAt = toIsoDate(raw.signedAt) || submittedAt;
  const kiRequestedAt = toIsoDate(raw.kiRequestedAt);
  const analystCallAt = toIsoDate(raw.analystCallAt);
  const nextActionAt = toIsoDate(raw.nextActionAt);
  const creditVisibleAt = toIsoDate(raw.creditVisibleAt);
  const completedAt = completed ? toIsoDate(raw.completedAt) || updatedAt : "";
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .map(normalizeDealAction)
    .filter(Boolean)
    .sort((left, right) => new Date(left.actionAt) - new Date(right.actionAt));
  const lastActionAt = latestIsoDate([
    rawUpdatedAt,
    ...actions.map((action) => action.actionAt),
    analystCallAt,
    signedAt,
    submittedAt,
    inquiryAt,
    kiRequestedAt,
    creditVisibleAt,
    completedAt,
    rawCreatedAt
  ]) || updatedAt;

  return {
    id: cleanText(raw.id) || `deal-${Date.now()}`,
    client: cleanText(raw.client) || "Без названия",
    manager: cleanText(raw.manager) || "Без аналитика",
    bank: cleanText(raw.bank) || "Банк не выбран",
    knowledgeProgramId: cleanText(raw.knowledgeProgramId || raw.programId),
    program: cleanText(raw.program || raw.programName),
    programType: cleanText(raw.programType),
    programAmountRange: cleanText(raw.programAmountRange || raw.amountRange),
    stage,
    stageLabel: STAGE_LABELS[stage],
    status: cleanText(raw.status) || STAGE_LABELS[stage],
    statusGroup: completed ? "completed" : "current",
    amountRequested: toNumber(raw.amountRequested),
    amountApproved: toNumber(raw.amountApproved),
    bureau: cleanText(raw.bureau),
    inquiryAt,
    submittedAt,
    signedAt,
    kiRequestedAt,
    analystCallAt,
    nextActionAt,
    creditVisibleAt,
    completedAt,
    lastActionAt,
    actions,
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
    knowledgeProgramId: deal.knowledgeProgramId,
    program: deal.program,
    programType: deal.programType,
    programAmountRange: deal.programAmountRange,
    stage: deal.stage,
    stageLabel: deal.stageLabel,
    status: deal.stageLabel,
    statusGroup: deal.statusGroup,
    createdAt: deal.createdAt,
    inquiryAt: deal.inquiryAt,
    submittedAt: deal.submittedAt,
    signedAt: deal.signedAt,
    applicationDate: deal.signedAt || deal.submittedAt || deal.inquiryAt || deal.createdAt,
    amountRequested: deal.amountRequested,
    amountApproved: deal.amountApproved,
    bureau: deal.bureau,
    lastActionAt: deal.lastActionAt,
    nextActionAt: deal.nextActionAt,
    completedAt: deal.completedAt,
    actions: deal.actions,
    comment: deal.comment,
    timeline: deal.timeline
  };
}

function sortByLastAction(items) {
  return items.sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0));
}

function buildClientGroup(client, clientDeals) {
  const applications = sortByLastAction(clientDeals.map(toApplicationSummary));
  const plannedApplications = applications.filter((deal) => deal.stage === "planned");
  const currentApplications = applications.filter((deal) => deal.statusGroup === "current" && deal.stage !== "planned");
  const successfulApplications = applications.filter((deal) => deal.stage === "approved");
  const refusedApplications = applications.filter((deal) => deal.stage === "rejected" || deal.stage === "blocked");
  const activeApplications = [...currentApplications, ...plannedApplications];
  const completedApplications = [...successfulApplications, ...refusedApplications];
  const plannedDeals = clientDeals.filter((deal) => deal.stage === "planned");
  const currentDeals = clientDeals.filter((deal) => deal.statusGroup === "current" && deal.stage !== "planned");
  const approvedDeals = clientDeals.filter((deal) => deal.stage === "approved");
  const startedAt = earliestIsoDate(clientDeals.flatMap((deal) => [deal.inquiryAt, deal.signedAt]));

  return {
    client,
    count: applications.length,
    activeCount: activeApplications.length,
    completedCount: completedApplications.length,
    currentCount: currentApplications.length,
    plannedCount: plannedApplications.length,
    successfulCount: successfulApplications.length,
    refusedCount: refusedApplications.length,
    amountRequested: sum(clientDeals, "amountRequested"),
    amountApproved: sum(clientDeals, "amountApproved"),
    plannedAmountRequested: sum(plannedDeals, "amountRequested"),
    currentAmountRequested: sum(currentDeals, "amountRequested"),
    approvedAmount: sum(approvedDeals, "amountApproved"),
    startedAt,
    lastActionAt: applications[0]?.lastActionAt || "",
    activeApplications,
    currentApplications,
    plannedApplications,
    completedApplications,
    successfulApplications,
    refusedApplications,
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
      const currentApplicationDeals = currentDeals.filter((deal) => deal.stage !== "planned");

      return {
        manager,
        clientCount: clients.length,
        currentClientCount: clients.filter((client) => client.activeCount > 0).length,
        completedClientCount: clients.filter((client) => client.completedCount > 0).length,
        count: managerDeals.length,
        activeCount: currentDeals.length,
        completedCount: completedDeals.length,
        currentCount: clients.reduce((total, client) => total + client.currentCount, 0),
        plannedCount: clients.reduce((total, client) => total + client.plannedCount, 0),
        successfulCount: clients.reduce((total, client) => total + client.successfulCount, 0),
        refusedCount: clients.reduce((total, client) => total + client.refusedCount, 0),
        amountRequested: sum(managerDeals, "amountRequested"),
        amountApproved: sum(managerDeals, "amountApproved"),
        currentAmountRequested: sum(currentApplicationDeals, "amountRequested"),
        completedAmountRequested: sum(completedDeals, "amountRequested"),
        plannedAmountRequested: clients.reduce((total, client) => total + client.plannedAmountRequested, 0),
        approvedAmount: clients.reduce((total, client) => total + client.approvedAmount, 0),
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

function buildBoardSummary(deals, statusGroup, grouping) {
  const field = grouping === "bank" ? "bank" : "manager";
  const fallback = grouping === "bank" ? "Банк не указан" : "Аналитик не указан";
  const filteredDeals = deals.filter((deal) => deal.statusGroup === statusGroup);
  const allGroups = groupBy(deals, (deal) => deal[field] || fallback);

  return Array.from(groupBy(filteredDeals, (deal) => deal[field] || fallback).entries())
    .map(([name, items]) => {
      const groupDeals = allGroups.get(name) || items;
      const plannedDeals = groupDeals.filter((deal) => deal.stage === "planned");
      const currentDeals = groupDeals.filter((deal) => deal.statusGroup === "current" && deal.stage !== "planned");
      const approvedDeals = groupDeals.filter((deal) => deal.stage === "approved");
      const totalAmountRequested = sum(groupDeals, "amountRequested");
      const approvedAmount = sum(approvedDeals, "amountApproved");

      return {
        id: `${grouping}-${statusGroup}-${name}`.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, ""),
        name,
        groupBy: grouping,
        statusGroup,
        count: items.length,
        amountRequested: sum(items, "amountRequested"),
        amountApproved: sum(items, "amountApproved"),
        plannedAmountRequested: sum(plannedDeals, "amountRequested"),
        currentAmountRequested: sum(currentDeals, "amountRequested"),
        approvedAmount,
        totalAmountRequested,
        approvalConversionRate: totalAmountRequested ? Math.round((approvedAmount / totalAmountRequested) * 100) : 0,
        lastActionAt: latestIsoDate(items.map((deal) => deal.lastActionAt)),
        applications: sortByLastAction(items.map(toApplicationSummary))
      };
    })
    .sort((a, b) => b.amountRequested - a.amountRequested || a.name.localeCompare(b.name, "ru"));
}

function buildBoardSummaries(deals) {
  return {
    current: {
      manager: buildBoardSummary(deals, "current", "manager"),
      bank: buildBoardSummary(deals, "current", "bank")
    },
    completed: {
      manager: buildBoardSummary(deals, "completed", "manager"),
      bank: buildBoardSummary(deals, "completed", "bank")
    }
  };
}

function calculateDashboard(rawDeals, clock = new Date()) {
  const deals = rawDeals.map(normalizeDeal);
  const currentDeals = deals.filter((deal) => deal.statusGroup === "current");
  const completedDeals = deals.filter((deal) => deal.statusGroup === "completed");
  const issuedDeals = completedDeals.filter((deal) => deal.stage === "approved");
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
    const issued = items.filter((deal) => deal.stage === "approved");
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
    boardSummaries: buildBoardSummaries(deals),
    currentSummary: {
      overdueDeals,
      nextActions,
      byBank: currentByBank,
      byManager: buildCurrentManagerGroups(currentDeals),
      needsDocuments: currentDeals.filter((deal) => deal.stage === "lead").length,
      inBankReview: currentDeals.filter((deal) => deal.stage === "submitted").length
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
  buildBoardSummary,
  buildCurrentManagerGroups,
  buildManagerClientGroups,
  calculateDashboard,
  latestIsoDate,
  normalizeDeal,
  toNumber
};
