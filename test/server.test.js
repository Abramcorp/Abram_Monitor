"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { acceptsGzip, buildSessionCookie, clearSessionCookie, computeEtag, parseCookies, sendCompressed, sendJson, staticCacheControl } = require("../server");

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

test("sendJson sets revalidate-on-each-request cache headers", () => {
  const response = makeResponse();

  sendJson(response, 200, { ok: true });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-cache");
  assert.equal(response.headers.Pragma, "no-cache");
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(response.body, "{\"ok\":true}");
});

test("sendJson attaches a weak ETag to substantial payloads", () => {
  const response = makeResponse();
  const payload = { items: new Array(20).fill("entry") };

  sendJson(response, 200, payload);

  assert.equal(response.statusCode, 200);
  const etag = response.headers.ETag;
  assert.ok(etag, "ETag header is present");
  assert.match(etag, /^W\/"[A-Za-z0-9+/=]{20,32}"$/);
  assert.equal(etag, computeEtag(JSON.stringify(payload)));
});

test("sendJson omits ETag for tiny bodies and non-200 responses", () => {
  const tinyResponse = makeResponse();
  sendJson(tinyResponse, 200, { ok: true });
  assert.equal(tinyResponse.headers.ETag, undefined);

  const errorResponse = makeResponse();
  sendJson(errorResponse, 404, { error: "Not found, with enough text to exceed the ETag minimum size limit." });
  assert.equal(errorResponse.headers.ETag, undefined);
});

test("sendCompressed returns 304 on matching If-None-Match", () => {
  const body = JSON.stringify({ items: new Array(20).fill("entry") });
  const etag = computeEtag(body);
  const response = makeResponse();

  sendCompressed(
    { headers: { "if-none-match": etag } },
    response,
    200,
    {
      "Cache-Control": "no-cache",
      "Content-Type": "application/json; charset=utf-8",
      "ETag": etag
    },
    body
  );

  assert.equal(response.statusCode, 304);
  assert.equal(response.headers.ETag, etag);
  assert.equal(response.headers["Cache-Control"], "no-cache");
  assert.equal(response.body, undefined);
});

test("sendCompressed sends full body when ETag does not match", () => {
  const body = JSON.stringify({ items: new Array(20).fill("entry") });
  const etag = computeEtag(body);
  const response = makeResponse();

  sendCompressed(
    { headers: { "if-none-match": "W/\"stale\"" } },
    response,
    200,
    {
      "Cache-Control": "no-cache",
      "Content-Type": "application/json; charset=utf-8",
      "ETag": etag
    },
    body
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, body);
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
  assert.equal(staticCacheControl(".js"), "no-cache");
  assert.equal(staticCacheControl(".css"), "no-cache");
  assert.equal(staticCacheControl(".svg"), "public, max-age=3600, must-revalidate");
  assert.equal(staticCacheControl(".png"), "public, max-age=300");
});

test("parseCookies extracts named values from a Cookie header", () => {
  const cookies = parseCookies("am_session=abc.def; foo=bar; baz=q%C3%BCx");
  assert.equal(cookies.am_session, "abc.def");
  assert.equal(cookies.foo, "bar");
  assert.equal(cookies.baz, "qüx");
});

test("parseCookies returns an empty object for missing or invalid headers", () => {
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies("nokey"), {});
});

test("buildSessionCookie produces HttpOnly cookie with SameSite Lax and TTL", () => {
  const cookie = buildSessionCookie("abc.def", 60_000, { secure: false });
  assert.match(cookie, /^am_session=abc\.def;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=60/);
  assert.doesNotMatch(cookie, /Secure/);
});

test("buildSessionCookie adds Secure when requested", () => {
  const cookie = buildSessionCookie("abc.def", 60_000, { secure: true });
  assert.match(cookie, /Secure/);
});

test("clearSessionCookie sets empty value with Max-Age 0", () => {
  const cookie = clearSessionCookie({ secure: false });
  assert.match(cookie, /^am_session=;/);
  assert.match(cookie, /Max-Age=0/);
});
