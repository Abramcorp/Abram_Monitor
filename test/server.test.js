"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sendJson } = require("../server");

test("sendJson disables API response caching", () => {
  const response = {
    body: "",
    headers: {},
    statusCode: 0,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };

  sendJson(response, 200, { ok: true });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers.Pragma, "no-cache");
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(response.body, "{\"ok\":true}");
});
