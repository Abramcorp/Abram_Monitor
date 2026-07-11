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
  assert.match(appSource, /\(\{ deal \} = await requestJson\("\/api\/deals"/);
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
  assert.match(appSource, /const totalReq = scopedDeals\.reduce\(\(acc, d\) => acc \+ \(Number\(d\.amountRequested\) \|\| 0\), 0\)/);
  assert.match(appSource, /const totalApp = scopedDeals\.reduce\(\(acc, d\) => acc \+ \(Number\(d\.amountApproved\) \|\| 0\), 0\)/);
  assert.doesNotMatch(appSource, /в выбранном отчете · всего/);
});

test("summary report includes donut share charts", () => {
  assert.match(appSource, /function renderDonutChart/);
  assert.match(appSource, /summaryStatusShareItems/);
  assert.match(appSource, /summaryGroupShareItems/);
  assert.match(appSource, /function summaryStatusTitle/);
  assert.match(appSource, /function summaryPortfolioTitle/);
  assert.match(appSource, /conic-gradient/);
});

test("summary report keeps only the requested chart set with a period selector", () => {
  assert.match(appSource, /summaryCharts/);
  assert.match(appSource, /SUMMARY_CHART_PERIOD_LABELS/);
  assert.match(appSource, /function renderAreaChart/);
  assert.match(appSource, /function buildStatusCountPeriodRows/);
  assert.match(appSource, /function buildStatusFocusPeriodRows/);
  assert.match(appSource, /function buildGroupedPeriodSeries/);
  assert.match(appSource, /function buildOutcomeShareItems/);
  assert.match(appSource, /function buildTopCountRows/);
  assert.match(appSource, /summaryChartPeriod/);
  assert.match(appSource, /Текущих заявок/);
  assert.match(appSource, /Завершенных заявок/);
  assert.match(appSource, /Заявок в работе/);
  assert.match(appSource, /Заявок одобрено/);
  assert.match(appSource, /renderAreaChart\(applicationCountRows[^)]*applicationSeries/);
  assert.match(appSource, /renderAreaChart\(focusCountRows[^)]*focusSeries/);
  assert.match(appSource, /Лиды в успешные и непринятые/);
  assert.match(appSource, /Лиды в заявки в работе/);
  assert.match(appSource, /Топ по количеству одобрений/);
  assert.match(appSource, /Топ по количеству текущих заявок/);
  assert.doesNotMatch(appSource, /summaryChartGroup/);
  assert.doesNotMatch(appSource, /Активность по месяцам/);
  assert.doesNotMatch(appSource, /Количество клиентов/);
});

test("summary charts are driven by selected status and grouping", () => {
  assert.match(appSource, /renderSummaryCharts\(scopedGroups, state\.board\.status, totals\)/);
  assert.match(appSource, /buildStatusCountPeriodRows\(status\)/);
  assert.match(appSource, /buildStatusFocusPeriodRows\(status\)/);
  assert.match(appSource, /buildGroupedPeriodSeries\(applicationCountRows, status\)/);
  assert.match(appSource, /buildGroupedPeriodSeries\(focusCountRows, status, true\)/);
  assert.match(appSource, /buildTopRequestedRows\(status\)/);
  assert.match(appSource, /buildTopCountRows\(status\)/);
  assert.match(appSource, /summaryGroupShareItems\(groups, status\)/);
  assert.match(appSource, /boardGroupName\(deal, groupBy\)/);
  assert.doesNotMatch(appSource, /boardSummaries\?\.current\?\\.\[state\.board\.groupBy\]/);
});

test("summary area charts overlay grouped series on top of the total line", () => {
  assert.match(appSource, /AREA_SERIES_COLORS/);
  assert.match(appSource, /area-series-line/);
  assert.match(appSource, /area-series-point/);
  assert.match(appSource, /area-series-legend/);
  assert.match(appSource, /boardGroupName\(deal, groupBy\)/);
  assert.match(appSource, /Остальные/);
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
