"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStore } = require("../src/sessions");

test("createStore issues unique tokens with TTL", () => {
  const store = createStore({ ttlMs: 60_000, now: () => 1000 });
  const a = store.create("user-1");
  const b = store.create("user-2");
  assert.notEqual(a.token, b.token);
  assert.equal(a.expiresAt, 1000 + 60_000);
  assert.equal(a.ttlMs, 60_000);
});

test("get returns the session before expiry and null after", () => {
  let clock = 1000;
  const store = createStore({ ttlMs: 5000, now: () => clock });
  const { token } = store.create("user-1");
  clock = 4000;
  assert.equal(store.get(token)?.userId, "user-1");
  clock = 6001;
  assert.equal(store.get(token), null);
});

test("destroy removes the session", () => {
  const store = createStore({ ttlMs: 60_000, now: () => 1000 });
  const { token } = store.create("user-1");
  assert.equal(store.destroy(token), true);
  assert.equal(store.get(token), null);
  assert.equal(store.destroy(token), false);
});

test("destroyAllFor removes every session for the user", () => {
  const store = createStore({ ttlMs: 60_000, now: () => 1000 });
  store.create("user-1");
  store.create("user-1");
  store.create("user-2");
  const removed = store.destroyAllFor("user-1");
  assert.equal(removed, 2);
  assert.equal(store.size(), 1);
});

test("get on an unknown or empty token returns null", () => {
  const store = createStore();
  assert.equal(store.get(""), null);
  assert.equal(store.get("nope"), null);
});
