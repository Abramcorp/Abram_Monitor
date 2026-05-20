"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { acceptsGzip, sendCompressed, sendJson, staticCacheControl } = require("../server");

function makeResponse() {
  return {
    body: undefined,
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
}

test("sendJson disables API response caching", () => {
  const response = makeResponse();

  sendJson(response, 200, { ok: true });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers.Pragma, "no-cache");
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(response.body, "{\"ok\":true}");
});

test("acceptsGzip recognises gzip in Accept-Encoding header", () => {
  assert.equal(acceptsGzip({ headers: { "accept-encoding": "gzip, deflate" } }), true);
  assert.equal(acceptsGzip({ headers: { "accept-encoding": "GZIP" } }), true);
  assert.equal(acceptsGzip({ headers: { "accept-encoding": "deflate, br" } }), false);
  assert.equal(acceptsGzip({ headers: {} }), false);
  assert.equal(acceptsGzip(undefined), false);
});

test("sendCompressed skips gzip for small bodies", () => {
  const response = makeResponse();
  sendCompressed(
    { headers: { "accept-encoding": "gzip" } },
    response,
    200,
    { "Content-Type": "application/json; charset=utf-8" },
    "{\"ok\":true}"
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "{\"ok\":true}");
  assert.equal(response.headers["Content-Encoding"], undefined);
});

test("sendCompressed gzips compressible bodies above the threshold", (_, done) => {
  const response = makeResponse();
  const body = "a".repeat(2048);
  const original = response.end.bind(response);
  response.end = function (payload) {
    original(payload);
    try {
      assert.equal(response.headers["Content-Encoding"], "gzip");
      assert.equal(response.headers.Vary, "Accept-Encoding");
      const decoded = zlib.gunzipSync(payload).toString("utf8");
      assert.equal(decoded, body);
      done();
    } catch (error) {
      done(error);
    }
  };

  sendCompressed(
    { headers: { "accept-encoding": "gzip" } },
    response,
    200,
    { "Content-Type": "text/plain; charset=utf-8" },
    body
  );
});

test("sendCompressed never gzips incompressible content types", () => {
  const response = makeResponse();
  const body = Buffer.alloc(2048, 0x42);

  sendCompressed(
    { headers: { "accept-encoding": "gzip" } },
    response,
    200,
    { "Content-Type": "application/octet-stream" },
    body
  );

  assert.equal(response.headers["Content-Encoding"], undefined);
  assert.equal(response.body, body);
});

test("staticCacheControl picks per-extension cache headers", () => {
  assert.equal(staticCacheControl(".html"), "no-cache");
  assert.equal(staticCacheControl(".js"), "public, max-age=3600, must-revalidate");
  assert.equal(staticCacheControl(".css"), "public, max-age=3600, must-revalidate");
  assert.equal(staticCacheControl(".svg"), "public, max-age=3600, must-revalidate");
  assert.equal(staticCacheControl(".png"), "public, max-age=300");
});
