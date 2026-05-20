"use strict";

const state = {
  banks: [],
  clients: [],
  dashboard: null,
  knowledge: [],
  managers: [],
  filters: {
    query: "",
    manager: "all",
    bank: "all",
    stage: "all"
  },
  board: {
    status: "current",
    groupBy: "manager"
  },
  archive: {
    groupBy: "manager"
  },
  knowledgeSection: "banks",
  view: "summary"
};

const app = document.querySelector("#app");
const viewTabs = document.querySelector("#viewTabs");
const refreshButton = document.querySelector("#refreshButton");
const newManagerButton = document.querySelector("#newManagerButton");
const newClientButton = document.querySelector("#newClientButton");
const newDealButton = document.querySelector("#newDealButton");
const newKnowledgeButton = document.querySelector("#newKnowledgeButton");
const dialog = document.querySelector("#dealDialog");
const form = document.querySelector("#dealForm");
const saveDealButton = document.querySelector("#saveDealButton");
const clientDialog = document.querySelector("#clientDialog");
const clientForm = document.querySelector("#clientForm");
const managerDialog = document.querySelector("#managerDialog");
const managerForm = document.querySelector("#managerForm");
const dealActionDialog = document.querySelector("#dealActionDialog");
const dealActionForm = document.querySelector("#dealActionForm");
const knowledgeDialog = document.querySelector("#knowledgeDialog");
const knowledgeForm = document.querySelector("#knowledgeForm");
const knowledgeDialogTitle = document.querySelector("#knowledgeDialogTitle");

const VIEWS = [
  { id: "summary", label: "Сводный отчет" },
  { id: "funnels", label: "Аналитики" },
  { id: "archive", label: "Архив клиентов" },
  { id: "knowledge", label: "База знаний" }
];

const REQUIREMENT_LABELS = {
  businessRegion: "Регион ведения бизнеса",
  ipAge: "Возраст ИП",
  revenue: "Выручка",
  documentation: "Документация",
  okved: "ОКВЭД",
  accountPresence: "Наличие счета"
};

const BOARD_STATUS_LABELS = {
  current: "Текущие",
  completed: "Завершенные"
};

const BOARD_GROUP_LABELS = {
  manager: "По аналитикам",
  client: "По клиентам",
  bank: "По банкам"
};

const BOARD_GROUP_EYEBROWS = {
  manager: "Аналитик",
  client: "Клиент",
  bank: "Банк"
};

const ARCHIVE_GROUP_LABELS = {
  manager: "По аналитикам",
  date: "По дате добавления"
};

const APPLICATION_STAGE_LABELS = {
  planned: "Плановая",
  lead: "Закинули лид",
  submitted: "Подписали заявку ждем решение",
  approved: "Одобрено",
  rejected: "Отклонено",
  blocked: "Нет возможности завести заявку (УКАЗАТЬ ПРИЧИНУ)"
};

const PROGRAM_TYPES = ["Экспресс", "Стандарт", "Физическое лицо", "Добивка"];
const KNOWLEDGE_SECTIONS = {
  banks: "Банки",
  programs: "Программы"
};
const MOSCOW_TIME_ZONE = "Europe/Moscow";

const currency = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
  style: "currency",
  currency: "RUB"
});

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  timeZone: MOSCOW_TIME_ZONE,
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const actionDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: MOSCOW_TIME_ZONE
});

const actionTime = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: MOSCOW_TIME_ZONE
});

const monthLabelFormatter = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  timeZone: MOSCOW_TIME_ZONE,
  year: "2-digit"
});

const DAY_MS = 86400000;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return currency.format(Number(value || 0));
}

function percent(part, total) {
  const base = Number(total || 0);
  if (!base) {
    return 0;
  }
  return Math.round((Number(part || 0) / base) * 100);
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

function localDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysSince(value, base = new Date()) {
  const start = localDay(value);
  const end = localDay(base);
  if (!start || !end) {
    return null;
  }
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

function dayLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
  return `${count} ${word}`;
}

function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  return Math.max(0, Math.round((endDate - startDate) / DAY_MS));
}

function earliestDate(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  return timestamps.length ? new Date(timestamps[0]).toISOString() : "";
}

function firstEarliestDate(...groups) {
  for (const group of groups) {
    const value = earliestDate(group);
    if (value) {
      return value;
    }
  }

  return "";
}

function sortableTime(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function formatDateWithAge(value, ageText) {
  const days = daysSince(value);
  if (!value || days === null) {
    return "—";
  }
  return `${formatDate(value)} (${dayLabel(days)} ${ageText})`;
}

function formatDateTimeInput(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: MOSCOW_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function formatDateInput(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: MOSCOW_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatActionEntry(action) {
  const date = new Date(action.actionAt);
  if (Number.isNaN(date.getTime())) {
    return escapeHtml(action.action);
  }
  return `${escapeHtml(action.action)} — ${actionDate.format(date)} — ${actionTime.format(date)}`;
}

function safeExternalUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function applicationStageClass(stage) {
  return `application-stage-${String(stage || "planned").replace(/[^a-z0-9-]/gi, "")}`;
}

function statusChangeAt(deal, stageLabels) {
  return earliestDate(
    (deal.actions || [])
      .filter((action) => {
        const text = String(action.action || "").trim();
        return text.startsWith("Смена статуса:") && stageLabels.some((label) => text.endsWith(`→ ${label}`));
      })
      .map((action) => action.actionAt)
  );
}

function applicationBucketEnteredAt(deal, bucket) {
  if (bucket === "planned") {
    return firstEarliestDate(
      [statusChangeAt(deal, [APPLICATION_STAGE_LABELS.planned]), deal.createdAt],
      [deal.updatedAt, deal.lastActionAt]
    );
  }

  if (bucket === "current") {
    return firstEarliestDate(
      [
        statusChangeAt(deal, [APPLICATION_STAGE_LABELS.lead, APPLICATION_STAGE_LABELS.submitted]),
        deal.inquiryAt,
        deal.signedAt,
        deal.submittedAt
      ],
      [deal.updatedAt, deal.lastActionAt, deal.createdAt]
    );
  }

  if (bucket === "approved") {
    return firstEarliestDate(
      [statusChangeAt(deal, [APPLICATION_STAGE_LABELS.approved]), deal.completedAt],
      [deal.updatedAt, deal.lastActionAt, deal.createdAt]
    );
  }

  if (bucket === "refused") {
    return firstEarliestDate(
      [statusChangeAt(deal, [APPLICATION_STAGE_LABELS.rejected, APPLICATION_STAGE_LABELS.blocked]), deal.completedAt],
      [deal.updatedAt, deal.lastActionAt, deal.createdAt]
    );
  }

  return firstEarliestDate([deal.updatedAt, deal.lastActionAt, deal.createdAt]);
}

function sortByBucketEntry(applications, bucket) {
  return [...applications].sort((left, right) => {
    const leftEntry = sortableTime(applicationBucketEnteredAt(left, bucket));
    const rightEntry = sortableTime(applicationBucketEnteredAt(right, bucket));
    return leftEntry - rightEntry || sortableTime(left.lastActionAt) - sortableTime(right.lastActionAt) || left.id.localeCompare(right.id, "ru");
  });
}

function uiStateKey(...parts) {
  return parts.map((part) => encodeURIComponent(String(part ?? "").trim())).join("|");
}

function captureUiState() {
  return {
    openDetails: [...document.querySelectorAll("details[data-ui-state-key][open]")]
      .map((detail) => detail.dataset.uiStateKey)
      .filter(Boolean),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    view: state.view
  };
}

function restoreUiState(snapshot) {
  if (!snapshot || snapshot.view !== state.view) {
    return;
  }

  const openDetails = new Set(snapshot.openDetails || []);
  document.querySelectorAll("details[data-ui-state-key]").forEach((detail) => {
    detail.open = openDetails.has(detail.dataset.uiStateKey);
  });
  requestAnimationFrame(() => {
    window.scrollTo(snapshot.scrollX || 0, snapshot.scrollY || 0);
  });
}

function getStageDateRequirements(stage, currentStage = "") {
  const requirements = [];
  if (stage === "lead") {
    requirements.push({ field: "inquiryAt", label: "Дата обращения" });
  }
  if (stage === "submitted") {
    if (currentStage === "lead") {
      requirements.push({ field: "inquiryAt", label: "Дата обращения" });
    }
    requirements.push({ field: "signedAt", label: "Дата подписания" });
  }
  return requirements;
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Ошибка запроса");
  }
  return payload;
}

const LOAD_DATA_TARGETS = {
  dashboard: { url: "/api/dashboard", apply: (payload) => { state.dashboard = payload; } },
  banks: { url: "/api/banks", apply: (payload) => { state.banks = payload.banks; } },
  clients: { url: "/api/clients", apply: (payload) => { state.clients = payload.clients; } },
  managers: { url: "/api/managers", apply: (payload) => { state.managers = payload.managers; } },
  knowledge: { url: "/api/knowledge", apply: (payload) => { state.knowledge = payload.knowledge; } }
};
const LOAD_DATA_ALL = Object.keys(LOAD_DATA_TARGETS);

async function loadData(options = {}) {
  const requested = Array.isArray(options.targets) && options.targets.length
    ? options.targets.filter((target) => target in LOAD_DATA_TARGETS)
    : LOAD_DATA_ALL;
  const responses = await Promise.all(requested.map((target) => requestJson(LOAD_DATA_TARGETS[target].url)));
  responses.forEach((payload, index) => {
    LOAD_DATA_TARGETS[requested[index]].apply(payload);
  });
  render();
  restoreUiState(options.restoreUi);
}

async function refreshDashboard(options = {}) {
  state.dashboard = await requestJson("/api/dashboard");
  render();
  restoreUiState(options.restoreUi);
}

function clientUiStateKeys(deal) {
  if (!deal?.manager || !deal?.client) {
    return [];
  }

  return [
    uiStateKey("manager", deal.manager),
    uiStateKey("client", deal.manager, deal.client, "active"),
    uiStateKey("current-manager", deal.manager),
    uiStateKey("current-client", deal.manager, deal.client)
  ];
}

function preserveClientOpenState(snapshot, deal) {
  return {
    ...snapshot,
    openDetails: [...new Set([...(snapshot?.openDetails || []), ...clientUiStateKeys(deal)])],
    view: state.view
  };
}

function closeApplicationCard(card) {
  if (card) {
    card.open = false;
  }
}

function setClientRefreshState(card, button, isLoading) {
  const clientCard = card?.closest(".client-card");
  const indicator = clientCard?.querySelector(".client-refresh-indicator");

  if (button) {
    button.disabled = isLoading;
    button.textContent = isLoading ? "Сохраняем..." : "Сохранить";
  }

  if (!clientCard) {
    return;
  }

  clientCard.classList.toggle("is-refreshing", isLoading);
  if (isLoading && !indicator) {
    const nextIndicator = document.createElement("div");
    nextIndicator.className = "client-refresh-indicator";
    nextIndicator.setAttribute("role", "status");
    nextIndicator.textContent = "Обновляем заявки";
    clientCard.querySelector(".client-drilldown")?.prepend(nextIndicator);
  } else if (!isLoading) {
    indicator?.remove();
  }
}

function setDealDialogLoading(isLoading) {
  const indicator = dialog.querySelector(".dialog-refresh-indicator");

  if (saveDealButton) {
    saveDealButton.disabled = isLoading;
    saveDealButton.textContent = isLoading ? "Сохраняем..." : "Сохранить заявку";
  }

  if (isLoading && !indicator) {
    const nextIndicator = document.createElement("div");
    nextIndicator.className = "dialog-refresh-indicator";
    nextIndicator.setAttribute("role", "status");
    nextIndicator.textContent = "Обновляем заявки";
    form.querySelector(".dialog-actions")?.before(nextIndicator);
  } else if (!isLoading) {
    indicator?.remove();
  }
}

function resetFilters() {
  state.filters = { query: "", manager: "all", bank: "all", stage: "all" };
}

function renderViewTabs() {
  viewTabs.innerHTML = VIEWS
    .map((view) => `<button class="tab ${state.view === view.id ? "is-active" : ""}" data-view="${view.id}" type="button">${view.label}</button>`)
    .join("");

  viewTabs.querySelectorAll("[data-view]").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      resetFilters();
      render();
    });
  });
}

function updateActionVisibility() {
  newManagerButton.hidden = state.view !== "funnels";
  newClientButton.hidden = false;
  if (newDealButton) {
    newDealButton.hidden = true;
  }
  newKnowledgeButton.hidden = false;
}

function renderKpis() {
  const totals = state.dashboard.totals;
  const kpis = [
    ["Лиды", totals.leads],
    ["Заявки в работе", totals.working],
    ["Завершенные", totals.completed],
    ["Одобрено", totals.issued],
    ["Конверсия лидов", `${totals.leadToWorkingConversionRate}%`],
    ["Успех завершенных", `${totals.completedToSuccessConversionRate}%`]
  ];

  return `
    <section class="kpi-grid">
      ${kpis
        .map(
          ([label, value]) => `
            <div class="kpi">
              <span>${label}</span>
              <strong>${value}</strong>
            </div>
          `
        )
        .join("")}
    </section>
  `;
}

function renderFilters(deals) {
  const stageOptions = state.dashboard.stages.all
    .map((stage) => `<option value="${stage.id}" ${state.filters.stage === stage.id ? "selected" : ""}>${stage.label}</option>`)
    .join("");
  const managerOptions = [...new Set(deals.map((deal) => deal.manager))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map(
      (manager) =>
        `<option value="${escapeHtml(manager)}" ${state.filters.manager === manager ? "selected" : ""}>${escapeHtml(manager)}</option>`
    )
    .join("");
  const bankOptions = [...new Set(deals.map((deal) => deal.bank))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((bank) => `<option value="${escapeHtml(bank)}" ${state.filters.bank === bank ? "selected" : ""}>${escapeHtml(bank)}</option>`)
    .join("");

  return `
    <div class="filters">
      <input id="queryFilter" value="${escapeHtml(state.filters.query)}" placeholder="Клиент, аналитик, банк">
      <select id="managerFilter">
        <option value="all">Все аналитики</option>
        ${managerOptions}
      </select>
      <select id="bankFilter">
        <option value="all">Все банки</option>
        ${bankOptions}
      </select>
      <select id="stageFilter">
        <option value="all">Все этапы</option>
        ${stageOptions}
      </select>
    </div>
  `;
}

function filteredDeals(group) {
  const query = state.filters.query.toLowerCase();
  return state.dashboard.deals
    .filter((deal) => !group || deal.statusGroup === group)
    .filter((deal) => state.filters.manager === "all" || deal.manager === state.filters.manager)
    .filter((deal) => state.filters.bank === "all" || deal.bank === state.filters.bank)
    .filter((deal) => state.filters.stage === "all" || deal.stage === state.filters.stage)
    .filter((deal) => {
      if (!query) {
        return true;
      }
      return [deal.client, deal.manager, deal.bank, deal.program, deal.programType, deal.programAmountRange, deal.status, deal.comment, deal.timeline]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
}

function groupDealsByManagerAndClient(deals, clients = [], managerRecords = []) {
  const managerGroups = new Map();
  const managerMeta = new Map();
  const clientMeta = new Map();
  const clientMetaByName = new Map();
  const archivedClientNames = new Set();
  const clientKey = (manager, client) => `${manager || ""}\u0000${client || ""}`;
  const clientNameKey = (client) => String(client || "").trim().toLowerCase();

  managerRecords.forEach((manager) => {
    managerMeta.set(manager.name, manager);
    if (!managerGroups.has(manager.name)) {
      managerGroups.set(manager.name, new Map());
    }
  });

  clients.forEach((client) => {
    const managerName = client.manager || "";
    if (!managerGroups.has(managerName)) {
      return;
    }
    const managerClients = managerGroups.get(managerName);
    if (!managerClients.has(client.name)) {
      managerClients.set(client.name, []);
    }
    clientMeta.set(clientKey(managerName, client.name), client);
    clientMetaByName.set(clientNameKey(client.name), client);
    if (client.archivedAt) {
      archivedClientNames.add(clientNameKey(client.name));
    }
  });

  deals.forEach((deal) => {
    if (!managerGroups.has(deal.manager)) {
      return;
    }

    const clients = managerGroups.get(deal.manager);
    if (!clients.has(deal.client)) {
      clients.set(deal.client, []);
    }

    clients.get(deal.client).push(deal);
  });

  return [...managerGroups.entries()]
    .map(([manager, clients]) => {
      const managerRecord = managerMeta.get(manager) || { id: "", name: manager };
      const clientGroups = [...clients.entries()]
        .map(([client, applications]) => {
          const sortedApplications = [...applications].sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0));
          const exactMeta = clientMeta.get(clientKey(manager, client));
          const nameMeta = clientMetaByName.get(clientNameKey(client));
          const meta = exactMeta || (nameMeta?.archivedAt ? nameMeta : {}) || {};
          const plannedApplications = sortByBucketEntry(sortedApplications.filter((deal) => deal.stage === "planned"), "planned");
          const leadApplications = sortByBucketEntry(sortedApplications.filter((deal) => deal.stage === "lead"), "current");
          const workingApplications = sortByBucketEntry(sortedApplications.filter((deal) => deal.stage === "submitted"), "current");
          const currentApplications = sortByBucketEntry(
            sortedApplications.filter((deal) => deal.statusGroup === "current" && deal.stage !== "planned"),
            "current"
          );
          const successfulApplications = sortByBucketEntry(sortedApplications.filter((deal) => deal.stage === "approved"), "approved");
          const refusedApplications = sortByBucketEntry(
            sortedApplications.filter((deal) => deal.stage === "rejected" || deal.stage === "blocked"),
            "refused"
          );
          const activeApplications = [...currentApplications, ...plannedApplications];
          const completedApplications = [...successfulApplications, ...refusedApplications];
          const sumRequested = (items) => items.reduce((total, deal) => total + Number(deal.amountRequested || 0), 0);
          const sumApproved = (items) => items.reduce((total, deal) => total + Number(deal.amountApproved || 0), 0);
          const startedAt = earliestDate(sortedApplications.flatMap((deal) => [deal.inquiryAt, deal.signedAt]));
          const addedAt = meta.createdAt || earliestDate(sortedApplications.map((deal) => deal.createdAt));
          const isArchived = Boolean(meta.archivedAt || archivedClientNames.has(clientNameKey(client)));
          return {
            clientId: meta.id || "",
            manager,
            client,
            contact: meta.contact || "",
            phone: meta.phone || "",
            crmUrl: meta.crmUrl || "",
            driveUrl: meta.driveUrl || "",
            instructionUrl: meta.instructionUrl || "",
            comment: meta.comment || "",
            archivedAt: meta.archivedAt || "",
            isArchived,
            createdAt: addedAt,
            count: sortedApplications.length,
            activeCount: activeApplications.length,
            completedCount: completedApplications.length,
            currentCount: currentApplications.length,
            leadCount: leadApplications.length,
            workingCount: workingApplications.length,
            plannedCount: plannedApplications.length,
            successfulCount: successfulApplications.length,
            refusedCount: refusedApplications.length,
            amountRequested: sumRequested(sortedApplications),
            amountApproved: sumApproved(sortedApplications),
            plannedAmountRequested: sumRequested(plannedApplications),
            leadAmountRequested: sumRequested(leadApplications),
            workingAmountRequested: sumRequested(workingApplications),
            currentAmountRequested: sumRequested(currentApplications),
            approvedAmount: sumApproved(successfulApplications),
            startedAt,
            lastActionAt: sortedApplications[0]?.lastActionAt || "",
            activeApplications,
            currentApplications,
            leadApplications,
            workingApplications,
            plannedApplications,
            completedApplications,
            successfulApplications,
            refusedApplications,
            applications: sortedApplications
          };
        })
        .sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0) || b.count - a.count);

      const archivedClients = clientGroups.filter((client) => client.isArchived);
      const activeClients = clientGroups.filter((client) => !archivedClients.includes(client));
      const currentClients = activeClients.filter((client) => client.activeCount > 0 || client.count === 0);
      const completedClients = activeClients.filter((client) => client.completedCount > 0);

      return {
        managerId: managerRecord.id,
        manager,
        clientCount: activeClients.length,
        count: activeClients.reduce((total, client) => total + client.count, 0),
        activeCount: activeClients.reduce((total, client) => total + client.activeCount, 0),
        completedCount: activeClients.reduce((total, client) => total + client.completedCount, 0),
        currentCount: activeClients.reduce((total, client) => total + client.currentCount, 0),
        leadCount: activeClients.reduce((total, client) => total + client.leadCount, 0),
        workingCount: activeClients.reduce((total, client) => total + client.workingCount, 0),
        plannedCount: activeClients.reduce((total, client) => total + client.plannedCount, 0),
        successfulCount: activeClients.reduce((total, client) => total + client.successfulCount, 0),
        refusedCount: activeClients.reduce((total, client) => total + client.refusedCount, 0),
        amountRequested: activeClients.reduce((total, client) => total + client.amountRequested, 0),
        amountApproved: activeClients.reduce((total, client) => total + client.amountApproved, 0),
        plannedAmountRequested: activeClients.reduce((total, client) => total + client.plannedAmountRequested, 0),
        leadAmountRequested: activeClients.reduce((total, client) => total + client.leadAmountRequested, 0),
        workingAmountRequested: activeClients.reduce((total, client) => total + client.workingAmountRequested, 0),
        currentAmountRequested: activeClients.reduce((total, client) => total + client.currentAmountRequested, 0),
        approvedAmount: activeClients.reduce((total, client) => total + client.approvedAmount, 0),
        lastActionAt: activeClients[0]?.lastActionAt || "",
        currentClients,
        completedClients,
        archivedClients,
        clients: activeClients
      };
    })
    .sort((a, b) => b.count - a.count || a.manager.localeCompare(b.manager, "ru"));
}

function groupCurrentDealsByManager(deals) {
  return groupDealsByManagerAndClient(deals, state.clients, state.managers).map((manager) => ({
    ...manager,
    clients: manager.currentClients
  }));
}

function renderDealTable(deals) {
  if (!deals.length) {
    return `<div class="empty">Нет сделок под выбранные фильтры.</div>`;
  }

  const stageOptions = state.dashboard.stages.all;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Клиент</th>
            <th>Аналитик</th>
            <th>Программа</th>
            <th>Статус заявки</th>
            <th>Заявка</th>
            <th>Одобрено</th>
            <th>Следующее действие</th>
            <th>Комментарий</th>
          </tr>
        </thead>
        <tbody>
          ${deals
            .map(
              (deal) => `
                <tr>
                  <td>
                    <strong>${escapeHtml(deal.client)}</strong>
                    <span class="table-meta muted">${escapeHtml(deal.bureau || "Бюро не указано")}</span>
                  </td>
                  <td>${escapeHtml(deal.manager)}</td>
                  <td>${renderApplicationProgramTitle(deal)}</td>
                  <td>
                    <select data-stage-select="${escapeHtml(deal.id)}" data-current-stage="${escapeHtml(deal.stage)}">
                      ${stageOptions
                        .map((stage) => `<option value="${stage.id}" ${stage.id === deal.stage ? "selected" : ""}>${stage.label}</option>`)
                        .join("")}
                    </select>
                  </td>
                  <td>${money(deal.amountRequested)}</td>
                  <td>${money(deal.amountApproved)}</td>
                  <td>${formatDate(deal.nextActionAt || deal.completedAt)}</td>
                  <td>${escapeHtml(deal.comment || deal.timeline || "—")}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderApplicationActions(actions = []) {
  if (!actions.length) {
    return `<div class="application-history-empty">Действий пока нет.</div>`;
  }

  return `
    <ol class="application-history">
      ${actions
        .map((action) => `<li>${formatActionEntry(action)}</li>`)
        .join("")}
    </ol>
  `;
}

function renderClientApplicationCards(applications, emptyText, type) {
  const stageOptions = state.dashboard.stages.all;
  if (!applications.length) {
    return `<div class="empty compact-empty">${emptyText}</div>`;
  }

  return `
    <div class="client-application-list">
      ${applications
        .map(
          (deal) => `
            <details class="client-application-card application-card-${escapeHtml(type)} ${applicationStageClass(deal.stage)}">
              <summary class="application-card-head">
                <strong>${renderApplicationProgramTitle(deal)}</strong>
                <span>${money(deal.amountRequested)}</span>
                <em>${escapeHtml(deal.stageLabel)}</em>
                <small>Последнее действие: ${formatDate(deal.lastActionAt)}</small>
              </summary>
              <div class="application-card-body">
                <button class="ghost-button small-button application-action-button" data-add-deal-action="${escapeHtml(deal.id)}" type="button">
                  + Действие
                </button>
                <button class="primary-button small-button application-save-button" data-save-application="${escapeHtml(deal.id)}" type="button">
                  Сохранить
                </button>
                <label class="application-field">
                  <span>Сумма заявки</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="amountRequested" inputmode="decimal" value="${escapeHtml(deal.amountRequested || "")}">
                </label>
                <label class="application-field">
                  <span>Одобрено</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="amountApproved" inputmode="decimal" value="${escapeHtml(deal.amountApproved || "")}">
                </label>
                <label class="application-field">
                  <span>Статус</span>
                  <select data-stage-select="${escapeHtml(deal.id)}" data-current-stage="${escapeHtml(deal.stage)}">
                    ${stageOptions
                      .map((stage) => `<option value="${stage.id}" ${stage.id === deal.stage ? "selected" : ""}>${stage.label}</option>`)
                      .join("")}
                  </select>
                </label>
                <label class="application-field">
                  <span>Дата обращения</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="inquiryAt" type="datetime-local" value="${formatDateTimeInput(deal.inquiryAt)}">
                </label>
                <label class="application-field">
                  <span>Дата подписания</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="signedAt" type="datetime-local" value="${formatDateTimeInput(deal.signedAt)}">
                </label>
                <label class="application-field">
                  <span>Дата запроса КИ</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="kiRequestedAt" type="date" value="${formatDateInput(deal.kiRequestedAt)}">
                </label>
                <label class="application-field">
                  <span>Дата звонка андеррайтера</span>
                  <input data-application-field="${escapeHtml(deal.id)}" data-field="analystCallAt" type="date" value="${formatDateInput(deal.analystCallAt)}">
                </label>
                ${
                  type === "approved"
                    ? `<div class="application-field"><span>Одобрено</span><strong>${money(deal.amountApproved)}</strong></div>`
                    : ""
                }
                ${
                  type === "refused"
                    ? `<div class="application-field application-comment"><span>Причина</span><strong>${escapeHtml(deal.comment || deal.timeline || "—")}</strong></div>`
                    : ""
                }
                <div class="application-field application-history-field">
                  <span>Хронология</span>
                  ${renderApplicationActions(deal.actions)}
                </div>
              </div>
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderClientApplicationSections(client) {
  const renderSection = ([title, applications, count, emptyText, type, collapsible]) => collapsible
    ? `
      <details class="application-group application-group-collapsible application-group-${escapeHtml(type)}">
        <summary class="application-group-head">
          <h4>${title} (${count})</h4>
        </summary>
        ${renderClientApplicationCards(applications, emptyText, type)}
      </details>
    `
    : `
      <section class="application-group application-group-${escapeHtml(type)}">
        <div class="application-group-head">
          <h4>${title} (${count})</h4>
          ${type === "approved" ? `<span class="application-group-amount">${money(client.approvedAmount)}</span>` : ""}
        </div>
        ${renderClientApplicationCards(applications, emptyText, type)}
      </section>
    `;

  const plannedSection = ["План подач", client.plannedApplications || [], client.plannedCount || 0, "Плановых заявок нет.", "planned", false];
  const leadSection = ["Лиды", client.leadApplications || [], client.leadCount || 0, "Лидов нет.", "current", false];
  const workingSection = ["Заявки в работе", client.workingApplications || [], client.workingCount || 0, "Заявок в работе нет.", "current", false];
  const approvedSection = ["Одобрено", client.successfulApplications || [], client.successfulCount || 0, "Одобренных заявок нет.", "approved", false];
  const refusedSection = ["Отказ / непринятые", client.refusedApplications || [], client.refusedCount || 0, "Отказов и непринятых заявок нет.", "refused", true];

  return `
    <div class="application-split">
      ${renderSection(plannedSection)}
      ${renderSection(leadSection)}
      ${renderSection(workingSection)}
      <div class="application-completed-rail">
        ${renderSection(approvedSection)}
        ${renderSection(refusedSection)}
      </div>
    </div>
  `;
}

function summaryCount(source, ...fields) {
  for (const field of fields) {
    const value = Number(source?.[field] ?? 0);
    if (value) {
      return value;
    }
  }

  return 0;
}

function renderSummaryAmountBadges(source, status = state.board.status) {
  const plannedCount = summaryCount(source, "plannedCount", "planCount");
  const approvedCount = summaryCount(source, "successfulCount", "approvedCount", "issuedCount");

  if (status === "completed") {
    return `
      <div class="summary-amounts">
        <span>Завершено <strong>${source.completedCount || 0} · ${money(source.completedAmountRequested || source.amountRequested)}</strong></span>
        <span>Одобрено <strong>${approvedCount} · ${money(source.approvedAmount)}</strong></span>
        <span>Отказ / непринятые <strong>${source.refusedCount || 0} · ${money(source.refusedAmountRequested)}</strong></span>
      </div>
    `;
  }

  return `
    <div class="summary-amounts">
      <span>План подач <strong>${plannedCount} · ${money(source.plannedAmountRequested)}</strong></span>
      <span>Лиды <strong>${source.leadCount || 0} · ${money(source.leadAmountRequested)}</strong></span>
      <span>В работе <strong>${source.workingCount || 0} · ${money(source.workingAmountRequested)}</strong></span>
    </div>
  `;
}

function renderConversionBadges(source) {
  return `
    <div class="conversion-grid">
      <span>Лиды → в работе <strong>${source.leadToWorkingConversionRate || 0}%</strong></span>
      <span>Подписанные → завершенные <strong>${source.signedToCompletedConversionRate || 0}%</strong></span>
      <span>Завершенные → успешные <strong>${source.completedToSuccessConversionRate || source.completedConversionRate || 0}%</strong></span>
    </div>
  `;
}

function renderReportTotals(groups) {
  const totalRequested = groups.reduce((total, group) => total + Number(group.amountRequested || 0), 0);
  const approvedAmount = groups.reduce((total, group) => total + Number(group.approvedAmount || 0), 0);
  const planCount = groups.reduce((total, group) => total + summaryCount(group, "plannedCount", "planCount"), 0);
  const leadCount = groups.reduce((total, group) => total + Number(group.leadCount || 0), 0);
  const workingCount = groups.reduce((total, group) => total + Number(group.workingCount || 0), 0);
  const completedCount = groups.reduce((total, group) => total + Number(group.completedCount || 0), 0);
  const successfulCount = groups.reduce((total, group) => total + Number(group.successfulCount || 0), 0);
  const refusedCount = groups.reduce((total, group) => total + Number(group.refusedCount || 0), 0);
  return {
    count: groups.reduce((total, group) => total + group.count, 0),
    amountRequested: groups.reduce((total, group) => total + Number(group.amountRequested || 0), 0),
    totalAmountRequested: totalRequested,
    plannedAmountRequested: groups.reduce((total, group) => total + Number(group.plannedAmountRequested || 0), 0),
    planCount,
    leadCount,
    workingCount,
    completedCount,
    successfulCount,
    refusedCount,
    leadAmountRequested: groups.reduce((total, group) => total + Number(group.leadAmountRequested || 0), 0),
    workingAmountRequested: groups.reduce((total, group) => total + Number(group.workingAmountRequested || 0), 0),
    currentAmountRequested: groups.reduce((total, group) => total + Number(group.currentAmountRequested || 0), 0),
    completedAmountRequested: groups.reduce((total, group) => total + Number(group.completedAmountRequested || 0), 0),
    refusedAmountRequested: groups.reduce((total, group) => total + Number(group.refusedAmountRequested || 0), 0),
    approvedAmount,
    approvalConversionRate: percent(approvedAmount, totalRequested),
    leadToWorkingConversionRate: percent(workingCount, leadCount + workingCount),
    signedToCompletedConversionRate: percent(completedCount, workingCount + completedCount),
    completedToSuccessConversionRate: percent(successfulCount, completedCount)
  };
}

function renderAddApplicationButton(manager, client) {
  return `
    <button
      class="ghost-button small-button"
      data-add-application
      data-manager="${escapeHtml(manager)}"
      data-client="${escapeHtml(client)}"
      type="button"
    >
      + Заявка
    </button>
  `;
}

function renderClientActions(client, settings = {}) {
  if (!settings.allowAddApplication && !settings.allowArchive) {
    return "";
  }

  return `
    <div class="client-actions">
      ${settings.allowAddApplication ? renderAddApplicationButton(client.manager || "", client.client) : ""}
      ${
        settings.allowArchive && client.clientId
          ? `<button class="ghost-button small-button danger-button" data-archive-client="${escapeHtml(client.clientId)}" data-client-name="${escapeHtml(client.client)}" type="button">В архив</button>`
          : ""
      }
    </div>
  `;
}

function renderClientLinks(client) {
  const links = [
    ["CRM", client.crmUrl],
    ["Диск", client.driveUrl],
    ["Инструкция", client.instructionUrl]
  ]
    .map(([label, url]) => [label, safeExternalUrl(url)])
    .filter(([, url]) => url);

  if (!links.length) {
    return "";
  }

  return `
    <div class="client-summary-links">
      ${links
        .map(
          ([label, url]) => `
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>
          `
        )
        .join("")}
    </div>
  `;
}

function renderClientSummary(client, options = {}) {
  const settings = typeof options === "object" ? options : {};
  const completedLabel = `завершено: ${client.completedCount || 0} (отказов: ${client.refusedCount || 0})`;
  return `
    <div class="client-summary-main">
      <strong class="client-title">${escapeHtml(client.client)}</strong>
      <div class="client-summary-amounts">
        <span>План подач <strong>${client.plannedCount || 0} · ${money(client.plannedAmountRequested)}</strong></span>
        <span>Лиды <strong>${client.leadCount || 0} · ${money(client.leadAmountRequested)}</strong></span>
        <span>Заявки в работе <strong>${client.workingCount || 0} · ${money(client.workingAmountRequested)}</strong></span>
        <span>Одобрения <strong>${client.successfulCount || 0} · ${money(client.approvedAmount)}</strong></span>
        <span>Завершенные подачи <strong>${completedLabel}</strong></span>
      </div>
      <div class="client-summary-dates">
        ${settings.showAddedAt ? `<span>Дата добавления: ${formatDateWithAge(client.createdAt, "назад")}</span>` : ""}
        ${settings.showArchivedAt && client.archivedAt ? `<span>В архиве: ${formatDateWithAge(client.archivedAt, "назад")}</span>` : ""}
        <span>Дата начала: ${formatDateWithAge(client.startedAt, "в работе")}</span>
        <span>Последнее изменение: ${formatDateWithAge(client.lastActionAt, "назад")}</span>
      </div>
      ${renderClientLinks(client)}
    </div>
    <span class="applications-toggle" role="button" aria-label="Раскрыть заявки">Заявки</span>
  `;
}

function renderManagerGroups(deals) {
  const managers = groupCurrentDealsByManager(deals);

  if (!managers.length) {
    return `<div class="empty">Нет текущих заявок под выбранные фильтры.</div>`;
  }

  return `
    <div class="manager-stack">
      ${managers
        .map(
          (manager) => `
            <details class="manager-section manager-accordion" data-ui-state-key="${escapeHtml(uiStateKey("current-manager", manager.manager))}">
              <summary class="manager-head">
                <div>
                  <p class="eyebrow">Аналитик</p>
                  <h3>${escapeHtml(manager.manager)}</h3>
                </div>
                <div class="manager-metrics">
                  <span>${manager.clientCount} клиентов</span>
                  <strong>Лиды ${manager.leadCount || 0} · В работе ${manager.workingCount || 0}</strong>
                  <span>${money(manager.leadAmountRequested || 0)} · ${money(manager.workingAmountRequested || 0)}</span>
                </div>
              </summary>
              <div class="client-stack">
                ${manager.clients
                  .map(
                    (client) => `
                      <details class="client-card" data-ui-state-key="${escapeHtml(uiStateKey("current-client", manager.manager, client.client))}">
                        <summary>
                          ${renderClientSummary(client, "active")}
                        </summary>
                        <div class="client-drilldown">
                          ${renderClientActions(client, { allowAddApplication: true, allowArchive: true })}
                          ${renderClientApplicationSections(client)}
                        </div>
                      </details>
                    `
                  )
                  .join("")}
              </div>
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderClientCards(clients, emptyText, options = {}) {
  const settings = { allowAddApplication: true, allowArchive: true, showAddedAt: false, showArchivedAt: false, ...options };
  if (!clients.length) {
    return `<div class="empty compact-empty">${emptyText}</div>`;
  }

  return `
    <div class="client-stack">
      ${clients
        .map(
          (client) => `
            <details class="client-card" data-ui-state-key="${escapeHtml(uiStateKey("client", client.manager || "", client.client, settings.showArchivedAt ? "archive" : "active"))}">
              <summary>
                ${renderClientSummary(client, { showAddedAt: settings.showAddedAt, showArchivedAt: settings.showArchivedAt })}
              </summary>
              <div class="client-drilldown">
                ${renderClientActions(client, settings)}
                ${renderClientApplicationSections(client)}
              </div>
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function getArchivedManagers() {
  return groupDealsByManagerAndClient(state.dashboard.deals, state.clients, state.managers)
    .map((manager) => ({
      ...manager,
      clients: manager.archivedClients
    }))
    .filter((manager) => manager.clients.length > 0);
}

function flattenArchivedClients(managers) {
  return managers.flatMap((manager) => manager.clients.map((client) => ({ ...client, manager: manager.manager })));
}

function archiveDateGroupLabel(value) {
  const date = localDay(value);
  return date ? actionDate.format(date) : "Дата не указана";
}

function archiveDateGroupKey(value) {
  const date = localDay(value);
  if (!date) {
    return "undated";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupArchivedClientsByDate(clients) {
  const groups = new Map();

  clients.forEach((client) => {
    const key = archiveDateGroupKey(client.createdAt);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: archiveDateGroupLabel(client.createdAt),
        sortAt: localDay(client.createdAt)?.getTime?.() || 0,
        clients: []
      });
    }
    groups.get(key).clients.push(client);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      clients: group.clients.sort((a, b) => a.client.localeCompare(b.client, "ru"))
    }))
    .sort((a, b) => b.sortAt - a.sortAt || a.label.localeCompare(b.label, "ru"));
}

function renderArchiveControls() {
  return `
    <div class="board-controls">
      <div class="segmented" role="group" aria-label="Группировка архива">
        ${Object.entries(ARCHIVE_GROUP_LABELS)
          .map(
            ([value, label]) => `
              <button class="${state.archive.groupBy === value ? "is-active" : ""}" data-archive-group="${value}" type="button">${label}</button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderArchiveMetrics(clients) {
  return `
    <div class="summary-amounts">
      <span>Клиентов <strong>${clients.length}</strong></span>
      <span>Одобрено <strong>${clients.reduce((total, client) => total + client.successfulCount, 0)} · ${money(clients.reduce((total, client) => total + client.approvedAmount, 0))}</strong></span>
      <span>Отказы / непринятые <strong>${clients.reduce((total, client) => total + client.refusedCount, 0)}</strong></span>
    </div>
  `;
}

function renderArchiveByManager(groups) {
  if (!groups.length) {
    return `<div class="empty">В архиве пока нет клиентов.</div>`;
  }

  return `
    <div class="manager-stack">
      ${groups
        .map(
          (manager) => `
            <details class="manager-section manager-accordion" data-ui-state-key="${escapeHtml(uiStateKey("archive-manager", manager.manager))}">
              <summary class="manager-head">
                <div>
                  <p class="eyebrow">Аналитик</p>
                  <h3>${escapeHtml(manager.manager)}</h3>
                </div>
                <div class="manager-metrics">
                  ${renderArchiveMetrics(manager.clients)}
                </div>
              </summary>
              ${renderClientCards(manager.clients, "Архивных клиентов нет.", { allowAddApplication: false, allowArchive: false, showAddedAt: true, showArchivedAt: true })}
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderArchiveByDate(clients) {
  const groups = groupArchivedClientsByDate(clients);
  if (!groups.length) {
    return `<div class="empty">В архиве пока нет клиентов.</div>`;
  }

  return `
    <div class="manager-stack">
      ${groups
        .map(
          (group) => `
            <details class="manager-section manager-accordion" data-ui-state-key="${escapeHtml(uiStateKey("archive-date", group.key))}">
              <summary class="manager-head">
                <div>
                  <p class="eyebrow">Дата добавления</p>
                  <h3>${escapeHtml(group.label)}</h3>
                </div>
                <div class="manager-metrics">
                  ${renderArchiveMetrics(group.clients)}
                </div>
              </summary>
              ${renderClientCards(group.clients, "Архивных клиентов нет.", { allowAddApplication: false, allowArchive: false, showAddedAt: true, showArchivedAt: true })}
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderArchiveView() {
  const archiveManagers = getArchivedManagers();
  const archiveClients = flattenArchivedClients(archiveManagers);

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Архив клиентов</p>
          <h2>Завершенные клиенты</h2>
          <p class="muted">В архив попадают клиенты, отправленные вручную.</p>
          ${renderArchiveMetrics(archiveClients)}
        </div>
        ${renderArchiveControls()}
      </div>
      ${state.archive.groupBy === "date" ? renderArchiveByDate(archiveClients) : renderArchiveByManager(archiveManagers)}
    </section>
  `;
}

function renderManagerClientView() {
  const managers = groupDealsByManagerAndClient(state.dashboard.deals, state.clients, state.managers);

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Аналитики и клиенты</p>
          <h2>Карточки аналитиков</h2>
        </div>
      </div>
      ${
        managers.length
          ? `<div class="manager-stack">
              ${managers
                .map(
                  (manager) => `
                    <details class="manager-section manager-accordion" data-ui-state-key="${escapeHtml(uiStateKey("manager", manager.manager))}">
                      <summary class="manager-head">
                        <div>
                          <p class="eyebrow">Аналитик</p>
                          <h3>${escapeHtml(manager.manager)}</h3>
                        </div>
                        <div class="manager-metrics">
                          <strong>${manager.clientCount} клиентов</strong>
                          <div class="summary-amounts">
                            <span>План подач <strong>${manager.plannedCount} · ${money(manager.plannedAmountRequested)}</strong></span>
                            <span>Лиды <strong>${manager.leadCount} · ${money(manager.leadAmountRequested)}</strong></span>
                            <span>Заявки в работе <strong>${manager.workingCount} · ${money(manager.workingAmountRequested)}</strong></span>
                          </div>
                          <button
                            class="ghost-button small-button danger-button"
                            data-delete-manager="${escapeHtml(manager.managerId)}"
                            data-manager-name="${escapeHtml(manager.manager)}"
                            type="button"
                          >
                            Удалить
                          </button>
                        </div>
                      </summary>
                      ${renderClientCards(manager.clients, "Клиентов пока нет.")}
                    </details>
                  `
                )
                .join("")}
            </div>`
          : `<div class="empty">Аналитики пока не добавлены.</div>`
      }
    </section>
  `;
}

function filteredKnowledge() {
  const query = state.filters.query.toLowerCase();
  return state.knowledge
    .filter((bank) => state.filters.bank === "all" || bank.bank === state.filters.bank)
    .map((bank) => ({
      ...bank,
      programs: (bank.programs || []).filter((program) => {
        if (!query) {
          return true;
        }
        const requirementText = Object.values(program.requirements || {}).join(" ");
        return [
          bank.bank,
          bank.phone,
          program.bankPhone,
          program.program,
          program.programUrl,
          program.programType,
          program.amountRange,
          program.termRange,
          program.reviewTermDeclared,
          program.notes,
          program.changeHistory,
          requirementText
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
    }))
    .filter((bank) => {
      if (!query) {
        return true;
      }
      return bank.programs.length > 0;
    });
}

function groupProgramsByType(programs = []) {
  const groups = new Map(PROGRAM_TYPES.map((type) => [type, []]));
  programs.forEach((program) => {
    const type = PROGRAM_TYPES.includes(program.programType) ? program.programType : "Стандарт";
    groups.get(type).push(program);
  });
  return [...groups.entries()].filter(([, items]) => items.length);
}

function programMetaSuffix(amountRange, termRange) {
  const parts = [
    amountRange,
    termRange ? `срок ${termRange}` : ""
  ].filter(Boolean);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

function flattenKnowledgePrograms() {
  return state.knowledge.flatMap((bank) =>
    (bank.programs || []).map((program) => ({
      bank,
      program,
      label: `${bank.bank} - ${program.program}${programMetaSuffix(program.amountRange, program.termRange)}`
    }))
  );
}

function applicationProgramTitle(deal) {
  if (!deal.program) {
    return deal.bank || "Программа не выбрана";
  }
  return `${deal.bank} - ${deal.program}${programMetaSuffix(deal.programAmountRange, deal.programTermRange)}`;
}

function findProgramForDeal(deal) {
  if (!deal) {
    return null;
  }

  if (deal.knowledgeProgramId) {
    const byId = flattenKnowledgePrograms().find((entry) => entry.program.id === deal.knowledgeProgramId);
    if (byId) {
      return byId;
    }
  }

  const bankName = String(deal.bank || "").trim().toLowerCase();
  const programName = String(deal.program || "").trim().toLowerCase();
  if (!bankName || !programName) {
    return null;
  }

  return flattenKnowledgePrograms().find((entry) =>
    entry.bank.bank.toLowerCase() === bankName && entry.program.program.toLowerCase() === programName
  ) || null;
}

function applicationProgramUrl(deal) {
  const entry = findProgramForDeal(deal);
  return safeExternalUrl(deal?.programUrl || entry?.program.programUrl);
}

function dealMatchesKnowledgeProgram(deal, program, bank) {
  if (!deal || !program) {
    return false;
  }
  if (deal.knowledgeProgramId && program.id) {
    return deal.knowledgeProgramId === program.id;
  }

  return String(deal.bank || "").trim().toLowerCase() === String(bank?.bank || "").trim().toLowerCase()
    && String(deal.program || "").trim().toLowerCase() === String(program.program || "").trim().toLowerCase();
}

function programReviewStats(program, bank) {
  const reviewDays = (state.dashboard?.deals || [])
    .filter((deal) => deal.statusGroup === "completed" && deal.signedAt && deal.completedAt && dealMatchesKnowledgeProgram(deal, program, bank))
    .map((deal) => daysBetween(deal.signedAt, deal.completedAt))
    .filter((days) => days !== null);

  if (!reviewDays.length) {
    return "Недостаточно данных";
  }

  const averageDays = Math.round(reviewDays.reduce((total, days) => total + days, 0) / reviewDays.length);
  const minDays = Math.min(...reviewDays);
  const maxDays = Math.max(...reviewDays);
  const rangeText = minDays === maxDays ? "" : `, диапазон ${dayLabel(minDays)} - ${dayLabel(maxDays)}`;
  return `среднее ${dayLabel(averageDays)} по ${reviewDays.length} заявкам${rangeText}`;
}

function renderApplicationProgramTitle(deal) {
  const title = applicationProgramTitle(deal);
  const url = applicationProgramUrl(deal);
  if (!url) {
    return escapeHtml(title);
  }

  return `<a class="application-program-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`;
}

function renderApplicationProgramOptions() {
  const entries = flattenKnowledgePrograms();
  if (!entries.length) {
    return `<option value="">Сначала добавьте программу в Базе знаний</option>`;
  }

  const grouped = new Map(PROGRAM_TYPES.map((type) => [type, []]));
  entries.forEach((entry) => {
    const type = PROGRAM_TYPES.includes(entry.program.programType) ? entry.program.programType : "Стандарт";
    grouped.get(type).push(entry);
  });

  return [...grouped.entries()]
    .filter(([, items]) => items.length)
    .map(
      ([type, items]) => `
        <optgroup label="${escapeHtml(type)}">
          ${items
            .sort((left, right) => left.label.localeCompare(right.label, "ru"))
            .map((entry) => `<option value="${escapeHtml(entry.program.id)}">${escapeHtml(entry.label)}</option>`)
            .join("")}
        </optgroup>
      `
    )
    .join("");
}

function syncApplicationProgramFields() {
  const programId = form.elements.knowledgeProgramId?.value;
  const entry = flattenKnowledgePrograms().find((item) => item.program.id === programId);
  form.elements.bank.value = entry?.bank.bank || "";
  form.elements.program.value = entry?.program.program || "";
  form.elements.programType.value = entry?.program.programType || "";
  form.elements.programAmountRange.value = entry?.program.amountRange || "";
  form.elements.programTermRange.value = entry?.program.termRange || "";
}

function renderKnowledgeFilters() {
  const bankOptions = [...new Set(state.knowledge.map((bank) => bank.bank))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((bank) => `<option value="${escapeHtml(bank)}" ${state.filters.bank === bank ? "selected" : ""}>${escapeHtml(bank)}</option>`)
    .join("");

  return `
    <div class="filters">
      <input id="queryFilter" value="${escapeHtml(state.filters.query)}" placeholder="Банк, программа, требование">
      <select id="bankFilter">
        <option value="all">Все банки</option>
        ${bankOptions}
      </select>
    </div>
  `;
}

function renderKnowledgeSectionControls() {
  return `
    <div class="segmented knowledge-sections" role="group" aria-label="Подраздел базы знаний">
      ${Object.entries(KNOWLEDGE_SECTIONS)
        .map(
          ([value, label]) => `
            <button class="${state.knowledgeSection === value ? "is-active" : ""}" data-knowledge-section="${value}" type="button">${label}</button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRequirementGrid(requirements = {}) {
  return `
    <div class="requirement-grid">
      ${Object.entries(REQUIREMENT_LABELS)
        .map(
          ([key, label]) => `
            <div class="requirement-item">
              <span>${label}</span>
              <strong>${escapeHtml(requirements[key] || "Не указано")}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderKnowledgeProgramCard(program, bank, showBank = false) {
  const programUrl = safeExternalUrl(program.programUrl);
  const reviewStats = programReviewStats(program, bank);
  return `
    <details class="knowledge-card">
      <summary class="knowledge-card-head">
        <div>
          <p class="eyebrow">Банк</p>
          <h3>${escapeHtml(bank.bank)}</h3>
          <h4>
            ${escapeHtml(program.program)}${program.amountRange ? ` <span>${escapeHtml(program.amountRange)}</span>` : ""}
            ${program.termRange ? ` <span>${escapeHtml(`срок ${program.termRange}`)}</span>` : ""}
            ${programUrl ? `<a class="knowledge-program-link" href="${escapeHtml(programUrl)}" target="_blank" rel="noopener noreferrer">Ссылка</a>` : ""}
          </h4>
        </div>
        <span>${escapeHtml(program.programType || "Стандарт")}</span>
      </summary>
      <div class="knowledge-card-body">
        <div class="knowledge-card-actions">
          <time>${formatDate(program.updatedAt || bank.updatedAt)}</time>
          <button class="ghost-button small-button" data-edit-knowledge="${escapeHtml(program.id)}" type="button">Редактировать</button>
        </div>
        ${renderRequirementGrid(program.requirements)}
        <div class="knowledge-review-terms">
          <span>Срок рассмотрения</span>
          <div>
            <strong>Заявленный: ${escapeHtml(program.reviewTermDeclared || "Не указан")}</strong>
            <strong>Статистика: ${escapeHtml(reviewStats)}</strong>
          </div>
        </div>
        <p class="knowledge-note">${escapeHtml(program.notes || "Без заметок")}</p>
        <details class="knowledge-history">
          <summary>История изменений</summary>
          <strong>${escapeHtml(program.changeHistory || `Обновлено: ${formatDate(program.updatedAt || bank.updatedAt)}`)}</strong>
        </details>
      </div>
    </details>
  `;
}

function renderKnowledgeBanks(banks) {
  if (!banks.length) {
    return `<div class="empty">В базе знаний пока нет записей под выбранные фильтры.</div>`;
  }

  return `
    <div class="knowledge-bank-stack">
      ${banks
        .map(
          (bank) => `
            <details class="knowledge-bank" open>
              <summary class="knowledge-bank-head">
                <div>
                  <p class="eyebrow">Банк</p>
                  <h3>${escapeHtml(bank.bank)}</h3>
                  ${bank.phone ? `<p class="knowledge-bank-phone">${escapeHtml(bank.phone)}</p>` : ""}
                </div>
                <span>${(bank.programs || []).length} программ</span>
              </summary>
              <div class="knowledge-grid">
                ${(bank.programs || []).map((program) => renderKnowledgeProgramCard(program, bank)).join("")}
              </div>
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderKnowledgePrograms(banks) {
  const programs = banks.flatMap((bank) => (bank.programs || []).map((program) => ({ bank, program })));
  if (!programs.length) {
    return `<div class="empty">В базе знаний пока нет программ под выбранные фильтры.</div>`;
  }

  const groups = new Map(PROGRAM_TYPES.map((type) => [type, []]));
  programs.forEach((entry) => {
    const type = PROGRAM_TYPES.includes(entry.program.programType) ? entry.program.programType : "Стандарт";
    groups.get(type).push(entry);
  });
  return `
    <div class="knowledge-program-groups">
      ${[...groups.entries()]
        .filter(([, entries]) => entries.length)
        .map(([type, entries]) => {
          return `
            <details class="knowledge-program-group" open>
              <summary class="knowledge-program-group-head">
                <h4>${escapeHtml(type)}</h4>
                <span>${entries.length}</span>
              </summary>
              <div class="knowledge-grid">
                ${entries.map(({ bank, program }) => renderKnowledgeProgramCard(program, bank, true)).join("")}
              </div>
            </details>
          `;
        })
        .join("")}
    </div>
  `;
}

function updateApplicationDateRequirements() {
  const requiredFields = new Set(getStageDateRequirements(form.elements.stage.value).map((requirement) => requirement.field));
  const inquiryInput = form.elements.inquiryAt;
  const signedInput = form.elements.signedAt;

  if (!inquiryInput || !signedInput) {
    return;
  }

  inquiryInput.required = requiredFields.has("inquiryAt");
  signedInput.required = requiredFields.has("signedAt");
  inquiryInput.setCustomValidity("");
  signedInput.setCustomValidity("");
}

function renderKnowledgeView() {
  const items = filteredKnowledge();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">База знаний</p>
          <h2>${KNOWLEDGE_SECTIONS[state.knowledgeSection]}</h2>
        </div>
        ${renderKnowledgeFilters()}
      </div>
      ${renderKnowledgeSectionControls()}
      ${state.knowledgeSection === "banks" ? renderKnowledgeBanks(items) : renderKnowledgePrograms(items)}
    </section>
  `;
}

function renderCurrent() {
  const deals = filteredDeals("current");
  return `
    ${renderKpis()}
    <section class="content-grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Аналитики</p>
            <h2>Текущие клиенты</h2>
          </div>
          ${renderFilters(state.dashboard.deals.filter((deal) => deal.statusGroup === "current"))}
        </div>
        ${renderManagerGroups(deals)}
      </div>

      <aside class="panel">
        <p class="eyebrow">Контроль</p>
        <h2>Ближайшие действия</h2>
        <ul class="list">
          ${state.dashboard.currentSummary.nextActions
            .map(
              (deal) => `
                <li class="list-item">
                  <strong>${escapeHtml(deal.client)}</strong>
                  <span>${escapeHtml(deal.manager)} · ${escapeHtml(applicationProgramTitle(deal))} · ${escapeHtml(deal.stageLabel)}</span>
                  <span class="muted">${formatDate(deal.nextActionAt)}</span>
                </li>
              `
            )
            .join("") || `<li class="list-item muted">Нет запланированных действий.</li>`}
        </ul>
      </aside>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Воронка</p>
          <h2>Текущие заявки по статусам</h2>
        </div>
      </div>
      <div class="funnel">
        ${state.dashboard.currentFunnel
          .map(
            (stage) => `
              <article class="stage-column">
                <strong>${stage.label}</strong>
                <div class="stage-count">${stage.count}</div>
                <div class="stage-sum">${money(stage.amountRequested)}</div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderBarRows(items, labelKey, valueKey, classKey) {
  const max = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);
  return `
    <div class="chart-list">
      ${items
        .map((item) => {
          const value = Number(item[valueKey] || 0);
          const width = Math.max(4, Math.round((value / max) * 100));
          const label = item[labelKey] || item.label;
          const displayValue = valueKey.includes("Rate") ? `${value}%` : valueKey.includes("Amount") ? money(value) : item.count ?? value;
          return `
            <div class="bar-row">
              <strong>${escapeHtml(label)}</strong>
              <div class="bar-track"><div class="bar ${escapeHtml(item[classKey] || "")}" style="width: ${width}%"></div></div>
              <span>${displayValue}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function monthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: MOSCOW_TIME_ZONE,
      year: "numeric",
      month: "2-digit"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}`;
}

function dealActivityDate(deal) {
  return deal.signedAt || deal.submittedAt || deal.inquiryAt || deal.createdAt || deal.updatedAt || deal.lastActionAt;
}

function buildMonthlyActivity(deals, limit = 12) {
  const groups = new Map();

  deals.forEach((deal) => {
    const activityAt = dealActivityDate(deal);
    const key = monthKey(activityAt);
    if (!key) {
      return;
    }
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: monthLabelFormatter.format(new Date(activityAt)),
        count: 0,
        amountRequested: 0
      });
    }
    const group = groups.get(key);
    group.count += 1;
    group.amountRequested += Number(deal.amountRequested || 0);
  });

  return [...groups.values()].sort((left, right) => left.key.localeCompare(right.key)).slice(-limit);
}

function renderMonthlyActivityRows(items) {
  if (!items.length) {
    return `<div class="empty compact-empty">Нет данных для графика.</div>`;
  }

  const max = Math.max(...items.map((item) => item.count), 1);
  return `
    <div class="monthly-activity-list">
      ${items
        .map((item) => {
          const width = Math.max(4, Math.round((item.count / max) * 100));
          return `
            <div class="monthly-activity-row">
              <strong>${escapeHtml(item.label)}</strong>
              <div class="bar-track"><div class="bar" style="width: ${width}%"></div></div>
              <span>${item.count} · ${money(item.amountRequested)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSummaryCharts(groups, status = state.board.status) {
  const topByAmount = [...groups]
    .sort((left, right) => Number(right.amountRequested || 0) - Number(left.amountRequested || 0))
    .slice(0, 8);
  const qualityValueKey = status === "completed" ? "completedToSuccessConversionRate" : "leadToWorkingConversionRate";
  const topByQuality = [...groups]
    .filter((group) => Number(status === "completed" ? group.completedCount : group.leadCount + group.workingCount || 0) > 0)
    .sort((left, right) => Number(right[qualityValueKey] || 0) - Number(left[qualityValueKey] || 0))
    .slice(0, 8);
  const pipeline = [...groups]
    .sort((left, right) => Number(right.count || 0) - Number(left.count || 0))
    .slice(0, 8);
  const monthlyActivity = buildMonthlyActivity(state.dashboard.deals || []);

  return `
    <section class="summary-dashboard-grid">
      <article class="summary-chart-card">
        <p class="eyebrow">Динамика</p>
        <h3>Активность по месяцам</h3>
        ${renderMonthlyActivityRows(monthlyActivity)}
      </article>
      <article class="summary-chart-card">
        <p class="eyebrow">Объем</p>
        <h3>Топ по сумме заявок</h3>
        ${renderBarRows(topByAmount, "name", "amountRequested", "groupBy")}
      </article>
      <article class="summary-chart-card">
        <p class="eyebrow">Качество</p>
        <h3>${status === "completed" ? "Конверсия завершенных в успешные" : "Конверсия лидов в работу"}</h3>
        ${renderBarRows(topByQuality.length ? topByQuality : groups.slice(0, 8), "name", qualityValueKey, "groupBy")}
      </article>
      <article class="summary-chart-card">
        <p class="eyebrow">Структура</p>
        <h3>${status === "completed" ? "Одобрено · отказ / непринятые" : "План · лиды · работа"}</h3>
        <div class="pipeline-list">
          ${
            pipeline
              .map((group) => {
                const total = status === "completed"
                  ? Math.max(1, Number(group.successfulCount || 0) + Number(group.refusedCount || 0))
                  : Math.max(1, Number(group.planCount || 0) + Number(group.leadCount || 0) + Number(group.workingCount || 0));
                const width = (value) => Math.round((Number(value || 0) / total) * 100);
                return `
                  <div class="pipeline-row">
                    <strong>${escapeHtml(group.name)}</strong>
                    <div class="pipeline-track">
                      ${
                        status === "completed"
                          ? `
                            <span class="pipeline-done" style="width:${width(group.successfulCount)}%"></span>
                            <span class="pipeline-refused" style="width:${width(group.refusedCount)}%"></span>
                          `
                          : `
                            <span class="pipeline-plan" style="width:${width(group.planCount)}%"></span>
                            <span class="pipeline-lead" style="width:${width(group.leadCount)}%"></span>
                            <span class="pipeline-work" style="width:${width(group.workingCount)}%"></span>
                          `
                      }
                    </div>
                  </div>
                `;
              })
              .join("") || `<div class="empty compact-empty">Нет данных для графика.</div>`
          }
        </div>
      </article>
    </section>
  `;
}

function renderCompleted() {
  const deals = filteredDeals("completed");
  const byResult = state.dashboard.completedAnalytics.byResult.map((item) => ({ ...item, className: item.id }));
  return `
    ${renderKpis()}
    <section class="content-grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Аналитика</p>
            <h2>Итоги завершенных</h2>
          </div>
          ${renderFilters(state.dashboard.deals.filter((deal) => deal.statusGroup === "completed"))}
        </div>
        ${renderBarRows(byResult, "label", "count", "className")}
      </div>

      <aside class="panel">
        <p class="eyebrow">Банки</p>
        <h2>Конверсия по банкам</h2>
        <div class="chart-list">
          ${state.dashboard.completedAnalytics.byBank
            .map(
              (bank) => `
                <div class="list-item">
                  <strong>${escapeHtml(bank.bank)} · ${bank.conversionRate}%</strong>
                  <span class="muted">Одобрено ${bank.issuedCount} из ${bank.count}; среднее ${money(bank.averageApproved)}</span>
                </div>
              `
            )
            .join("") || `<div class="list-item muted">Нет завершенных заявок.</div>`}
        </div>
      </aside>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Реестр</p>
          <h2>Список завершенных сделок</h2>
        </div>
      </div>
      ${renderDealTable(deals)}
    </section>
  `;
}

function renderBoardControls() {
  return `
    <div class="board-controls">
      <div class="segmented" role="group" aria-label="Тип отчета">
        ${Object.entries(BOARD_STATUS_LABELS)
          .map(
            ([value, label]) => `
              <button class="${state.board.status === value ? "is-active" : ""}" data-board-status="${value}" type="button">${label}</button>
            `
          )
          .join("")}
      </div>
      <div class="segmented" role="group" aria-label="Группировка отчета">
        ${Object.entries(BOARD_GROUP_LABELS)
          .map(
            ([value, label]) => `
              <button class="${state.board.groupBy === value ? "is-active" : ""}" data-board-group="${value}" type="button">${label}</button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function resolveBoardApplications(group) {
  if (Array.isArray(group?.applicationIds) && group.applicationIds.length) {
    const dealById = new Map((state.dashboard?.deals || []).map((deal) => [deal.id, deal]));
    return group.applicationIds.map((id) => dealById.get(id)).filter(Boolean);
  }
  return Array.isArray(group?.applications) ? group.applications : [];
}

function renderBoardApplicationRows(applications, groupBy) {
  if (!applications.length) {
    return `<div class="empty compact-empty">Заявок нет.</div>`;
  }

  return `
    <div class="board-deal-list">
      ${applications
        .map(
          (deal) => {
            const contextLabel = groupBy === "bank"
              ? `${deal.client} · ${deal.manager} · ${deal.program || deal.bank}`
              : groupBy === "client"
                ? `${deal.manager} · ${applicationProgramTitle(deal)}`
                : applicationProgramTitle(deal);
            return `
            <article class="board-deal-row">
              <div>
                <strong>${escapeHtml(deal.client)}</strong>
                <span>${escapeHtml(contextLabel)} · ${escapeHtml(deal.stageLabel)}</span>
              </div>
              <div>
                <span>Дата заявки</span>
                <strong>${formatDate(deal.applicationDate)}</strong>
              </div>
              <div>
                <span>Последнее действие</span>
                <strong>${formatDate(deal.lastActionAt)}</strong>
              </div>
              <div>
                <span>Сумма заявки</span>
                <strong>${money(deal.amountRequested)}</strong>
              </div>
            </article>
          `;
          }
        )
        .join("")}
    </div>
  `;
}

function renderBoardSummaryGroups(groups) {
  if (!groups.length) {
    return `<div class="empty">Нет данных для выбранного отчета.</div>`;
  }

  return `
    <div class="board-group-stack">
      ${groups
        .map(
          (group) => `
            <details class="board-group-card">
              <summary>
                <div>
                  <p class="eyebrow">${BOARD_GROUP_EYEBROWS[state.board.groupBy] || "Группа"}</p>
                  <h3>${escapeHtml(group.name)}</h3>
                </div>
                <div class="manager-metrics">
                  <span>${group.count} заявок</span>
                  <strong>${money(group.amountRequested)} в выбранном отчете (${group.approvalConversionRate || 0}%)</strong>
                  ${renderSummaryAmountBadges(group, state.board.status)}
                  ${renderConversionBadges(group)}
                </div>
              </summary>
              ${renderBoardApplicationRows(resolveBoardApplications(group), state.board.groupBy)}
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSummary() {
  const groups = state.dashboard.boardSummaries?.[state.board.status]?.[state.board.groupBy] || [];
  const totals = renderReportTotals(groups);
  const reportTime = state.dashboard.time || { iso: state.dashboard.generatedAt, source: "server" };

  return `
    ${renderKpis()}
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Сводный отчет</p>
          <h2>${BOARD_STATUS_LABELS[state.board.status]} заявки · ${BOARD_GROUP_LABELS[state.board.groupBy].toLowerCase()}</h2>
          <p class="muted">${totals.count} заявок · ${money(totals.amountRequested)} в выбранном отчете (${totals.approvalConversionRate}%)</p>
          ${renderSummaryAmountBadges(totals, state.board.status)}
          ${renderConversionBadges(totals)}
          <p class="muted">Время отчета: ${formatDate(reportTime.iso)} MSK · источник: ${escapeHtml(reportTime.source || "server")}</p>
        </div>
        ${renderBoardControls()}
      </div>
      ${renderSummaryCharts(groups, state.board.status)}
      ${renderBoardSummaryGroups(groups)}
    </section>
  `;
}

function render() {
  if (!state.dashboard) {
    app.innerHTML = `<div class="loading">Загрузка данных...</div>`;
    return;
  }

  renderViewTabs();
  updateActionVisibility();

  const views = {
    funnels: renderManagerClientView,
    current: renderCurrent,
    completed: renderCompleted,
    archive: renderArchiveView,
    knowledge: renderKnowledgeView,
    summary: renderSummary
  };

  app.innerHTML = views[state.view]();
  bindDynamicControls();
}

let queryFilterDebounceTimer = null;

function scheduleQueryFilterRender(input) {
  const cursor = input.selectionStart;
  clearTimeout(queryFilterDebounceTimer);
  queryFilterDebounceTimer = setTimeout(() => {
    render();
    const next = document.querySelector("#queryFilter");
    if (next) {
      next.focus();
      if (cursor != null) {
        try {
          next.setSelectionRange(cursor, cursor);
        } catch {
          // setSelectionRange unsupported on this input type — ignore
        }
      }
    }
  }, 200);
}

async function handleSaveApplication(saveButton) {
  const card = saveButton.closest(".client-application-card");
  const stageSelect = card?.querySelector("[data-stage-select]");
  const dealId = saveButton.dataset.saveApplication;
  const currentStage = stageSelect?.dataset.currentStage || "";
  const nextStage = stageSelect?.value || currentStage;
  const requirements = getStageDateRequirements(nextStage, currentStage);
  const payload = { stage: nextStage };

  for (const requirement of requirements) {
    const dateInput = card?.querySelector(`[data-field="${requirement.field}"]`);
    if (!dateInput?.value) {
      dateInput?.focus();
      dateInput?.setCustomValidity(`${requirement.label} обязательна для выбранного статуса`);
      dateInput?.reportValidity();
      dateInput?.addEventListener("input", () => dateInput.setCustomValidity(""), { once: true });
      return;
    }
    payload[requirement.field] = dateInput.value;
  }

  card?.querySelectorAll("[data-application-field]").forEach((input) => {
    if (input.dataset.field) {
      payload[input.dataset.field] = input.value;
    }
  });

  const uiSnapshot = captureUiState();
  setClientRefreshState(card, saveButton, true);
  try {
    const { deal } = await requestJson(`/api/deals/${encodeURIComponent(dealId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    closeApplicationCard(card);
    await refreshDashboard({ restoreUi: preserveClientOpenState(uiSnapshot, deal) });
  } catch (error) {
    setClientRefreshState(card, saveButton, false);
    window.alert(error.message);
  }
}

async function handleDeleteManager(button) {
  if (!button.dataset.deleteManager) {
    return;
  }
  const confirmed = window.confirm(`Удалить аналитика "${button.dataset.managerName}"?`);
  if (!confirmed) {
    return;
  }
  await requestJson(`/api/managers/${encodeURIComponent(button.dataset.deleteManager)}`, { method: "DELETE" });
  await loadData({ targets: ["managers", "dashboard"] });
}

async function handleArchiveClient(button) {
  if (!button.dataset.archiveClient) {
    return;
  }
  const confirmed = window.confirm(`Отправить клиента "${button.dataset.clientName}" в архив?`);
  if (!confirmed) {
    return;
  }
  await requestJson(`/api/clients/${encodeURIComponent(button.dataset.archiveClient)}/archive`, { method: "PATCH" });
  await loadData({ targets: ["clients", "dashboard"] });
}

let dynamicControlsInitialized = false;

function initDynamicControls() {
  if (dynamicControlsInitialized) {
    return;
  }
  dynamicControlsInitialized = true;

  app.addEventListener("input", (event) => {
    if (event.target?.id === "queryFilter") {
      state.filters.query = event.target.value;
      scheduleQueryFilterRender(event.target);
    }
  });

  app.addEventListener("change", (event) => {
    const target = event.target;
    if (!target?.id) {
      return;
    }
    switch (target.id) {
      case "managerFilter":
        state.filters.manager = target.value;
        render();
        break;
      case "bankFilter":
        state.filters.bank = target.value;
        render();
        break;
      case "stageFilter":
        state.filters.stage = target.value;
        render();
        break;
      default:
        break;
    }
  });

  app.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const programLink = target.closest(".knowledge-program-link, .application-program-link");
    if (programLink) {
      event.stopPropagation();
      return;
    }

    const boardStatus = target.closest("[data-board-status]");
    if (boardStatus) {
      state.board.status = boardStatus.dataset.boardStatus;
      render();
      return;
    }

    const boardGroup = target.closest("[data-board-group]");
    if (boardGroup) {
      state.board.groupBy = boardGroup.dataset.boardGroup;
      render();
      return;
    }

    const archiveGroup = target.closest("[data-archive-group]");
    if (archiveGroup) {
      state.archive.groupBy = archiveGroup.dataset.archiveGroup;
      render();
      return;
    }

    const knowledgeSection = target.closest("[data-knowledge-section]");
    if (knowledgeSection) {
      state.knowledgeSection = knowledgeSection.dataset.knowledgeSection;
      render();
      return;
    }

    const addApplication = target.closest("[data-add-application]");
    if (addApplication) {
      event.preventDefault();
      event.stopPropagation();
      openApplicationDialog(addApplication.dataset.manager, addApplication.dataset.client);
      return;
    }

    const deleteManager = target.closest("[data-delete-manager]");
    if (deleteManager) {
      event.preventDefault();
      event.stopPropagation();
      await handleDeleteManager(deleteManager);
      return;
    }

    const archiveClient = target.closest("[data-archive-client]");
    if (archiveClient) {
      event.preventDefault();
      event.stopPropagation();
      await handleArchiveClient(archiveClient);
      return;
    }

    const addDealAction = target.closest("[data-add-deal-action]");
    if (addDealAction) {
      event.preventDefault();
      event.stopPropagation();
      openDealActionDialog(addDealAction.dataset.addDealAction);
      return;
    }

    const editKnowledge = target.closest("[data-edit-knowledge]");
    if (editKnowledge) {
      event.preventDefault();
      event.stopPropagation();
      const entry = findKnowledgeProgram(editKnowledge.dataset.editKnowledge);
      if (entry) {
        openKnowledgeDialog(entry);
      }
      return;
    }

    const saveApplication = target.closest("[data-save-application]");
    if (saveApplication) {
      event.preventDefault();
      event.stopPropagation();
      await handleSaveApplication(saveApplication);
    }
  });
}

function bindDynamicControls() {
  initDynamicControls();
}

function fillDealFormOptions() {
  const programSelect = form.elements.knowledgeProgramId;
  const stageSelect = form.elements.stage;
  const clientOptions = document.querySelector("#clientOptions");
  const bankOptions = document.querySelector("#bankOptions");

  const managerOptions = state.managers
    .map((manager) => `<option value="${escapeHtml(manager.name)}">${escapeHtml(manager.name)}</option>`)
    .join("");
  const clientNames = [...new Set([...state.clients.map((client) => client.name), ...state.dashboard.deals.map((deal) => deal.client)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));
  const bankNames = [
    ...new Set([
      ...state.banks.map((bank) => bank.name),
      ...state.dashboard.deals.map((deal) => deal.bank),
      ...state.knowledge.map((entry) => entry.bank)
    ])
  ].sort((a, b) => a.localeCompare(b, "ru"));
  [form.elements.manager, clientForm.elements.manager].forEach((select) => {
    const selected = select.value;
    select.innerHTML = `<option value="">Выберите аналитика</option>${managerOptions || `<option value="" disabled>Сначала добавьте аналитика</option>`}`;
    if (selected && state.managers.some((manager) => manager.name === selected)) {
      select.value = selected;
    }
  });
  clientOptions.innerHTML = clientNames.map((client) => `<option value="${escapeHtml(client)}"></option>`).join("");
  bankOptions.innerHTML = bankNames.map((bank) => `<option value="${escapeHtml(bank)}"></option>`).join("");
  programSelect.innerHTML = renderApplicationProgramOptions();
  stageSelect.value = "planned";
  syncApplicationProgramFields();
  updateApplicationDateRequirements();
}

function findKnowledgeProgram(programId) {
  for (const bank of state.knowledge) {
    const program = (bank.programs || []).find((item) => item.id === programId);
    if (program) {
      return { bank, program };
    }
  }
  return null;
}

function openKnowledgeDialog(entry = null) {
  fillDealFormOptions();
  knowledgeForm.reset();
  knowledgeForm.elements.programId.value = entry?.program?.id || "";
  knowledgeForm.elements.bank.value = entry?.bank?.bank || "";
  knowledgeForm.elements.bankPhone.value = entry?.bank?.phone || entry?.program?.bankPhone || "";
  knowledgeForm.elements.program.value = entry?.program?.program || "";
  knowledgeForm.elements.programUrl.value = entry?.program?.programUrl || "";
  knowledgeForm.elements.amountRange.value = entry?.program?.amountRange || "";
  knowledgeForm.elements.termRange.value = entry?.program?.termRange || "";
  knowledgeForm.elements.reviewTermDeclared.value = entry?.program?.reviewTermDeclared || "";
  knowledgeForm.elements.programType.value = PROGRAM_TYPES.includes(entry?.program?.programType) ? entry.program.programType : "Стандарт";

  const requirements = entry?.program?.requirements || {};
  Object.keys(REQUIREMENT_LABELS).forEach((key) => {
    knowledgeForm.elements[key].value = requirements[key] || "";
  });
  knowledgeForm.elements.notes.value = entry?.program?.notes || "";
  knowledgeForm.elements.changeHistory.value = entry?.program?.changeHistory || "";
  if (knowledgeDialogTitle) {
    knowledgeDialogTitle.textContent = entry ? "Редактировать программу" : "Новая запись";
  }
  knowledgeDialog.showModal();
}

function openApplicationDialog(manager, client) {
  fillDealFormOptions();
  form.reset();
  setDealDialogLoading(false);
  form.elements.manager.value = manager || "";
  form.elements.client.value = client || "";
  form.elements.managerLocked.value = manager || "";
  form.elements.manager.disabled = true;
  form.elements.client.readOnly = true;
  form.elements.stage.value = "planned";
  syncApplicationProgramFields();
  updateApplicationDateRequirements();
  dialog.showModal();
}

function openDealActionDialog(dealId) {
  dealActionForm.reset();
  dealActionForm.elements.dealId.value = dealId;
  dealActionForm.elements.actionAt.value = formatDateTimeInput(state.dashboard?.time?.iso || new Date().toISOString());
  dealActionDialog.showModal();
}

refreshButton.addEventListener("click", loadData);

newManagerButton.addEventListener("click", () => {
  managerForm.reset();
  managerDialog.showModal();
});

form.elements.stage.addEventListener("change", updateApplicationDateRequirements);
form.elements.knowledgeProgramId.addEventListener("change", syncApplicationProgramFields);

if (newDealButton) {
  newDealButton.addEventListener("click", () => {
    fillDealFormOptions();
    form.reset();
    setDealDialogLoading(false);
    form.elements.manager.disabled = false;
    form.elements.managerLocked.value = "";
    form.elements.client.readOnly = false;
    form.elements.stage.value = "planned";
    syncApplicationProgramFields();
    updateApplicationDateRequirements();
    dialog.showModal();
  });
}

newClientButton.addEventListener("click", () => {
  fillDealFormOptions();
  clientForm.reset();
  clientDialog.showModal();
});

managerForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(managerForm);
  await requestJson("/api/managers", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData.entries()))
  });
  managerDialog.close();
  await loadData({ targets: ["managers"] });
});

newKnowledgeButton.addEventListener("click", () => {
  openKnowledgeDialog();
});

form.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  syncApplicationProgramFields();
  updateApplicationDateRequirements();
  if (!form.reportValidity()) {
    return;
  }

  const formData = new FormData(form);
  if (form.elements.manager.disabled) {
    formData.set("manager", form.elements.managerLocked.value);
  }
  formData.delete("managerLocked");
  const uiSnapshot = captureUiState();
  setDealDialogLoading(true);

  try {
    const { deal } = await requestJson("/api/deals", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(formData.entries()))
    });
    try {
      await refreshDashboard({ restoreUi: preserveClientOpenState(uiSnapshot, deal) });
    } finally {
      dialog.close();
    }
  } catch (error) {
    window.alert(error.message);
  } finally {
    setDealDialogLoading(false);
  }
});

clientForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(clientForm);
  await requestJson("/api/clients", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData.entries()))
  });
  clientDialog.close();
  await loadData({ targets: ["clients"] });
});

dealActionForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(dealActionForm);
  const dealId = formData.get("dealId");
  await requestJson(`/api/deals/${encodeURIComponent(dealId)}/actions`, {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData.entries()))
  });
  dealActionDialog.close();
  await refreshDashboard();
});

knowledgeForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(knowledgeForm);
  const payload = Object.fromEntries(formData.entries());
  const programId = payload.programId;
  delete payload.programId;
  await requestJson(programId ? `/api/knowledge/programs/${encodeURIComponent(programId)}` : "/api/knowledge", {
    method: programId ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
  knowledgeDialog.close();
  state.view = "knowledge";
  await loadData({ targets: ["knowledge"] });
});

loadData().catch((error) => {
  app.innerHTML = `<div class="empty">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
});
