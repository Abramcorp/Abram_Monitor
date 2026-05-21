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

test("new application save refreshes the same client before closing the dialog", () => {
  assert.match(appSource, /const \{ deal \} = await requestJson\("\/api\/deals"/);
  assert.match(appSource, /await refreshDashboard\(\{ restoreUi: preserveClientOpenState\(uiSnapshot, deal\) \}\)/);
  assert.match(appSource, /dialog\.close\(\)/);
});

test("application save exposes a client-level loading indicator", () => {
  assert.match(appSource, /client-refresh-indicator/);
  assert.match(appSource, /dialog-refresh-indicator/);
  assert.match(appSource, /Обновляем заявки/);
  assert.match(appSource, /function setDealDialogLoading/);
  assert.match(appSource, /setDealDialogLoading\(true\)/);
});

test("summary amount badges include counts next to requested amounts", () => {
  assert.match(appSource, /План подач <strong>\$\{plannedCount\} · \$\{money\(source\.plannedAmountRequested\)\}/);
  assert.match(appSource, /Завершено <strong>\$\{source\.completedCount \|\| 0\} · \$\{money\(source\.completedAmountRequested \|\| source\.amountRequested\)\}/);
  assert.match(appSource, /Отказ \/ непринятые <strong>\$\{source\.refusedCount \|\| 0\} · \$\{money\(source\.refusedAmountRequested\)\}/);
  assert.match(appSource, /planCount,/);
  assert.match(appSource, /successfulCount,/);
});

test("summary report uses selected status amounts instead of all-status totals", () => {
  assert.match(appSource, /const totalRequested = groups\.reduce\(\(total, group\) => total \+ Number\(group\.amountRequested \|\| 0\), 0\)/);
  assert.match(appSource, /renderSummaryAmountBadges\(totals, state\.board\.status\)/);
  assert.doesNotMatch(appSource, /в выбранном отчете · всего/);
});

test("summary report includes monthly activity chart", () => {
  assert.match(appSource, /function buildMonthlyActivity/);
  assert.match(appSource, /function monthlyActivityShareItems/);
  assert.match(appSource, /renderDonutChart\(monthlyActivityShareItems\(monthlyActivity\)\)/);
  assert.match(appSource, /Активность по месяцам/);
});

test("summary report includes donut share charts", () => {
  assert.match(appSource, /function renderDonutChart/);
  assert.match(appSource, /summaryStatusShareItems/);
  assert.match(appSource, /summaryGroupShareItems/);
  assert.match(appSource, /Доля одобрений/);
  assert.match(appSource, /conic-gradient/);
});

test("summary report includes configurable approval and client charts", () => {
  assert.match(appSource, /summaryCharts/);
  assert.match(appSource, /SUMMARY_CHART_GROUP_LABELS/);
  assert.match(appSource, /SUMMARY_CHART_PERIOD_LABELS/);
  assert.match(appSource, /function buildApprovedAmountChartRows/);
  assert.match(appSource, /function buildClientCountChartRows/);
  assert.match(appSource, /function buildApprovalCountChartRows/);
  assert.match(appSource, /summaryChartGroup/);
  assert.match(appSource, /summaryChartPeriod/);
  assert.match(appSource, /Сумма одобренных/);
  assert.match(appSource, /Количество клиентов/);
  assert.match(appSource, /Количество одобрений/);
});

test("knowledge programs expose links, bank phones, and change history", () => {
  assert.match(appSource, /application-program-link/);
  assert.match(appSource, /knowledge-program-link/);
  assert.match(appSource, /knowledge-bank-phone/);
  assert.match(appSource, /knowledge-card-phone/);
  assert.match(appSource, /program\.bankPhone \|\| bank\.phone/);
  assert.match(appSource, /programMetaSuffix/);
  assert.match(appSource, /function programApplicationLabel/);
  assert.match(appSource, /applicationProgramPreview/);
  assert.match(appSource, /application-program-review-stat/);
  assert.match(appSource, /заявленный:/);
  assert.match(appSource, /program\.termRange/);
  assert.match(appSource, /programTermRange/);
  assert.match(appSource, /function programReviewStats/);
  assert.match(appSource, /reviewTermDeclared/);
  assert.match(appSource, /Статистика:/);
  assert.match(appSource, /<p class="eyebrow">Банк<\/p>/);
  assert.match(appSource, /<h3>\$\{escapeHtml\(bank\.bank\)\}<\/h3>/);
  assert.match(appSource, /История изменений/);
  assert.match(appSource, /program\.changeHistory/);
});

test("knowledge program documentation field is labelled as requests and documents", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

  assert.match(appSource, /documentation: "Запросы и документы"/);
  assert.match(indexSource, /Запросы и документы/);
});

test("knowledge programs expose category grouping and filters", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

  assert.match(appSource, /PROGRAM_CATEGORIES/);
  assert.match(appSource, /categoryFilter/);
  assert.match(appSource, /renderKnowledgeCategories/);
  assert.match(appSource, /knowledge-card-badges/);
  assert.match(indexSource, /<select name="category">/);
});

test("completed clients stay visible until explicitly archived", () => {
  assert.doesNotMatch(appSource, /activeCount === 0 && client\.completedCount > 0/);
  assert.match(appSource, /const archivedClients = clientGroups\.filter\(\(client\) => client\.isArchived\)/);
});
