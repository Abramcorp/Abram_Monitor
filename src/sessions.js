"use strict";

const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней
const TOKEN_BYTES = 32;

function makeToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

function createStore({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  const sessions = new Map();

  function prune() {
    const limit = now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= limit) {
        sessions.delete(token);
      }
    }
  }

  function create(userId) {
    if (!userId) {
      throw new Error("userId is required");
    }
    prune();
    const token = makeToken();
    const issuedAt = now();
    sessions.set(token, { userId, issuedAt, expiresAt: issuedAt + ttlMs });
    return { token, expiresAt: issuedAt + ttlMs, ttlMs };
  }

  function get(token) {
    if (!token) {
      return null;
    }
    const session = sessions.get(token);
    if (!session) {
      return null;
    }
    if (session.expiresAt <= now()) {
      sessions.delete(token);
      return null;
    }
    return session;
  }

  function destroy(token) {
    if (!token) {
      return false;
    }
    return sessions.delete(token);
  }

  function destroyAllFor(userId) {
    let removed = 0;
    for (const [token, session] of sessions) {
      if (session.userId === userId) {
        sessions.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  function size() {
    prune();
    return sessions.size;
  }

  return { create, get, destroy, destroyAllFor, size, prune, ttlMs };
}

const defaultStore = createStore();

module.exports = {
  createStore,
  defaultStore,
  DEFAULT_TTL_MS
};
