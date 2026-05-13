"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateDashboard, normalizeDeal, toNumber } = require("../src/analytics");

test("toNumber handles formatted ruble values", () => {
  assert.equal(toNumber("7 500 000,50 ₽"), 7500000.5);
  assert.equal(toNumber(""), 0);
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
  assert.equal(deal.stageLabel, "Выдано");
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
  assert.equal(dashboard.currentFunnel.find((stage) => stage.id === "documents").count, 1);
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
  assert.equal(manager.clients[0].currentApplications[0].status, "На рассмотрении");
  assert.equal(manager.clients[0].currentApplications[0].lastActionAt, "2026-05-12T08:30:00.000Z");
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
