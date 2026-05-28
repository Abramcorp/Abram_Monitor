"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCurrentManagerGroups, buildManagerClientGroups, calculateDashboard, normalizeDeal, toNumber } = require("../src/analytics");

test("stage catalog matches source spreadsheet status list", () => {
  const dashboard = calculateDashboard([]);
  assert.deepEqual(
    dashboard.stages.all.map((stage) => stage.label),
    [
      "Плановая",
      "Закинули лид",
      "Подписали заявку ждем решение",
      "Запрос документов",
      "Одобрено",
      "Отклонено",
      "Нет возможности завести заявку (УКАЗАТЬ ПРИЧИНУ)"
    ]
  );
});

test("stage catalog keeps the requested-documents stage out of the funnel columns", () => {
  const dashboard = calculateDashboard([]);
  assert.deepEqual(
    dashboard.stages.current.map((stage) => stage.id),
    ["planned", "lead", "submitted"]
  );
});

test("requested-documents stage is counted as lead in the funnel and group buckets", () => {
  const dashboard = calculateDashboard([
    { id: "lead-1", client: "A", manager: "M", bank: "Bank", stage: "lead", amountRequested: 1000, inquiryAt: "2026-05-20T10:00:00+03:00" },
    { id: "docs-1", client: "B", manager: "M", bank: "Bank", stage: "documents_requested", amountRequested: 500, inquiryAt: "2026-05-21T10:00:00+03:00" }
  ], new Date("2026-05-22T10:00:00+03:00"));

  const leadFunnel = dashboard.currentFunnel.find((stage) => stage.id === "lead");
  assert.equal(leadFunnel.count, 2, "lead funnel includes documents_requested deal");
  assert.equal(leadFunnel.amountRequested, 1500);
  assert.equal(dashboard.totals.leads, 2);
  assert.equal(dashboard.totals.amountRequestedLeads, 1500);
});

test("toNumber handles formatted ruble values", () => {
  assert.equal(toNumber("7 500 000,50 ₽"), 7500000.5);
  assert.equal(toNumber(""), 0);
});

test("normalizeDeal defaults applications to planned status", () => {
  const deal = normalizeDeal({ client: "ООО Новый клиент" });
  assert.equal(deal.stage, "planned");
  assert.equal(deal.stageLabel, "Плановая");
});

test("normalizeDeal keeps selected bank program metadata", () => {
  const deal = normalizeDeal({
    client: "ООО Программа",
    bank: "Точка Банк",
    knowledgeProgramId: "kb-tochka-fast",
    program: "Оборотный",
    programType: "Экспресс",
    programAmountRange: "от 5 до 15 млн",
    programTermRange: "до 36 мес."
  });

  assert.equal(deal.bank, "Точка Банк");
  assert.equal(deal.knowledgeProgramId, "kb-tochka-fast");
  assert.equal(deal.program, "Оборотный");
  assert.equal(deal.programType, "Экспресс");
  assert.equal(deal.programAmountRange, "от 5 до 15 млн");
  assert.equal(deal.programTermRange, "до 36 мес.");
});

test("normalizeDeal keeps action history chronological and updates last action", () => {
  const deal = normalizeDeal({
    client: "ООО Хронология",
    updatedAt: "2026-05-10T10:00:00+03:00",
    actions: [
      { action: "Позвонили клиенту", actionAt: "2026-05-12T11:30:00+03:00" },
      { action: "Получили документы", actionAt: "2026-05-11T09:00:00+03:00" }
    ]
  });

  assert.deepEqual(
    deal.actions.map((action) => action.action),
    ["Получили документы", "Позвонили клиенту"]
  );
  assert.equal(deal.lastActionAt, "2026-05-12T08:30:00.000Z");
});

test("normalizeDeal derives completed group from stage", () => {
  const deal = normalizeDeal({
    client: "ООО Тест",
    manager: "Елена Иванова",
    bank: "Банк",
    stage: "issued",
    amountApproved: "1 000 000",
    updatedAt: "2026-05-10T10:00:00+03:00",
    analystCallAt: "2026-05-09T10:00:00+03:00"
  });

  assert.equal(deal.statusGroup, "completed");
  assert.equal(deal.manager, "Елена Иванова");
  assert.equal(deal.stage, "approved");
  assert.equal(deal.stageLabel, "Одобрено");
  assert.equal(deal.amountApproved, 1000000);
  assert.equal(deal.lastActionAt, "2026-05-10T07:00:00.000Z");
});

test("normalizeDeal keeps KI request and underwriter call as date-only inputs", () => {
  const deal = normalizeDeal({
    client: "ООО Даты",
    kiRequestedAt: "2026-05-14",
    analystCallAt: "2026-05-15"
  });

  assert.equal(deal.kiRequestedAt, "2026-05-14T00:00:00.000Z");
  assert.equal(deal.analystCallAt, "2026-05-15T00:00:00.000Z");
});

test("dashboard calculates funnel and completed conversion", () => {
  const dashboard = calculateDashboard(
    [
      { id: "1", client: "A", bank: "Банк 1", stage: "documents", amountRequested: 1000 },
      { id: "2", client: "B", bank: "Банк 1", stage: "review", amountRequested: 2000 },
      { id: "3", client: "C", bank: "Банк 2", stage: "issued", amountRequested: 3000, amountApproved: 2500 },
      { id: "4", client: "D", bank: "Банк 2", stage: "rejected", amountRequested: 4000 }
    ],
    new Date("2026-05-13T10:00:00+03:00")
  );

  assert.equal(dashboard.totals.current, 2);
  assert.equal(dashboard.totals.completed, 2);
  assert.equal(dashboard.totals.completedConversionRate, 50);
  assert.equal(dashboard.totals.leads, 1);
  assert.equal(dashboard.totals.working, 1);
  assert.equal(dashboard.totals.amountRequestedCurrent, 3000);
  assert.equal(dashboard.totals.amountRequestedLeads, 1000);
  assert.equal(dashboard.totals.amountRequestedWorking, 2000);
  assert.equal(dashboard.totals.amountApprovedCompleted, 2500);
  assert.equal(dashboard.totals.leadToWorkingConversionRate, 50);
  assert.equal(dashboard.totals.signedToCompletedConversionRate, 67);
  assert.equal(dashboard.totals.completedToSuccessConversionRate, 50);
  assert.equal(dashboard.currentFunnel.find((stage) => stage.id === "lead").count, 1);
});

test("dashboard groups current clients by manager with application status and last action", () => {
  const dashboard = calculateDashboard(
    [
      {
        id: "1",
        client: "ООО Клиент",
        manager: "Елена Иванова",
        bank: "Банк 1",
        stage: "documents",
        amountRequested: 1000,
        updatedAt: "2026-05-10T10:00:00+03:00"
      },
      {
        id: "2",
        client: "ООО Клиент",
        manager: "Елена Иванова",
        bank: "Банк 2",
        stage: "review",
        amountRequested: 2000,
        analystCallAt: "2026-05-12T11:30:00+03:00"
      },
      {
        id: "3",
        client: "ИП Другой",
        manager: "Михаил Петров",
        bank: "Банк 3",
        stage: "approved",
        amountRequested: 3000,
        updatedAt: "2026-05-11T10:00:00+03:00"
      }
    ],
    new Date("2026-05-13T10:00:00+03:00")
  );

  const currentDeals = dashboard.deals.filter((deal) => deal.statusGroup === "current");
  const managers = buildCurrentManagerGroups(currentDeals);
  const manager = managers.find((item) => item.manager === "Елена Иванова");
  assert.equal(manager.clientCount, 1);
  assert.equal(manager.count, 2);
  assert.equal(manager.clients[0].client, "ООО Клиент");
  const submittedApplication = manager.clients[0].currentApplications.find((application) => application.id === "2");
  assert.equal(submittedApplication.status, "Подписали заявку ждем решение");
  assert.equal(submittedApplication.lastActionAt, "2026-05-12T08:30:00.000Z");
});

test("manager client groups split client applications by workflow bucket", () => {
  const deals = [
    normalizeDeal({
      id: "planned",
      client: "ООО Смешанный клиент",
      manager: "Елена Иванова",
      bank: "Банк 0",
      stage: "planned",
      amountRequested: 500,
      inquiryAt: "2026-05-13T09:00:00+03:00",
      updatedAt: "2026-05-13T11:00:00+03:00"
    }),
    normalizeDeal({
      id: "active",
      client: "ООО Смешанный клиент",
      manager: "Елена Иванова",
      bank: "Банк 1",
      stage: "review",
      amountRequested: 1000,
      signedAt: "2026-05-12T10:00:00+03:00",
      updatedAt: "2026-05-12T11:00:00+03:00"
    }),
    normalizeDeal({
      id: "completed",
      client: "ООО Смешанный клиент",
      manager: "Елена Иванова",
      bank: "Банк 2",
      stage: "issued",
      amountRequested: 2000,
      amountApproved: 1800,
      signedAt: "2026-05-10T10:00:00+03:00",
      completedAt: "2026-05-10T15:00:00+03:00",
      updatedAt: "2026-05-10T15:00:00+03:00"
    }),
    normalizeDeal({
      id: "refused",
      client: "ООО Смешанный клиент",
      manager: "Елена Иванова",
      bank: "Банк 3",
      stage: "rejected",
      amountRequested: 3000,
      completedAt: "2026-05-09T15:00:00+03:00",
      updatedAt: "2026-05-09T15:00:00+03:00"
    })
  ];

  const [manager] = buildManagerClientGroups(deals);
  const [client] = manager.clients;

  assert.equal(manager.currentClientCount, 1);
  assert.equal(manager.completedClientCount, 1);
  assert.equal(manager.plannedAmountRequested, 500);
  assert.equal(manager.currentAmountRequested, 1000);
  assert.equal(manager.approvedAmount, 1800);
  assert.equal(client.activeCount, 2);
  assert.equal(client.completedCount, 2);
  assert.equal(client.startedAt, "2026-05-10T07:00:00.000Z");
  assert.equal(client.lastActionAt, "2026-05-13T08:00:00.000Z");
  assert.equal(client.plannedAmountRequested, 500);
  assert.equal(client.currentAmountRequested, 1000);
  assert.equal(client.approvedAmount, 1800);
  assert.equal(client.currentCount, 1);
  assert.equal(client.leadCount, 0);
  assert.equal(client.workingCount, 1);
  assert.equal(client.workingAmountRequested, 1000);
  assert.equal(client.plannedCount, 1);
  assert.equal(client.successfulCount, 1);
  assert.equal(client.refusedCount, 1);
  assert.equal(client.workingApplications[0].id, "active");
  assert.equal(client.activeApplications[0].id, "active");
  assert.equal(client.plannedApplications[0].id, "planned");
  assert.equal(client.successfulApplications[0].id, "completed");
  assert.equal(client.refusedApplications[0].id, "refused");
  assert.equal(manager.currentClients[0].client, "ООО Смешанный клиент");
  assert.equal(manager.completedClients[0].client, "ООО Смешанный клиент");
});

test("manager client groups sort applications by bucket entry from old to new", () => {
  const deals = [
    normalizeDeal({
      id: "planned-new",
      client: "ООО Очередность",
      manager: "Елена Иванова",
      bank: "Банк",
      stage: "planned",
      createdAt: "2026-05-05T10:00:00+03:00",
      updatedAt: "2026-05-06T10:00:00+03:00"
    }),
    normalizeDeal({
      id: "planned-old",
      client: "ООО Очередность",
      manager: "Елена Иванова",
      bank: "Банк",
      stage: "planned",
      createdAt: "2026-05-01T10:00:00+03:00",
      updatedAt: "2026-05-20T10:00:00+03:00"
    }),
    normalizeDeal({
      id: "current-new",
      client: "ООО Очередность",
      manager: "Елена Иванова",
      bank: "Банк",
      stage: "lead",
      inquiryAt: "2026-05-05T10:00:00+03:00",
      updatedAt: "2026-05-06T10:00:00+03:00"
    }),
    normalizeDeal({
      id: "current-old",
      client: "ООО Очередность",
      manager: "Елена Иванова",
      bank: "Банк",
      stage: "submitted",
      signedAt: "2026-05-09T10:00:00+03:00",
      updatedAt: "2026-05-12T10:00:00+03:00",
      actions: [
        { action: "Смена статуса: Плановая → Закинули лид", actionAt: "2026-05-02T10:00:00+03:00" },
        { action: "Смена статуса: Закинули лид → Подписали заявку ждем решение", actionAt: "2026-05-09T10:00:00+03:00" }
      ]
    }),
    normalizeDeal({
      id: "approved-new",
      client: "ООО Очередность",
      manager: "Елена Иванова",
      bank: "Банк",
      stage: "approved",
      completedAt: "2026-05-10T10:00:00+03:00",
      updatedAt: "2026-05-10T10:00:00+03:00"
    }),
    normalizeDeal({
      id: "approved-old",
      client: "ООО Очередность",
      manager: "Елена Иванова",
      bank: "Банк",
      stage: "approved",
      completedAt: "2026-05-03T10:00:00+03:00",
      updatedAt: "2026-05-15T10:00:00+03:00"
    }),
    normalizeDeal({
      id: "refused-new",
      client: "ООО Очередность",
      manager: "Елена Иванова",
      bank: "Банк",
      stage: "blocked",
      completedAt: "2026-05-11T10:00:00+03:00",
      updatedAt: "2026-05-11T10:00:00+03:00"
    }),
    normalizeDeal({
      id: "refused-old",
      client: "ООО Очередность",
      manager: "Елена Иванова",
      bank: "Банк",
      stage: "rejected",
      completedAt: "2026-05-04T10:00:00+03:00",
      updatedAt: "2026-05-12T10:00:00+03:00"
    })
  ];

  const [manager] = buildManagerClientGroups(deals);
  const [client] = manager.clients;

  assert.deepEqual(client.plannedApplications.map((deal) => deal.id), ["planned-old", "planned-new"]);
  assert.deepEqual(client.currentApplications.map((deal) => deal.id), ["current-old", "current-new"]);
  assert.deepEqual(client.successfulApplications.map((deal) => deal.id), ["approved-old", "approved-new"]);
  assert.deepEqual(client.refusedApplications.map((deal) => deal.id), ["refused-old", "refused-new"]);
});

test("dashboard builds board summaries by manager and bank with requested amount", () => {
  const dashboard = calculateDashboard(
    [
      {
        id: "1",
        client: "ООО Альфа",
        manager: "Елена Иванова",
        bank: "Банк 1",
        stage: "submitted",
        amountRequested: 1000,
        submittedAt: "2026-05-12T10:00:00+03:00",
        updatedAt: "2026-05-13T10:00:00+03:00"
      },
      {
        id: "2",
        client: "ООО Бета",
        manager: "Елена Иванова",
        bank: "Банк 2",
        stage: "issued",
        amountRequested: 2000,
        amountApproved: 1800,
        completedAt: "2026-05-11T10:00:00+03:00",
        updatedAt: "2026-05-11T10:00:00+03:00"
      },
      {
        id: "3",
        client: "ООО Гамма",
        manager: "Михаил Петров",
        bank: "Банк 1",
        stage: "review",
        amountRequested: 3000,
        createdAt: "2026-05-10T10:00:00+03:00",
        updatedAt: "2026-05-12T10:00:00+03:00"
      }
    ],
    new Date("2026-05-13T10:00:00+03:00")
  );

  const currentBank = dashboard.boardSummaries.current.bank.find((group) => group.name === "Банк 1");
  const currentClient = dashboard.boardSummaries.current.client.find((group) => group.name === "ООО Альфа");
  const completedManager = dashboard.boardSummaries.completed.manager.find((group) => group.name === "Елена Иванова");

  assert.equal(currentBank.count, 2);
  assert.equal(currentBank.amountRequested, 4000);
  assert.equal(currentBank.currentAmountRequested, 4000);
  assert.equal(currentBank.leadCount, 0);
  assert.equal(currentBank.workingCount, 2);
  assert.equal(currentBank.workingAmountRequested, 4000);
  assert.equal(currentBank.plannedAmountRequested, 0);
  assert.equal(currentBank.approvedAmount, 0);
  assert.equal(currentBank.totalAmountRequested, 4000);
  assert.equal(currentBank.leadToWorkingConversionRate, 100);
  const firstApplicationId = currentBank.applicationIds[0];
  const firstApplication = dashboard.deals.find((deal) => deal.id === firstApplicationId);
  assert.equal(firstApplication.applicationDate, "2026-05-12T07:00:00.000Z");
  assert.equal(currentClient.count, 1);
  assert.equal(currentClient.workingCount, 1);
  assert.equal(currentClient.totalAmountRequested, 1000);
  assert.equal(completedManager.count, 1);
  assert.equal(completedManager.amountRequested, 2000);
  assert.equal(completedManager.amountApproved, 1800);
  assert.equal(completedManager.currentAmountRequested, 0);
  assert.equal(completedManager.workingCount, 0);
  assert.equal(completedManager.signedToCompletedConversionRate, 100);
  assert.equal(completedManager.approvedAmount, 1800);
  assert.equal(completedManager.completedAmountRequested, 2000);
  assert.equal(completedManager.totalAmountRequested, 2000);
  assert.equal(completedManager.approvalConversionRate, 90);
});

test("dashboard sorts next actions by nearest date", () => {
  const dashboard = calculateDashboard(
    [
      { id: "1", client: "Позже", bank: "Банк", stage: "lead", nextActionAt: "2026-05-15T10:00:00+03:00" },
      { id: "2", client: "Раньше", bank: "Банк", stage: "lead", nextActionAt: "2026-05-14T10:00:00+03:00" }
    ],
    new Date("2026-05-13T10:00:00+03:00")
  );

  assert.equal(dashboard.currentSummary.nextActions[0].client, "Раньше");
});

test("normalizeDeal exposes the application date derived from earliest dated event", () => {
  const deal = normalizeDeal({
    id: "appdate-1",
    client: "ИП Контракт",
    bank: "Банк",
    stage: "submitted",
    inquiryAt: "2026-04-10T09:00:00+03:00",
    submittedAt: "2026-04-15T12:00:00+03:00",
    signedAt: "2026-04-20T10:00:00+03:00",
    createdAt: "2026-04-01T08:00:00+03:00"
  });

  assert.equal(deal.applicationDate, "2026-04-20T07:00:00.000Z");

  const onlyCreated = normalizeDeal({
    id: "appdate-2",
    client: "ИП Без дат",
    bank: "Банк",
    createdAt: "2026-04-01T08:00:00+03:00"
  });
  assert.equal(onlyCreated.applicationDate, "2026-04-01T05:00:00.000Z");
});

test("calculateDashboard returns slim payload without dealing dupes", () => {
  const dashboard = calculateDashboard(
    [
      { id: "d1", client: "ООО Альфа", manager: "Анна", bank: "Сбер", stage: "lead", amountRequested: 1000 },
      { id: "d2", client: "ООО Бета", manager: "Борис", bank: "ВТБ", stage: "approved", amountRequested: 2000, amountApproved: 1800, completedAt: "2026-05-10T08:00:00Z" }
    ],
    new Date("2026-05-15T10:00:00Z")
  );

  assert.equal("managerClientGroups" in dashboard, false, "managerClientGroups removed");
  assert.deepEqual(Object.keys(dashboard.currentSummary), ["nextActions"], "currentSummary holds only nextActions");
  for (const status of ["current", "completed"]) {
    for (const grouping of ["client", "manager", "bank"]) {
      for (const group of dashboard.boardSummaries[status][grouping]) {
        assert.equal(Array.isArray(group.applicationIds), true, `${status}.${grouping} has applicationIds`);
        assert.equal("applications" in group, false, `${status}.${grouping} no applications field`);
        for (const id of group.applicationIds) {
          assert.equal(typeof id, "string");
        }
      }
    }
  }
});
