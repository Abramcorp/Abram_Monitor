"use strict";

const state = {
  banks: [],
  clients: [],
  dashboard: null,
  knowledge: [],
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
  mode: "analyst",
  view: "funnels"
};

const app = document.querySelector("#app");
const modeTabs = document.querySelectorAll("[data-mode]");
const viewTabs = document.querySelector("#viewTabs");
const refreshButton = document.querySelector("#refreshButton");
const newClientButton = document.querySelector("#newClientButton");
const newDealButton = document.querySelector("#newDealButton");
const newKnowledgeButton = document.querySelector("#newKnowledgeButton");
const dialog = document.querySelector("#dealDialog");
const form = document.querySelector("#dealForm");
const clientDialog = document.querySelector("#clientDialog");
const clientForm = document.querySelector("#clientForm");
const knowledgeDialog = document.querySelector("#knowledgeDialog");
const knowledgeForm = document.querySelector("#knowledgeForm");

const VIEWS_BY_MODE = {
  analyst: [
    { id: "funnels", label: "Менеджеры" },
    { id: "knowledge", label: "База знаний" }
  ],
  board: [
    { id: "summary", label: "Сводный отчет" },
    { id: "knowledge", label: "База знаний" }
  ]
};

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
  manager: "По менеджерам",
  bank: "По банкам"
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

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
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
  const [dashboard, bankPayload, clientPayload, knowledgePayload] = await Promise.all([
    requestJson("/api/dashboard"),
    requestJson("/api/banks"),
    requestJson("/api/clients"),
    requestJson("/api/knowledge")
  ]);
  state.dashboard = dashboard;
  state.banks = bankPayload.banks;
  state.clients = clientPayload.clients;
  state.knowledge = knowledgePayload.knowledge;
  render();
}

function resetFilters() {
  state.filters = { query: "", manager: "all", bank: "all", stage: "all" };
}

function renderViewTabs() {
  viewTabs.innerHTML = VIEWS_BY_MODE[state.mode]
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
  const analystMode = state.mode === "analyst";
  newClientButton.hidden = !analystMode;
  newDealButton.hidden = !analystMode;
  newKnowledgeButton.hidden = false;
}

function renderKpis() {
  const totals = state.dashboard.totals;
  const kpis = [
    ["Текущие сделки", totals.current],
    ["Завершенные", totals.completed],
    ["Выдано", totals.issued],
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
      <input id="queryFilter" value="${escapeHtml(state.filters.query)}" placeholder="Клиент, менеджер, банк">
      <select id="managerFilter">
        <option value="all">Все менеджеры</option>
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
      return [deal.client, deal.manager, deal.bank, deal.status, deal.comment, deal.timeline].join(" ").toLowerCase().includes(query);
    });
}

function groupDealsByManagerAndClient(deals, clients = []) {
  const managers = new Map();
  clients.forEach((client) => {
    const managerName = client.manager || "Без менеджера";
    if (!managers.has(managerName)) {
      managers.set(managerName, new Map());
    }
    const managerClients = managers.get(managerName);
    if (!managerClients.has(client.name)) {
      managerClients.set(client.name, []);
    }
  });

  deals.forEach((deal) => {
    if (!managers.has(deal.manager)) {
      managers.set(deal.manager, new Map());
    }

    const clients = managers.get(deal.manager);
    if (!clients.has(deal.client)) {
      clients.set(deal.client, []);
    }

    clients.get(deal.client).push(deal);
  });

  return [...managers.entries()]
    .map(([manager, clients]) => {
      const clientGroups = [...clients.entries()]
        .map(([client, applications]) => {
          const sortedApplications = applications.sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0));
          const plannedApplications = sortedApplications.filter((deal) => deal.stage === "lead");
          const currentApplications = sortedApplications.filter((deal) => deal.statusGroup === "current" && deal.stage !== "lead");
          const successfulApplications = sortedApplications.filter((deal) => deal.stage === "issued");
          const refusedApplications = sortedApplications.filter((deal) => deal.stage === "rejected" || deal.stage === "withdrawn");
          const activeApplications = [...currentApplications, ...plannedApplications];
          const completedApplications = [...successfulApplications, ...refusedApplications];
          return {
            client,
            count: sortedApplications.length,
            activeCount: activeApplications.length,
            completedCount: completedApplications.length,
            currentCount: currentApplications.length,
            plannedCount: plannedApplications.length,
            successfulCount: successfulApplications.length,
            refusedCount: refusedApplications.length,
            amountRequested: sortedApplications.reduce((total, deal) => total + Number(deal.amountRequested || 0), 0),
            amountApproved: sortedApplications.reduce((total, deal) => total + Number(deal.amountApproved || 0), 0),
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

      return {
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
        lastActionAt: clientGroups[0]?.lastActionAt || "",
        currentClients,
        completedClients,
        clients: clientGroups
      };
    })
    .sort((a, b) => b.count - a.count || a.manager.localeCompare(b.manager, "ru"));
}

function groupCurrentDealsByManager(deals) {
  return groupDealsByManagerAndClient(deals, state.clients).map((manager) => ({
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
            <th>Менеджер</th>
            <th>Банк</th>
            <th>Этап</th>
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
                  <td>${escapeHtml(deal.bank)}</td>
                  <td>
                    <select data-stage-select="${escapeHtml(deal.id)}">
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

function renderClientApplicationCards(applications, emptyText) {
  const stageOptions = state.dashboard.stages.all;
  if (!applications.length) {
    return `<div class="empty compact-empty">${emptyText}</div>`;
  }

  return `
    <div class="client-application-list">
      ${applications
        .map(
          (deal) => `
            <article class="client-application-card">
              <div class="application-field">
                <span>Банк</span>
                <strong>${escapeHtml(deal.bank)}</strong>
              </div>
              <label class="application-field">
                <span>Статус</span>
                <select data-stage-select="${escapeHtml(deal.id)}">
                  ${stageOptions
                    .map((stage) => `<option value="${stage.id}" ${stage.id === deal.stage ? "selected" : ""}>${stage.label}</option>`)
                    .join("")}
                </select>
              </label>
              <div class="application-field">
                <span>Последнее действие</span>
                <strong>${formatDate(deal.lastActionAt)}</strong>
              </div>
              <div class="application-field">
                <span>Следующее действие</span>
                <strong>${formatDate(deal.nextActionAt)}</strong>
              </div>
              <div class="application-field">
                <span>Заявка</span>
                <strong>${money(deal.amountRequested)}</strong>
              </div>
              <div class="application-field application-comment">
                <span>Комментарий</span>
                <strong>${escapeHtml(deal.comment || deal.timeline || "—")}</strong>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderClientApplicationSections(client) {
  const sections = [
    ["Текущие", client.currentApplications || [], client.currentCount || 0, "Текущих заявок нет."],
    ["Плановые", client.plannedApplications || [], client.plannedCount || 0, "Плановых заявок нет."],
    ["Завершенные успешно", client.successfulApplications || [], client.successfulCount || 0, "Успешно завершенных заявок нет."],
    ["Отказы", client.refusedApplications || [], client.refusedCount || 0, "Отказов нет."]
  ];

  return `
    <div class="application-split">
      ${sections
        .map(
          ([title, applications, count, emptyText]) => `
            <section class="application-group">
              <div class="application-group-head">
                <h4>${title}</h4>
                <span>${count}</span>
              </div>
              ${renderClientApplicationCards(applications, emptyText)}
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

function renderApplicationSnapshot(applications) {
  if (!applications.length) {
    return `<div class="application-snapshot muted">Заявок пока нет</div>`;
  }

  return `
    <div class="application-snapshot">
      ${applications
        .map(
          (deal) => `
            <div class="application-line">
              <span>${escapeHtml(deal.bank)}</span>
              <strong>${escapeHtml(deal.stageLabel)}</strong>
              <time>${formatDate(deal.lastActionAt)}</time>
            </div>
          `
        )
        .join("")}
    </div>
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
                  <p class="eyebrow">Менеджер</p>
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
                          <div class="client-summary-main">
                            <strong>${escapeHtml(client.client)}</strong>
                            <span>${client.activeCount} активных · ${client.completedCount} завершенных · ${money(client.amountRequested)}</span>
                          </div>
                          ${renderApplicationSnapshot(client.activeApplications)}
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

function renderClientCards(clients, emptyText) {
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
                <div class="client-summary-main">
                  <strong>${escapeHtml(client.client)}</strong>
                  <span>${client.currentCount || 0} текущих · ${client.plannedCount || 0} плановых · ${client.completedCount} завершенных · ${money(client.amountRequested)}</span>
                </div>
                ${renderApplicationSnapshot(client.applications)}
              </summary>
              <div class="client-drilldown">
                ${renderClientApplicationSections(client)}
              </div>
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderManagerClientView() {
  const managers = groupDealsByManagerAndClient(state.dashboard.deals, state.clients);

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Менеджеры и клиенты</p>
          <h2>Карточки менеджеров</h2>
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
                          <p class="eyebrow">Менеджер</p>
                          <h3>${escapeHtml(manager.manager)}</h3>
                        </div>
                        <div class="manager-metrics">
                          <span>${manager.clientCount} клиентов</span>
                          <strong>${manager.currentCount} текущих · ${manager.plannedCount} плановых</strong>
                          <span>${manager.successfulCount} успешных · ${manager.refusedCount} отказов</span>
                          <span>${money(manager.amountRequested)}</span>
                        </div>
                      </summary>
                      ${renderClientCards(manager.clients, "Клиентов пока нет.")}
                    </details>
                  `
                )
                .join("")}
            </div>`
          : `<div class="empty">Клиенты и заявки пока не добавлены.</div>`
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
        return [bank.bank, program.program, program.notes, requirementText].join(" ").toLowerCase().includes(query);
      })
    }))
    .filter((bank) => {
      if (!query) {
        return true;
      }
      return bank.programs.length > 0;
    });
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

function renderKnowledgeList(banks) {
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
                ${(bank.programs || [])
                  .map(
                    (program) => `
                      <article class="knowledge-card">
                        <div class="knowledge-card-head">
                          <div>
                            <p class="eyebrow">Программа</p>
                            <h4>${escapeHtml(program.program)}</h4>
                          </div>
                          <time>${formatDate(program.updatedAt || bank.updatedAt)}</time>
                        </div>
                        ${renderRequirementGrid(program.requirements)}
                        <p class="knowledge-note">${escapeHtml(program.notes || "Без заметок")}</p>
                      </article>
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

function renderKnowledgeView() {
  const items = filteredKnowledge();
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">База знаний</p>
          <h2>Банки, программы и требования</h2>
        </div>
        ${renderKnowledgeFilters()}
      </div>
      ${renderKnowledgeList(items)}
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
            <p class="eyebrow">Менеджеры</p>
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
                  <span>${escapeHtml(deal.manager)} · ${escapeHtml(deal.bank)} · ${escapeHtml(deal.stageLabel)}</span>
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
                  <span class="muted">Выдано ${bank.issuedCount} из ${bank.count}; среднее ${money(bank.averageApproved)}</span>
                </div>
              `
            )
            .join("") || `<div class="list-item muted">Нет завершенных сделок.</div>`}
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
                <span>${escapeHtml(groupBy === "bank" ? deal.manager : deal.bank)} · ${escapeHtml(deal.stageLabel)}</span>
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
                  <p class="eyebrow">${state.board.groupBy === "bank" ? "Банк" : "Менеджер"}</p>
                  <h3>${escapeHtml(group.name)}</h3>
                </div>
                <div class="manager-metrics">
                  <span>${group.count} сделок</span>
                  <strong>${money(group.amountRequested)}</strong>
                  ${state.board.status === "completed" ? `<span>Одобрено ${money(group.amountApproved)}</span>` : ""}
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
  const totalCount = groups.reduce((total, group) => total + group.count, 0);
  const totalAmount = groups.reduce((total, group) => total + Number(group.amountRequested || 0), 0);

  return `
    ${renderKpis()}
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Правление</p>
          <h2>${BOARD_STATUS_LABELS[state.board.status]} сделки · ${BOARD_GROUP_LABELS[state.board.groupBy].toLowerCase()}</h2>
          <p class="muted">${totalCount} сделок · ${money(totalAmount)} общая сумма заявок</p>
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

  modeTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.mode === state.mode));
  renderViewTabs();
  updateActionVisibility();

  const views = {
    funnels: renderManagerClientView,
    current: renderCurrent,
    completed: renderCompleted,
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

  document.querySelectorAll("[data-stage-select]").forEach((select) => {
    select.addEventListener("change", async (event) => {
      await requestJson(`/api/deals/${encodeURIComponent(event.target.dataset.stageSelect)}`, {
        method: "PATCH",
        body: JSON.stringify({ stage: event.target.value })
      });
      await loadData();
    });
  });
}

function fillDealFormOptions() {
  const bankSelect = form.elements.bank;
  const stageSelect = form.elements.stage;
  const managerOptions = document.querySelector("#managerOptions");
  const clientOptions = document.querySelector("#clientOptions");
  const bankOptions = document.querySelector("#bankOptions");

  const managerNames = [...new Set([...state.dashboard.deals.map((deal) => deal.manager), ...state.clients.map((client) => client.manager)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));
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
  managerOptions.innerHTML = managerNames.map((manager) => `<option value="${escapeHtml(manager)}"></option>`).join("");
  clientOptions.innerHTML = clientNames.map((client) => `<option value="${escapeHtml(client)}"></option>`).join("");
  bankOptions.innerHTML = bankNames.map((bank) => `<option value="${escapeHtml(bank)}"></option>`).join("");
  bankSelect.innerHTML = bankNames.map((bank) => `<option value="${escapeHtml(bank)}">${escapeHtml(bank)}</option>`).join("");
  stageSelect.innerHTML = state.dashboard.stages.current
    .map((stage) => `<option value="${stage.id}">${stage.label}</option>`)
    .join("");
}

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.mode = tab.dataset.mode;
    state.view = VIEWS_BY_MODE[state.mode][0].id;
    resetFilters();
    render();
  });
});

refreshButton.addEventListener("click", loadData);

newDealButton.addEventListener("click", () => {
  fillDealFormOptions();
  form.reset();
  dialog.showModal();
});

newClientButton.addEventListener("click", () => {
  fillDealFormOptions();
  clientForm.reset();
  clientDialog.showModal();
});

newKnowledgeButton.addEventListener("click", () => {
  fillDealFormOptions();
  knowledgeForm.reset();
  knowledgeDialog.showModal();
});

form.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(form);
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

knowledgeForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(knowledgeForm);
  await requestJson("/api/knowledge", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(formData.entries()))
  });
  knowledgeDialog.close();
  state.view = "knowledge";
  await loadData();
});

loadData().catch((error) => {
  app.innerHTML = `<div class="empty">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
});
