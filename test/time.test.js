"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getMoscowNow, parseWorldTimePayload, toIsoDate } = require("../src/time");

test("toIsoDate treats datetime-local input as Moscow time", () => {
  assert.equal(toIsoDate("2026-05-19T10:30"), "2026-05-19T07:30:00.000Z");
});

test("toIsoDate keeps explicit timezone offsets unchanged", () => {
  assert.equal(toIsoDate("2026-05-19T10:30:00+05:00"), "2026-05-19T05:30:00.000Z");
});

test("parseWorldTimePayload accepts WorldTimeAPI utc datetime", () => {
  assert.equal(
    parseWorldTimePayload({ utc_datetime: "2026-05-19T07:30:00.000Z" }),
    "2026-05-19T07:30:00.000Z"
  );
});

test("getMoscowNow uses internet time when the check succeeds", async () => {
  const result = await getMoscowNow({
    fetcher: async () => ({
      ok: true,
      json: async () => ({ utc_datetime: "2026-05-19T07:30:00.000Z" })
    })
  });

  assert.equal(result.iso, "2026-05-19T07:30:00.000Z");
  assert.equal(result.source, "worldtimeapi");
  assert.equal(result.timeZone, "Europe/Moscow");
});

test("getMoscowNow falls back without blocking writes", async () => {
  const result = await getMoscowNow({
    fetcher: async () => {
      throw new Error("network");
    },
    fallbackDate: new Date("2026-05-19T07:30:00.000Z")
  });

  assert.equal(result.iso, "2026-05-19T07:30:00.000Z");
  assert.equal(result.source, "server-fallback");
  assert.equal(result.timeZone, "Europe/Moscow");
});
