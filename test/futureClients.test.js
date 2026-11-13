"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveFutureClientStatus,
  futureClientReminderKind,
  getFutureClientPeriodBounds,
  getFutureClientWindow,
  normalizeFutureClient,
  validateFutureClient
} = require("../src/futureClients");

test("future client thirds are non-overlapping and the last one reaches month end", () => {
  assert.deepEqual(getFutureClientPeriodBounds(2026, 2, 1), {
    startDate: "2026-02-01",
    endDate: "2026-02-10"
  });
  assert.deepEqual(getFutureClientPeriodBounds(2026, 2, 2), {
    startDate: "2026-02-11",
    endDate: "2026-02-20"
  });
  assert.deepEqual(getFutureClientPeriodBounds(2026, 2, 3), {
    startDate: "2026-02-21",
    endDate: "2026-02-28"
  });
  assert.equal(getFutureClientPeriodBounds(2028, 2, 3).endDate, "2028-02-29");
  assert.equal(getFutureClientPeriodBounds(2026, 12, 3).endDate, "2026-12-31");
});

test("calendar window contains the current third and the next five thirds", () => {
  const periods = getFutureClientWindow("2026-11-15T09:00:00+03:00");

  assert.deepEqual(
    periods.map(({ year, month, third }) => [year, month, third]),
    [
      [2026, 11, 2],
      [2026, 11, 3],
      [2026, 12, 1],
      [2026, 12, 2],
      [2026, 12, 3],
      [2027, 1, 1]
    ]
  );
});

test("calendar statuses change automatically around a third", () => {
  const item = normalizeFutureClient({
    id: "future-1",
    name: "ООО Ромашка",
    manager: "Граф",
    periodYear: 2026,
    periodMonth: 11,
    periodThird: 2
  });

  assert.equal(deriveFutureClientStatus(item, "2026-11-03T09:00:00+03:00"), "scheduled");
  assert.equal(deriveFutureClientStatus(item, "2026-11-04T09:00:00+03:00"), "soon");
  assert.equal(deriveFutureClientStatus(item, "2026-11-11T09:00:00+03:00"), "current");
  assert.equal(deriveFutureClientStatus(item, "2026-11-20T23:59:00+03:00"), "current");
  assert.equal(deriveFutureClientStatus(item, "2026-11-21T09:00:00+03:00"), "overdue");
});

test("terminal statuses override calendar status", () => {
  const base = {
    name: "ООО Ромашка",
    manager: "Граф",
    periodYear: 2026,
    periodMonth: 11,
    periodThird: 1
  };

  assert.equal(
    deriveFutureClientStatus(normalizeFutureClient({ ...base, movedAt: "2026-10-30T09:00:00Z" }), "2026-11-05T09:00:00+03:00"),
    "moved"
  );
  assert.equal(
    deriveFutureClientStatus(normalizeFutureClient({ ...base, cancelledAt: "2026-10-30T09:00:00Z" }), "2026-11-05T09:00:00+03:00"),
    "cancelled"
  );
});

test("future client keeps the same business fields as the client form", () => {
  const item = normalizeFutureClient({
    id: "future-fields",
    name: "ИП Иванов",
    manager: "Артем",
    inn: "12 345 678 901 2",
    parameters: { guarantee: true, region: "Москва" },
    crmUrl: "https://crm.example/1",
    driveUrl: "https://drive.example/1",
    instructionUrl: "https://docs.example/1",
    comment: "Позвонить в декабре",
    periodYear: "2026",
    periodMonth: "12",
    periodThird: "3"
  });

  assert.equal(item.inn, "123456789012");
  assert.deepEqual(item.parameters, { guarantee: true, region: "Москва" });
  assert.equal(item.crmUrl, "https://crm.example/1");
  assert.equal(item.driveUrl, "https://drive.example/1");
  assert.equal(item.instructionUrl, "https://docs.example/1");
  assert.equal(item.comment, "Позвонить в декабре");
  assert.equal(item.periodYear, 2026);
  assert.equal(item.periodMonth, 12);
  assert.equal(item.periodThird, 3);
  assert.equal("contact" in item, false);
  assert.equal("phone" in item, false);
});

test("future client can be planned without an analyst", () => {
  const item = normalizeFutureClient({
    name: "ООО Без назначения",
    manager: "",
    crmUrl: "https://crm.example/unassigned",
    periodYear: 2026,
    periodMonth: 12,
    periodThird: 1
  });

  assert.doesNotThrow(() => validateFutureClient(item));
  assert.equal(item.manager, "");
  assert.throws(
    () => validateFutureClient(normalizeFutureClient({
      name: "ООО Без CRM",
      periodYear: 2026,
      periodMonth: 12,
      periodThird: 1
    })),
    /Ссылка на CRM обязательна/
  );
});

test("reminders are sent once before the period and once per active day", () => {
  const base = normalizeFutureClient({
    id: "future-reminder",
    name: "ООО Ромашка",
    manager: "Граф",
    periodYear: 2026,
    periodMonth: 11,
    periodThird: 2
  });

  assert.equal(futureClientReminderKind(base, "2026-11-04T09:00:00+03:00"), "soon");
  assert.equal(
    futureClientReminderKind({ ...base, preReminderSentAt: "2026-11-04T06:00:00.000Z" }, "2026-11-05T09:00:00+03:00"),
    ""
  );
  assert.equal(futureClientReminderKind(base, "2026-11-11T09:00:00+03:00"), "current");
  assert.equal(
    futureClientReminderKind({ ...base, lastReminderDate: "2026-11-11" }, "2026-11-11T16:00:00+03:00"),
    ""
  );
  assert.equal(futureClientReminderKind(base, "2026-11-21T09:00:00+03:00"), "overdue");
  assert.equal(futureClientReminderKind({ ...base, cancelledAt: "2026-11-01T06:00:00Z" }, "2026-11-21T09:00:00+03:00"), "");
});
