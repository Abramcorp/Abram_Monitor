"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("future clients have a dedicated six-period calendar and admin summary", () => {
  assert.match(appSource, /id: "future-clients", label: "Будущие клиенты"/);
  assert.match(appSource, /function futureClientWindow\([^)]*count = 6\)/);
  assert.match(appSource, /function renderFutureClientsView\(/);
  assert.match(appSource, /function renderAdminFutureCalendarWidget\(/);
  assert.match(appSource, /\$\{renderAdminFutureCalendarWidget\(\)\}/);
  assert.match(appSource, /item\.status === "overdue"/);
  assert.match(cssSource, /\.future-calendar-grid/);
});

test("future calendar is shared by internal managers and hidden from the partner contour", () => {
  assert.match(appSource, /id: "future-clients", label: "Будущие клиенты", allowedRoles: \["admin", "analyst_abram"\]/);
  assert.match(appSource, /futureClients: \{[^\n]*allowedRoles: \["admin", "analyst_abram"\]/);
  assert.match(appSource, /futureClientForm\.elements\.manager\.disabled = false/);

  const futureApiStart = serverSource.indexOf('pathname === "/api/future-clients"');
  const futureApiEnd = serverSource.indexOf('pathname === "/api/clients"', futureApiStart);
  const futureApi = serverSource.slice(futureApiStart, futureApiEnd);
  assert.ok(futureApiStart >= 0 && futureApiEnd > futureApiStart);
  assert.doesNotMatch(futureApi, /"partner"/);
});

test("future client cards stay compact until selected and cannot overflow their period", () => {
  assert.match(appSource, /<details class="future-client-card/);
  assert.match(appSource, /<summary class="future-client-card-summary">/);
  assert.match(appSource, /item\.manager \? `<span class="future-client-manager muted">/);
  assert.match(appSource, /<div class="future-client-card-body">/);
  assert.match(cssSource, /\.future-period\s*\{[^}]*min-width:\s*0;/s);
  assert.match(cssSource, /\.future-client-card\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(cssSource, /\.future-client-card-summary strong\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
});

test("future client form mirrors business fields without contacts", () => {
  const dialogStart = htmlSource.indexOf('id="futureClientDialog"');
  const dialogEnd = htmlSource.indexOf('id="planTemplateDialog"');
  const dialog = htmlSource.slice(dialogStart, dialogEnd);

  assert.ok(dialogStart >= 0 && dialogEnd > dialogStart);
  for (const field of ["manager", "name", "inn", "periodMonth", "periodThird", "crmUrl", "driveUrl", "instructionUrl", "comment"]) {
    assert.match(dialog, new RegExp(`name="${field}"`));
  }
  assert.doesNotMatch(dialog, /name="(?:contact|phone)"/);
  assert.match(dialog, /name="crmUrl"[^>]*required/);
  assert.doesNotMatch(dialog, /name="driveUrl"[^>]*required/);
  assert.doesNotMatch(dialog, /<select name="manager"[^>]*required/);
  assert.match(appSource, /futureClientForm\.elements\.manager\.value = item \? \(item\.manager \|\| ""\)\s*:/);
});

test("moving a future client reuses the ordinary client form and endpoint", () => {
  assert.match(htmlSource, /id="clientForm"[\s\S]*?<select name="manager" required/);
  assert.match(htmlSource, /name="futureClientId" type="hidden"/);
  assert.match(appSource, /openClientDialog\(item, \{ futureClientId: item\.id \}\)/);
  assert.match(appSource, /\/api\/future-clients\/\$\{encodeURIComponent\(futureClientId\)\}\/move-to-work/);
  assert.match(appSource, /findDuplicateClientName\(payload\.name\)/);
  assert.match(serverSource, /\/api\\\/future-clients\\\/\(\[\^\/\]\+\)\\\/move-to-work/);
});
