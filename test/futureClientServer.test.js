"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canManageFutureClient } = require("../server");
const { buildFutureClientReminderText } = require("../src/telegram");

test("admin and internal managers manage every future client while partner roles have no access", () => {
  const futureClient = { manager: "Артем" };
  const managers = [{ id: "manager-artem", name: "Артем", userId: "user-artem" }];

  assert.equal(canManageFutureClient({ role: "admin" }, futureClient, managers), true);
  assert.equal(canManageFutureClient({ id: "user-artem", role: "analyst_abram" }, futureClient, managers), true);
  assert.equal(canManageFutureClient({ id: "user-graf", role: "analyst_abram", fullName: "Граф" }, futureClient, managers), true);
  assert.equal(canManageFutureClient({ id: "user-graf", role: "analyst_abram" }, { manager: "" }, managers), true);
  assert.equal(canManageFutureClient({ id: "user-artem", role: "partner" }, futureClient, managers), false);
  assert.equal(canManageFutureClient({ id: "user-artem", role: "documents_officer" }, futureClient, managers), false);
});

test("future client Telegram digest groups clients and escapes user input", () => {
  const text = buildFutureClientReminderText({
    analystName: "Артем & Ко",
    clients: [
      { name: "ООО <Тест>", periodLabel: "11–20 ноября 2026", status: "current" },
      { name: "ИП Петров", periodLabel: "21–30 ноября 2026", status: "soon" }
    ]
  });

  assert.match(text, /Будущие клиенты/);
  assert.match(text, /Клиентов: <b>2<\/b>/);
  assert.match(text, /Артем &amp; Ко/);
  assert.match(text, /ООО &lt;Тест&gt;/);
  assert.match(text, /11–20 ноября 2026/);
});
