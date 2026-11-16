"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const sso = require("../src/sso");

const SECRET = "test-secret-value";
const USER = { id: "u-1", login: "ivanov", fullName: "Иванов И. И.", role: "admin" };

test("реестр сервисов читается из строки окружения", () => {
  const services = sso.parseServices(
    "stamp=https://stamp.example.com/, edo=https://edo.example.com , broken, x=ftp://nope"
  );
  assert.equal(services.get("stamp"), "https://stamp.example.com");
  assert.equal(services.get("edo"), "https://edo.example.com");
  assert.equal(services.has("broken"), false);
  assert.equal(services.has("x"), false, "принимаем только http(s)");
});

test("возврат разрешён только на адрес самого сервиса", () => {
  const base = "https://stamp.example.com";
  assert.ok(sso.isAllowedRedirect("https://stamp.example.com/sso/callback", base));
  assert.ok(sso.isAllowedRedirect(base, base));
  assert.equal(sso.isAllowedRedirect("https://evil.example.com/sso/callback", base), false);
  assert.equal(sso.isAllowedRedirect("http://stamp.example.com/sso/callback", base), false,
    "протокол тоже должен совпадать");
  assert.equal(sso.isAllowedRedirect("https://stamp.example.com.evil.com/x", base), false,
    "похожий хост — не тот же хост");
  assert.equal(sso.isAllowedRedirect("", base), false);
});

test("monitor roles map to service access while service accounts stay blocked", () => {
  assert.ok(sso.isRoleAllowed("admin"));
  assert.ok(sso.isRoleAllowed("analyst_abram"));
  assert.ok(sso.isRoleAllowed("documents_officer"));
  assert.equal(sso.isRoleAllowed("partner"), true);
  assert.equal(sso.isRoleAllowed("service_analytics"), false);
  assert.equal(sso.isRoleAllowed(""), false);
});

test("тикет подписан и читается обратно", () => {
  const ticket = sso.createTicket(USER, { audience: "stamp", secret: SECRET });
  const payload = sso.verifyTicket(ticket, { audience: "stamp", secret: SECRET });
  assert.equal(payload.sub, "u-1");
  assert.equal(payload.login, "ivanov");
  assert.equal(payload.role, "admin");
  assert.equal(payload.aud, "stamp");
});

test("подделанный или чужой тикет отвергается", () => {
  const ticket = sso.createTicket(USER, { audience: "stamp", secret: SECRET });
  assert.equal(sso.verifyTicket(ticket, { audience: "stamp", secret: "другой" }), null);
  assert.equal(sso.verifyTicket(ticket, { audience: "edo", secret: SECRET }), null,
    "тикет для одного сервиса не годится другому");

  const [payloadPart] = ticket.split(".");
  assert.equal(sso.verifyTicket(`${payloadPart}.подпись`, { audience: "stamp", secret: SECRET }), null);

  // Подмена содержимого без пересчёта подписи.
  const tampered = Buffer.from(JSON.stringify({ ...USER, role: "admin", aud: "stamp", exp: 99999999999 }))
    .toString("base64url");
  assert.equal(sso.verifyTicket(`${tampered}.${ticket.split(".")[1]}`,
    { audience: "stamp", secret: SECRET }), null);
});

test("просроченный тикет не принимается", () => {
  let clock = 1_000_000;
  const ticket = sso.createTicket(USER, {
    audience: "stamp", secret: SECRET, ttlMs: 60_000, now: () => clock
  });
  assert.ok(sso.verifyTicket(ticket, { audience: "stamp", secret: SECRET, now: () => clock + 30_000 }));
  assert.equal(
    sso.verifyTicket(ticket, { audience: "stamp", secret: SECRET, now: () => clock + 61_000 }),
    null
  );
});

test("каждый тикет уникален", () => {
  const first = sso.createTicket(USER, { audience: "stamp", secret: SECRET });
  const second = sso.createTicket(USER, { audience: "stamp", secret: SECRET });
  assert.notEqual(first, second);
});
test("service role defaults follow the monitor role and can be overridden per service", () => {
  assert.equal(sso.resolveServiceRole({ role: "admin" }, "anketa"), "admin");
  assert.equal(sso.resolveServiceRole({ role: "analyst_abram" }, "anketa"), "manager");
  assert.equal(sso.resolveServiceRole({ role: "partner" }, "anketa"), "partner");
  assert.equal(sso.resolveServiceRole({ role: "documents_officer" }, "anketa"), "manager");
  assert.equal(
    sso.resolveServiceRole({ role: "partner", serviceRoles: { anketa: "manager" } }, "anketa"),
    "manager"
  );
  assert.equal(
    sso.resolveServiceRole({ role: "admin", serviceRoles: { anketa: "none" } }, "anketa"),
    ""
  );
  assert.equal(sso.resolveServiceRole({ role: "service_analytics" }, "anketa"), "");
  assert.equal(
    sso.resolveServiceRole({ role: "service_analytics", serviceRoles: { anketa: "admin" } }, "anketa"),
    ""
  );
});

test("service role overrides are validated against configured services and known access levels", () => {
  assert.deepEqual(
    sso.normalizeServiceRoles(
      { anketa: "manager", stamp: "inherit", edo: "none" },
      { allowedServiceIds: ["anketa", "stamp", "edo"], rejectInvalid: true }
    ),
    { anketa: "manager", edo: "none" }
  );
  assert.throws(
    () => sso.normalizeServiceRoles({ unknown: "manager" }, {
      allowedServiceIds: ["anketa"], rejectInvalid: true
    }),
    /unknown service/i
  );
  assert.throws(
    () => sso.normalizeServiceRoles({ anketa: "owner" }, {
      allowedServiceIds: ["anketa"], rejectInvalid: true
    }),
    /access level/i
  );
});

test("ticket uses the resolved service role instead of the global monitor role", () => {
  const ticket = sso.createTicket(
    { ...USER, role: "partner", serviceRoles: { anketa: "manager" } },
    { audience: "anketa", secret: SECRET, role: "manager" }
  );
  const payload = sso.verifyTicket(ticket, { audience: "anketa", secret: SECRET });

  assert.equal(payload.role, "manager");
  assert.throws(
    () => sso.createTicket(USER, { audience: "anketa", secret: SECRET, role: "owner" }),
    /valid service role/i
  );
});
