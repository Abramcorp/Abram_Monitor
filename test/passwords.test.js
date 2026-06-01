"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword, HASH_PREFIX } = require("../src/passwords");

test("hashPassword returns scrypt-prefixed string with salt and key", async () => {
  const stored = await hashPassword("correct-horse");
  assert.ok(stored.startsWith(HASH_PREFIX));
  const parts = stored.slice(HASH_PREFIX.length).split("$");
  assert.equal(parts.length, 3);
  const [nText, saltB64, hashB64] = parts;
  assert.equal(nText, "16384");
  assert.ok(Buffer.from(saltB64, "base64").length >= 8);
  assert.equal(Buffer.from(hashB64, "base64").length, 64);
});

test("hashPassword salts each invocation differently", async () => {
  const first = await hashPassword("same-password");
  const second = await hashPassword("same-password");
  assert.notEqual(first, second);
});

test("verifyPassword accepts the original password and rejects others", async () => {
  const stored = await hashPassword("p4ss-w0rd");
  assert.equal(await verifyPassword("p4ss-w0rd", stored), true);
  assert.equal(await verifyPassword("wrong-password", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("verifyPassword rejects malformed payloads", async () => {
  assert.equal(await verifyPassword("any", ""), false);
  assert.equal(await verifyPassword("any", "scrypt$"), false);
  assert.equal(await verifyPassword("any", "plain-text"), false);
  assert.equal(await verifyPassword("any", "scrypt$16384$AAAA"), false);
});

test("hashPassword refuses empty or too-short passwords", async () => {
  await assert.rejects(() => hashPassword(""), /пустым/);
  await assert.rejects(() => hashPassword("abc"), /не короче 6/);
});
