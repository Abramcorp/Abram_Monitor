"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUser, publicUser, LOGIN_PATTERN, USER_ROLES } = require("../src/users");

test("normalizeUser fills defaults and lowercases the login", () => {
  const user = normalizeUser({
    id: "user-1",
    login: " Ivan.Petrov ",
    fullName: "Иван Петров",
    role: "analyst_abram"
  });

  assert.equal(user.id, "user-1");
  assert.equal(user.login, "ivan.petrov");
  assert.equal(user.fullName, "Иван Петров");
  assert.equal(user.role, "analyst_abram");
  assert.ok(user.createdAt);
  assert.ok(user.updatedAt);
});

test("normalizeUser falls back to partner role for unknown values", () => {
  const user = normalizeUser({ login: "x_user", fullName: "X", role: "nonsense" });
  assert.equal(user.role, "partner");
});

test("publicUser strips the password hash", () => {
  const internal = normalizeUser({
    login: "admin",
    fullName: "Admin",
    role: "admin",
    passwordHash: "scrypt$16384$AAA$BBB"
  });
  const exposed = publicUser(internal);
  assert.equal(exposed.passwordHash, undefined);
  assert.equal(exposed.login, "admin");
  assert.equal(exposed.role, "admin");
  assert.equal(exposed.fullName, "Admin");
});

test("publicUser returns null for null input", () => {
  assert.equal(publicUser(null), null);
});

test("LOGIN_PATTERN allows latin letters, digits, dot, dash, underscore", () => {
  assert.equal(LOGIN_PATTERN.test("ivan_petrov"), true);
  assert.equal(LOGIN_PATTERN.test("user-1"), true);
  assert.equal(LOGIN_PATTERN.test("a.b.c"), true);
  assert.equal(LOGIN_PATTERN.test("ab"), false, "shorter than 3 chars");
  assert.equal(LOGIN_PATTERN.test("Иван"), false, "cyrillic not allowed");
  assert.equal(LOGIN_PATTERN.test("user@host"), false, "@ not allowed");
  assert.equal(LOGIN_PATTERN.test("a".repeat(41)), false, "longer than 40 chars");
});

test("USER_ROLES enumerates known roles", () => {
  assert.deepEqual(USER_ROLES, ["admin", "analyst_abram", "partner", "documents_officer"]);
});
