"use strict";

const state = {
  banks: [],
  dashboard: null,
  filters: {
    query: "",
    manager: "all",
    bank: "all",
    stage: "all"
  },
  view: "managers"
};

const app = document.querySelector("#app");
const tabs = document.querySelectorAll(".tab");
const refreshButton = document.querySelector("#refreshButton");
const newDealButton = document.querySelector("#newDealButton");
const dialog = document.querySelector("#dealDialog");
const form = document.querySelector("#dealForm");

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
  const [dashboard, bankPayload] = await Promise.all([
    requestJson("/api/dashboard"),
    requestJson("/api/banks")
  ]);
  state.dashboard = dashboard;
  state.banks = bankPayload.banks;
  render();
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

function groupDealsByManagerAndClient(deals) {
  const managers = new Map();
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
          const activeApplications = sortedApplications.filter((deal) => deal.statusGroup === "current");
          const completedApplications = sortedApplications.filter((deal) => deal.statusGroup === "completed");
          return {
            client,
            count: sortedApplications.length,
            activeCount: activeApplications.length,
            completedCount: completedApplications.length,
            amountRequested: sortedApplications.reduce((total, deal) => total + Number(deal.amountRequested || 0), 0),
            amountApproved: sortedApplications.reduce((total, deal) => total + Number(deal.amountApproved || 0), 0),
            lastActionAt: sortedApplications[0]?.lastActionAt || "",
            activeApplications,
            completedApplications,
            applications: sortedApplications
          };
        })
        .sort((a, b) => new Date(b.lastActionAt || 0) - new Date(a.lastActionAt || 0) || b.count - a.count);

      const currentClients = clientGroups.filter((client) => client.activeCount > 0);
      const completedClients = clientGroups.filter((client) => client.completedCount > 0);

      return {
        manager,
        clientCount: clientGroups.length,
        count: clientGroups.reduce((total, client) => total + client.count, 0),
        activeCount: clientGroups.reduce((total, client) => total + client.activeCount, 0),
        completedCount: clientGroups.reduce((total, client) => total + client.completedCount, 0),
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
  return groupDealsByManagerAndClient(deals).map((manager) => ({
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
  return `
    <div class="application-split">
      <section class="application-group">
        <div class="application-group-head">
          <h4>Активные заявки</h4>
          <span>${client.activeCount}</span>
        </div>
        ${renderClientApplicationCards(client.activeApplications, "Активных заявок нет.")}
      </section>
      <section class="application-group">
        <div class="application-group-head">
          <h4>Завершенные заявки</h4>
          <span>${client.completedCount}</span>
        </div>
        ${renderClientApplicationCards(client.completedApplications, "Завершенных заявок нет.")}
      </section>
    </div>
  `;
}

function renderApplicationSnapshot(applications) {
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
            <section class="manager-section">
              <header class="manager-head">
                <div>
                  <p class="eyebrow">Менеджер</p>
                  <h3>${escapeHtml(manager.manager)}</h3>
                </div>
                <div class="manager-metrics">
                  <span>${manager.clientCount} клиентов</span>
                  <strong>${manager.count} заявок</strong>
                  <span>${money(manager.amountRequested)}</span>
                </div>
              </header>
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
            </section>
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
                  <span>${client.activeCount} активных · ${client.completedCount} завершенных · ${money(client.amountRequested)}</span>
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
  const managers = groupDealsByManagerAndClient(filteredDeals());

  return `
    ${renderKpis()}
    <section class="panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Менеджеры и клиенты</p>
          <h2>Клиентские заявки по менеджерам</h2>
        </div>
        ${renderFilters(state.dashboard.deals)}
      </div>
      ${
        managers.length
          ? `<div class="manager-stack">
              ${managers
                .map(
                  (manager) => `
                    <section class="manager-section">
                      <header class="manager-head">
                        <div>
                          <p class="eyebrow">Менеджер</p>
                          <h3>${escapeHtml(manager.manager)}</h3>
                        </div>
                        <div class="manager-metrics">
                          <span>${manager.clientCount} клиентов</span>
                          <strong>${manager.activeCount} активных / ${manager.completedCount} завершенных</strong>
                          <span>${money(manager.amountRequested)}</span>
                        </div>
                      </header>
                      <div class="manager-subsections">
                        <section class="manager-subsection">
                          <div class="subsection-head">
                            <h4>Текущие</h4>
                            <span>${manager.currentClients.length} клиентов · ${manager.activeCount} заявок</span>
                          </div>
                          ${renderClientCards(manager.currentClients, "Текущих клиентов нет.")}
                        </section>
                        <section class="manager-subsection">
                          <div class="subsection-head">
                            <h4>Завершенные</h4>
                            <span>${manager.completedClients.length} клиентов · ${manager.completedCount} заявок</span>
                          </div>
                          ${renderClientCards(manager.completedClients, "Завершенных клиентов нет.")}
                        </section>
                      </div>
                    </section>
                  `
                )
                .join("")}
            </div>`
          : `<div class="empty">Нет заявок под выбранные фильтры.</div>`
      }
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

function renderSummary() {
  const totals = state.dashboard.totals;
  return `
    ${renderKpis()}
    <section class="report-grid">
      <div class="panel">
        <p class="eyebrow">Текущий портфель</p>
        <h2>${money(totals.amountRequestedCurrent)}</h2>
        <p class="muted">Сумма заявок в активной работе.</p>
      </div>
      <div class="panel">
        <p class="eyebrow">Документы</p>
        <h2>${state.dashboard.currentSummary.needsDocuments}</h2>
        <p class="muted">Сделки, где следующий шаг зависит от пакета документов.</p>
      </div>
      <div class="panel">
        <p class="eyebrow">Рассмотрение банка</p>
        <h2>${state.dashboard.currentSummary.inBankReview}</h2>
        <p class="muted">Поданные, рассматриваемые и одобренные сделки.</p>
      </div>
    </section>

    <section class="content-grid">
      <div class="panel">
        <p class="eyebrow">Нагрузка</p>
        <h2>Текущие сделки по банкам</h2>
        ${renderBarRows(state.dashboard.currentSummary.byBank, "bank", "amountRequested")}
      </div>
      <aside class="panel">
        <p class="eyebrow">Риск SLA</p>
        <h2>Просроченные действия</h2>
        <ul class="list">
          ${state.dashboard.currentSummary.overdueDeals
            .map(
              (deal) => `
                <li class="list-item">
                  <strong>${escapeHtml(deal.client)}</strong>
                  <span>${escapeHtml(deal.bank)} · ${formatDate(deal.nextActionAt)}</span>
                  <span class="muted">${escapeHtml(deal.comment || deal.stageLabel)}</span>
                </li>
              `
            )
            .join("") || `<li class="list-item muted">Просроченных действий нет.</li>`}
        </ul>
      </aside>
    </section>
  `;
}

function render() {
  if (!state.dashboard) {
    app.innerHTML = `<div class="loading">Загрузка данных...</div>`;
    return;
  }

  tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === state.view));

  const views = {
    managers: renderManagerClientView,
    current: renderCurrent,
    completed: renderCompleted,
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

  const managerNames = [...new Set(state.dashboard.deals.map((deal) => deal.manager))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));
  const bankNames = [...new Set([...state.banks.map((bank) => bank.name), ...state.dashboard.deals.map((deal) => deal.bank)])].sort((a, b) =>
    a.localeCompare(b, "ru")
  );
  managerOptions.innerHTML = managerNames.map((manager) => `<option value="${escapeHtml(manager)}"></option>`).join("");
  bankSelect.innerHTML = bankNames.map((bank) => `<option value="${escapeHtml(bank)}">${escapeHtml(bank)}</option>`).join("");
  stageSelect.innerHTML = state.dashboard.stages.current
    .map((stage) => `<option value="${stage.id}">${stage.label}</option>`)
    .join("");
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.view = tab.dataset.view;
    state.filters = { query: "", manager: "all", bank: "all", stage: "all" };
    render();
  });
});

refreshButton.addEventListener("click", loadData);

newDealButton.addEventListener("click", () => {
  fillDealFormOptions();
  form.reset();
  dialog.showModal();
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

loadData().catch((error) => {
  app.innerHTML = `<div class="empty">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
});
