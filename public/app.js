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
  view: "funnels"
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
  { id: "funnels", label: "Аналитики" },
  { id: "summary", label: "Сводный отчет" },
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
  bank: "По банкам"
};

const ARCHIVE_GROUP_LABELS = {
  manager: "По аналитикам",
  date: "По дате добавления"
};

const PROGRAM_TYPES = ["Экспресс", "Стандарт", "Физическое лицо", "Добивка"];
const KNOWLEDGE_SECTIONS = {
  banks: "Банки",
  programs: "Программы"
};

const currency = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
  style: "currency",
  currency: "RUB"
});

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const actionDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const actionTime = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit"
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

function earliestDate(values) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  return timestamps.length ? new Date(timestamps[0]).toISOString() : "";
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
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
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

async function loadData() {
  const [dashboard, bankPayload, clientPayload, managerPayload, knowledgePayload] = await Promise.all([
    requestJson("/api/dashboard"),
    requestJson("/api/banks"),
    requestJson("/api/clients"),
    requestJson("/api/managers"),
    requestJson("/api/knowledge")
  ]);
  state.dashboard = dashboard;
  state.banks = bankPayload.banks;
  state.clients = clientPayload.clients;
  state.managers = managerPayload.managers;
  state.knowledge = knowledgePayload.knowledge;
  render();
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
    ["Текущие заявки", totals.current],
    ["Завершенные", totals.completed],
    ["Одобрено", totals.issued],
    ["Просрочено действий", totals.overdue],
    ["Конверсия завершенных", `${totals.completedConversionRate}%`]
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
  const clientKey = (manager, client) => `${manager || ""}\u0000${client || ""}`;

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
          const sortedApplications = applications.sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0));
          const meta = clientMeta.get(clientKey(manager, client)) || {};
          const plannedApplications = sortedApplications.filter((deal) => deal.stage === "planned");
          const currentApplications = sortedApplications.filter((deal) => deal.statusGroup === "current" && deal.stage !== "planned");
          const successfulApplications = sortedApplications.filter((deal) => deal.stage === "approved");
          const refusedApplications = sortedApplications.filter((deal) => deal.stage === "rejected" || deal.stage === "blocked");
          const activeApplications = [...currentApplications, ...plannedApplications];
          const completedApplications = [...successfulApplications, ...refusedApplications];
          const sumRequested = (items) => items.reduce((total, deal) => total + Number(deal.amountRequested || 0), 0);
          const sumApproved = (items) => items.reduce((total, deal) => total + Number(deal.amountApproved || 0), 0);
          const startedAt = earliestDate(sortedApplications.flatMap((deal) => [deal.inquiryAt, deal.signedAt]));
          const addedAt = meta.createdAt || earliestDate(sortedApplications.map((deal) => deal.createdAt));
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
            createdAt: addedAt,
            count: sortedApplications.length,
            activeCount: activeApplications.length,
            completedCount: completedApplications.length,
            currentCount: currentApplications.length,
            plannedCount: plannedApplications.length,
            successfulCount: successfulApplications.length,
            refusedCount: refusedApplications.length,
            amountRequested: sumRequested(sortedApplications),
            amountApproved: sumApproved(sortedApplications),
            plannedAmountRequested: sumRequested(plannedApplications),
            currentAmountRequested: sumRequested(currentApplications),
            approvedAmount: sumApproved(successfulApplications),
            startedAt,
            lastActionAt: sortedApplications[0]?.lastActionAt || "",
            activeApplications,
            currentApplications,
            plannedApplications,
            completedApplications,
            successfulApplications,
            refusedApplications,
            applications: sortedApplications
          };
        })
        .sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0) || b.count - a.count);

      const currentClients = clientGroups.filter((client) => client.activeCount > 0 || client.count === 0);
      const completedClients = clientGroups.filter((client) => client.completedCount > 0);
      const archivedClients = clientGroups.filter((client) => client.activeCount === 0 && client.completedCount > 0);

      return {
        managerId: managerRecord.id,
        manager,
        clientCount: clientGroups.length,
        count: clientGroups.reduce((total, client) => total + client.count, 0),
        activeCount: clientGroups.reduce((total, client) => total + client.activeCount, 0),
        completedCount: clientGroups.reduce((total, client) => total + client.completedCount, 0),
        currentCount: clientGroups.reduce((total, client) => total + client.currentCount, 0),
        plannedCount: clientGroups.reduce((total, client) => total + client.plannedCount, 0),
        successfulCount: clientGroups.reduce((total, client) => total + client.successfulCount, 0),
        refusedCount: clientGroups.reduce((total, client) => total + client.refusedCount, 0),
        amountRequested: clientGroups.reduce((total, client) => total + client.amountRequested, 0),
        amountApproved: clientGroups.reduce((total, client) => total + client.amountApproved, 0),
        plannedAmountRequested: clientGroups.reduce((total, client) => total + client.plannedAmountRequested, 0),
        currentAmountRequested: clientGroups.reduce((total, client) => total + client.currentAmountRequested, 0),
        approvedAmount: clientGroups.reduce((total, client) => total + client.approvedAmount, 0),
        lastActionAt: clientGroups[0]?.lastActionAt || "",
        currentClients,
        completedClients,
        archivedClients,
        clients: clientGroups
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
                  <td>${escapeHtml(applicationProgramTitle(deal))}</td>
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
            <article class="client-application-card application-card-${escapeHtml(type)} ${applicationStageClass(deal.stage)}">
              <div class="application-card-head">
                <strong>${escapeHtml(applicationProgramTitle(deal))}</strong>
                <span>${money(deal.amountRequested)}</span>
                <em>${escapeHtml(deal.stageLabel)}</em>
              </div>
              <button class="ghost-button small-button application-action-button" data-add-deal-action="${escapeHtml(deal.id)}" type="button">
                + Действие
              </button>
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
                <input data-application-date="${escapeHtml(deal.id)}" data-date-field="inquiryAt" type="datetime-local" value="${formatDateTimeInput(deal.inquiryAt)}">
              </label>
              <label class="application-field">
                <span>Дата подписания</span>
                <input data-application-date="${escapeHtml(deal.id)}" data-date-field="signedAt" type="datetime-local" value="${formatDateTimeInput(deal.signedAt)}">
              </label>
              <div class="application-field">
                <span>Последнее действие</span>
                <strong>${formatDate(deal.lastActionAt)}</strong>
              </div>
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
            </article>
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
  const currentSection = ["Текущие", client.currentApplications || [], client.currentCount || 0, "Текущих заявок нет.", "current", false];
  const approvedSection = ["Одобрено", client.successfulApplications || [], client.successfulCount || 0, "Одобренных заявок нет.", "approved", false];
  const refusedSection = ["Отказ / непринятые", client.refusedApplications || [], client.refusedCount || 0, "Отказов и непринятых заявок нет.", "refused", true];

  return `
    <div class="application-split">
      ${renderSection(plannedSection)}
      ${renderSection(currentSection)}
      <div class="application-completed-rail">
        ${renderSection(approvedSection)}
        ${renderSection(refusedSection)}
      </div>
    </div>
  `;
}

function renderSummaryAmountBadges(source) {
  return `
    <div class="summary-amounts">
      <span>План подач <strong>${money(source.plannedAmountRequested)}</strong></span>
      <span>Текущие <strong>${money(source.currentAmountRequested)}</strong></span>
      <span>Одобрено <strong>${money(source.approvedAmount)}</strong></span>
    </div>
  `;
}

function renderReportTotals(groups) {
  const totalRequested = groups.reduce((total, group) => total + Number(group.totalAmountRequested || group.amountRequested || 0), 0);
  const approvedAmount = groups.reduce((total, group) => total + Number(group.approvedAmount || 0), 0);
  return {
    count: groups.reduce((total, group) => total + group.count, 0),
    amountRequested: groups.reduce((total, group) => total + Number(group.amountRequested || 0), 0),
    totalAmountRequested: totalRequested,
    plannedAmountRequested: groups.reduce((total, group) => total + Number(group.plannedAmountRequested || 0), 0),
    currentAmountRequested: groups.reduce((total, group) => total + Number(group.currentAmountRequested || 0), 0),
    approvedAmount,
    approvalConversionRate: percent(approvedAmount, totalRequested)
  };
}

function renderAddApplicationButton(manager, client) {
  return `
    <div class="client-actions">
      <button
        class="ghost-button small-button"
        data-add-application
        data-manager="${escapeHtml(manager)}"
        data-client="${escapeHtml(client)}"
        type="button"
      >
        + Заявка
      </button>
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
        <span>Текущие заявки <strong>${client.currentCount || 0} · ${money(client.currentAmountRequested)}</strong></span>
        <span>Одобрения <strong>${client.successfulCount || 0} · ${money(client.approvedAmount)}</strong></span>
        <span>Завершенные подачи <strong>${completedLabel}</strong></span>
      </div>
      <div class="client-summary-dates">
        ${settings.showAddedAt ? `<span>Дата добавления: ${formatDateWithAge(client.createdAt, "назад")}</span>` : ""}
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
            <details class="manager-section manager-accordion">
              <summary class="manager-head">
                <div>
                  <p class="eyebrow">Аналитик</p>
                  <h3>${escapeHtml(manager.manager)}</h3>
                </div>
                <div class="manager-metrics">
                  <span>${manager.clientCount} клиентов</span>
                  <strong>${manager.count} заявок</strong>
                  <span>${money(manager.amountRequested)}</span>
                </div>
              </summary>
              <div class="client-stack">
                ${manager.clients
                  .map(
                    (client) => `
                      <details class="client-card">
                        <summary>
                          ${renderClientSummary(client, "active")}
                        </summary>
                        <div class="client-drilldown">
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
  const settings = { allowAddApplication: true, showAddedAt: false, ...options };
  if (!clients.length) {
    return `<div class="empty compact-empty">${emptyText}</div>`;
  }

  return `
    <div class="client-stack">
      ${clients
        .map(
          (client) => `
            <details class="client-card">
              <summary>
                ${renderClientSummary(client, { showAddedAt: settings.showAddedAt })}
              </summary>
              <div class="client-drilldown">
                ${settings.allowAddApplication ? renderAddApplicationButton(client.manager || "", client.client) : ""}
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
            <details class="manager-section manager-accordion">
              <summary class="manager-head">
                <div>
                  <p class="eyebrow">Аналитик</p>
                  <h3>${escapeHtml(manager.manager)}</h3>
                </div>
                <div class="manager-metrics">
                  ${renderArchiveMetrics(manager.clients)}
                </div>
              </summary>
              ${renderClientCards(manager.clients, "Архивных клиентов нет.", { allowAddApplication: false, showAddedAt: true })}
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
            <details class="manager-section manager-accordion">
              <summary class="manager-head">
                <div>
                  <p class="eyebrow">Дата добавления</p>
                  <h3>${escapeHtml(group.label)}</h3>
                </div>
                <div class="manager-metrics">
                  ${renderArchiveMetrics(group.clients)}
                </div>
              </summary>
              ${renderClientCards(group.clients, "Архивных клиентов нет.", { allowAddApplication: false, showAddedAt: true })}
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
          <p class="muted">В архив попадают клиенты без плановых и текущих заявок, у которых есть одобрения, отказы или непринятые заявки.</p>
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
                    <details class="manager-section manager-accordion">
                      <summary class="manager-head">
                        <div>
                          <p class="eyebrow">Аналитик</p>
                          <h3>${escapeHtml(manager.manager)}</h3>
                        </div>
                        <div class="manager-metrics">
                          <strong>${manager.clientCount} клиентов</strong>
                          <div class="summary-amounts">
                            <span>План подач <strong>${manager.plannedCount} · ${money(manager.plannedAmountRequested)}</strong></span>
                            <span>Текущие заявки <strong>${manager.currentCount} · ${money(manager.currentAmountRequested)}</strong></span>
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
        return [bank.bank, program.program, program.programType, program.amountRange, program.notes, requirementText].join(" ").toLowerCase().includes(query);
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

function flattenKnowledgePrograms() {
  return state.knowledge.flatMap((bank) =>
    (bank.programs || []).map((program) => ({
      bank,
      program,
      label: `${bank.bank} - ${program.program}${program.amountRange ? ` (${program.amountRange})` : ""}`
    }))
  );
}

function applicationProgramTitle(deal) {
  if (!deal.program) {
    return deal.bank || "Программа не выбрана";
  }
  return `${deal.bank} - ${deal.program}${deal.programAmountRange ? ` (${deal.programAmountRange})` : ""}`;
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
  return `
    <article class="knowledge-card">
      <div class="knowledge-card-head">
        <div>
          <p class="eyebrow">${showBank ? escapeHtml(bank.bank) : "Программа"}</p>
          <h4>${escapeHtml(program.program)}${program.amountRange ? ` <span>${escapeHtml(program.amountRange)}</span>` : ""}</h4>
        </div>
        <div class="knowledge-card-actions">
          <time>${formatDate(program.updatedAt || bank.updatedAt)}</time>
          <button class="ghost-button small-button" data-edit-knowledge="${escapeHtml(program.id)}" type="button">Редактировать</button>
        </div>
      </div>
      ${renderRequirementGrid(program.requirements)}
      <p class="knowledge-note">${escapeHtml(program.notes || "Без заметок")}</p>
    </article>
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
            <section class="knowledge-program-group">
              <div class="knowledge-program-group-head">
                <h4>${escapeHtml(type)}</h4>
                <span>${entries.length}</span>
              </div>
              <div class="knowledge-grid">
                ${entries.map(({ bank, program }) => renderKnowledgeProgramCard(program, bank, true)).join("")}
              </div>
            </section>
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
          const width = Math.max(4, Math.round((Number(item[valueKey] || 0) / max) * 100));
          const label = item[labelKey] || item.label;
          return `
            <div class="bar-row">
              <strong>${escapeHtml(label)}</strong>
              <div class="bar-track"><div class="bar ${escapeHtml(item[classKey] || "")}" style="width: ${width}%"></div></div>
              <span>${item.count ?? money(item[valueKey])}</span>
            </div>
          `;
        })
        .join("")}
    </div>
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

function renderBoardApplicationRows(applications, groupBy) {
  if (!applications.length) {
    return `<div class="empty compact-empty">Заявок нет.</div>`;
  }

  return `
    <div class="board-deal-list">
      ${applications
        .map(
          (deal) => `
            <article class="board-deal-row">
              <div>
                <strong>${escapeHtml(deal.client)}</strong>
                <span>${escapeHtml(groupBy === "bank" ? `${deal.manager} · ${deal.program || deal.bank}` : applicationProgramTitle(deal))} · ${escapeHtml(deal.stageLabel)}</span>
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
          `
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
                  <p class="eyebrow">${state.board.groupBy === "bank" ? "Банк" : "Аналитик"}</p>
                  <h3>${escapeHtml(group.name)}</h3>
                </div>
                <div class="manager-metrics">
                  <span>${group.count} заявок</span>
                  <strong>Всего ${money(group.totalAmountRequested || group.amountRequested)} (${group.approvalConversionRate || 0}%)</strong>
                  ${renderSummaryAmountBadges(group)}
                  <span>В выбранном отчете ${money(group.amountRequested)}</span>
                </div>
              </summary>
              ${renderBoardApplicationRows(group.applications || [], state.board.groupBy)}
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

  return `
    ${renderKpis()}
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Сводный отчет</p>
          <h2>${BOARD_STATUS_LABELS[state.board.status]} заявки · ${BOARD_GROUP_LABELS[state.board.groupBy].toLowerCase()}</h2>
          <p class="muted">${totals.count} заявок · ${money(totals.amountRequested)} в выбранном отчете · всего ${money(totals.totalAmountRequested)} (${totals.approvalConversionRate}%)</p>
          ${renderSummaryAmountBadges(totals)}
        </div>
        ${renderBoardControls()}
      </div>
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

function bindDynamicControls() {
  const queryFilter = document.querySelector("#queryFilter");
  const managerFilter = document.querySelector("#managerFilter");
  const bankFilter = document.querySelector("#bankFilter");
  const stageFilter = document.querySelector("#stageFilter");

  if (queryFilter) {
    queryFilter.addEventListener("input", (event) => {
      state.filters.query = event.target.value;
      render();
    });
  }

  if (managerFilter) {
    managerFilter.addEventListener("change", (event) => {
      state.filters.manager = event.target.value;
      render();
    });
  }

  if (bankFilter) {
    bankFilter.addEventListener("change", (event) => {
      state.filters.bank = event.target.value;
      render();
    });
  }

  if (stageFilter) {
    stageFilter.addEventListener("change", (event) => {
      state.filters.stage = event.target.value;
      render();
    });
  }

  document.querySelectorAll("[data-board-status]").forEach((button) => {
    button.addEventListener("click", () => {
      state.board.status = button.dataset.boardStatus;
      render();
    });
  });

  document.querySelectorAll("[data-board-group]").forEach((button) => {
    button.addEventListener("click", () => {
      state.board.groupBy = button.dataset.boardGroup;
      render();
    });
  });

  document.querySelectorAll("[data-archive-group]").forEach((button) => {
    button.addEventListener("click", () => {
      state.archive.groupBy = button.dataset.archiveGroup;
      render();
    });
  });

  document.querySelectorAll("[data-knowledge-section]").forEach((button) => {
    button.addEventListener("click", () => {
      state.knowledgeSection = button.dataset.knowledgeSection;
      render();
    });
  });

  document.querySelectorAll("[data-add-application]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openApplicationDialog(button.dataset.manager, button.dataset.client);
    });
  });

  document.querySelectorAll("[data-delete-manager]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!button.dataset.deleteManager) {
        return;
      }
      const confirmed = window.confirm(`Удалить аналитика "${button.dataset.managerName}"?`);
      if (!confirmed) {
        return;
      }
      await requestJson(`/api/managers/${encodeURIComponent(button.dataset.deleteManager)}`, { method: "DELETE" });
      await loadData();
    });
  });

  document.querySelectorAll("[data-add-deal-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDealActionDialog(button.dataset.addDealAction);
    });
  });

  document.querySelectorAll("[data-edit-knowledge]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const entry = findKnowledgeProgram(button.dataset.editKnowledge);
      if (entry) {
        openKnowledgeDialog(entry);
      }
    });
  });

  document.querySelectorAll("[data-stage-select]").forEach((select) => {
    select.addEventListener("change", async (event) => {
      const currentStage = event.target.dataset.currentStage || "";
      const requirements = getStageDateRequirements(event.target.value, currentStage);
      const card = event.target.closest(".client-application-card");
      const payload = { stage: event.target.value };

      for (const requirement of requirements) {
        const dateInput = card?.querySelector(`[data-date-field="${requirement.field}"]`);
        if (!dateInput?.value) {
          event.target.value = currentStage;
          dateInput?.focus();
          dateInput?.setCustomValidity(`${requirement.label} обязательна для выбранного статуса`);
          dateInput?.reportValidity();
          dateInput?.addEventListener("input", () => dateInput.setCustomValidity(""), { once: true });
          return;
        }
        payload[requirement.field] = dateInput.value;
      }

      await requestJson(`/api/deals/${encodeURIComponent(event.target.dataset.stageSelect)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      await loadData();
    });
  });

  document.querySelectorAll("[data-application-date]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      await requestJson(`/api/deals/${encodeURIComponent(event.target.dataset.applicationDate)}`, {
        method: "PATCH",
        body: JSON.stringify({ [event.target.dataset.dateField]: event.target.value })
      });
      await loadData();
    });
  });
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
  stageSelect.innerHTML = state.dashboard.stages.all
    .map((stage) => `<option value="${stage.id}">${stage.label}</option>`)
    .join("");
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
  knowledgeForm.elements.program.value = entry?.program?.program || "";
  knowledgeForm.elements.amountRange.value = entry?.program?.amountRange || "";
  knowledgeForm.elements.programType.value = PROGRAM_TYPES.includes(entry?.program?.programType) ? entry.program.programType : "Стандарт";

  const requirements = entry?.program?.requirements || {};
  Object.keys(REQUIREMENT_LABELS).forEach((key) => {
    knowledgeForm.elements[key].value = requirements[key] || "";
  });
  knowledgeForm.elements.notes.value = entry?.program?.notes || "";
  if (knowledgeDialogTitle) {
    knowledgeDialogTitle.textContent = entry ? "Редактировать программу" : "Новая запись";
  }
  knowledgeDialog.showModal();
}

function openApplicationDialog(manager, client) {
  fillDealFormOptions();
  form.reset();
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
  dealActionForm.elements.actionAt.value = formatDateTimeInput(new Date().toISOString());
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
  await loadData();
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
  await requestJson("/api/deals", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData.entries()))
  });
  dialog.close();
  await loadData();
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
  await loadData();
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
  await loadData();
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
  await loadData();
});

loadData().catch((error) => {
  app.innerHTML = `<div class="empty">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
});
