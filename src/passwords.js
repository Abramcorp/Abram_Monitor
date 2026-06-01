"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 64 };
const SALT_BYTES = 16;
const HASH_PREFIX = "scrypt$";

async function deriveKey(password, salt) {
  const key = await scryptAsync(String(password), salt, SCRYPT_PARAMS.dkLen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p
  });
  return Buffer.from(key);
}

async function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Пароль не может быть пустым");
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);
  return `${HASH_PREFIX}${SCRYPT_PARAMS.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") {
    return false;
  }
  if (!stored.startsWith(HASH_PREFIX)) {
    return false;
  }
  const parts = stored.slice(HASH_PREFIX.length).split("$");
  if (parts.length !== 3) {
    return false;
  }
  const [nText, saltB64, hashB64] = parts;
  const n = Number(nText);
  if (!Number.isInteger(n) || n < 1024 || n > 1_048_576) {
    return false;
  }
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (!salt.length || expected.length !== SCRYPT_PARAMS.dkLen) {
    return false;
  }
  let actual;
  try {
    actual = await promisify(crypto.scrypt)(String(password), salt, expected.length, {
      N: n,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p
    });
    actual = Buffer.from(actual);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  hashPassword,
  verifyPassword,
  HASH_PREFIX
};
