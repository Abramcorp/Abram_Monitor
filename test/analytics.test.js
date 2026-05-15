"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildManagerClientGroups, calculateDashboard, normalizeDeal, toNumber } = require("../src/analytics");

test("stage catalog matches source spreadsheet status list", () => {
  const dashboard = calculateDashboard([]);
  assert.deepEqual(
    dashboard.stages.all.map((stage) => stage.label),
    [
      "Плановая",
      "Закинули лид",
      "Подписали заявку ждем решение",
      "Одобрено",
      "Отклонено",
      "Нет возможности завести заявку (УКАЗАТЬ ПРИЧИНУ)"
    ]
  );
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
    programAmountRange: "от 5 до 15 млн"
  });

  assert.equal(deal.bank, "Точка Банк");
  assert.equal(deal.knowledgeProgramId, "kb-tochka-fast");
  assert.equal(deal.program, "Оборотный");
  assert.equal(deal.programType, "Экспресс");
  assert.equal(deal.programAmountRange, "от 5 до 15 млн");
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
  assert.equal(dashboard.totals.amountRequestedCurrent, 3000);
  assert.equal(dashboard.totals.amountApprovedCompleted, 2500);
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

  const manager = dashboard.currentSummary.byManager.find((item) => item.manager === "Елена Иванова");
  assert.equal(manager.clientCount, 1);
  assert.equal(manager.count, 2);
  assert.equal(manager.clients[0].client, "ООО Клиент");
  assert.equal(manager.clients[0].currentApplications[0].status, "Подписали заявку ждем решение");
  assert.equal(manager.clients[0].currentApplications[0].lastActionAt, "2026-05-12T08:30:00.000Z");
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
  assert.equal(client.plannedCount, 1);
  assert.equal(client.successfulCount, 1);
  assert.equal(client.refusedCount, 1);
  assert.equal(client.activeApplications[0].id, "active");
  assert.equal(client.plannedApplications[0].id, "planned");
  assert.equal(client.successfulApplications[0].id, "completed");
  assert.equal(client.refusedApplications[0].id, "refused");
  assert.equal(manager.currentClients[0].client, "ООО Смешанный клиент");
  assert.equal(manager.completedClients[0].client, "ООО Смешанный клиент");
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
  const completedManager = dashboard.boardSummaries.completed.manager.find((group) => group.name === "Елена Иванова");

  assert.equal(currentBank.count, 2);
  assert.equal(currentBank.amountRequested, 4000);
  assert.equal(currentBank.currentAmountRequested, 4000);
  assert.equal(currentBank.plannedAmountRequested, 0);
  assert.equal(currentBank.approvedAmount, 0);
  assert.equal(currentBank.totalAmountRequested, 4000);
  assert.equal(currentBank.applications[0].applicationDate, "2026-05-12T07:00:00.000Z");
  assert.equal(completedManager.count, 1);
  assert.equal(completedManager.amountRequested, 2000);
  assert.equal(completedManager.amountApproved, 1800);
  assert.equal(completedManager.currentAmountRequested, 1000);
  assert.equal(completedManager.approvedAmount, 1800);
  assert.equal(completedManager.totalAmountRequested, 3000);
  assert.equal(completedManager.approvalConversionRate, 60);
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
