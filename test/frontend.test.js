"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

test("application save refreshes dashboard while preserving the current client card", () => {
  assert.match(appSource, /async function refreshDashboard/);
  assert.match(appSource, /function preserveClientOpenState/);
  assert.match(appSource, /function closeApplicationCard/);
  assert.match(appSource, /function setClientRefreshState/);
  assert.match(appSource, /const \{ deal \} = await requestJson\(`\/api\/deals\/\$\{encodeURIComponent\(dealId\)\}`/);
  assert.match(appSource, /setClientRefreshState\(card, saveButton, true\)/);
  assert.match(appSource, /closeApplicationCard\(card\)/);
  assert.match(appSource, /await refreshDashboard\(\{ restoreUi: preserveClientOpenState\(uiSnapshot, deal\) \}\)/);
});

test("application save exposes a client-level loading indicator", () => {
  assert.match(appSource, /client-refresh-indicator/);
  assert.match(appSource, /Обновляем заявки/);
});

test("summary amount badges include counts next to requested amounts", () => {
  assert.match(appSource, /План подач <strong>\$\{plannedCount\} · \$\{money\(source\.plannedAmountRequested\)\}/);
  assert.match(appSource, /Одобрено <strong>\$\{approvedCount\} · \$\{money\(source\.approvedAmount\)\}/);
  assert.match(appSource, /planCount,/);
  assert.match(appSource, /successfulCount,/);
});

test("completed clients stay visible until explicitly archived", () => {
  assert.doesNotMatch(appSource, /activeCount === 0 && client\.completedCount > 0/);
  assert.match(appSource, /const archivedClients = clientGroups\.filter\(\(client\) => client\.isArchived\)/);
});
