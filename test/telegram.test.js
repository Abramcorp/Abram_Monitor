"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const telegramSource = fs.readFileSync(path.join(__dirname, "..", "src", "telegram.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("telegram document delivery notification includes an inline acceptance button", () => {
  assert.match(telegramSource, /function documentRequestConfirmKeyboard/);
  assert.match(telegramSource, /text: "Подтвердить принятие"/);
  assert.match(telegramSource, /callback_data: `docreq_confirm:\$\{req\.id\}:\$\{req\.acceptToken\}`/);
  assert.match(telegramSource, /payload\.reply_markup = replyMarkup/);
  assert.match(telegramSource, /async function answerCallbackQuery/);
});

test("telegram webhook confirms document acceptance by callback token", () => {
  assert.match(serverSource, /pathname === "\/api\/telegram\/webhook"/);
  assert.match(serverSource, /docreq_confirm:\(\[\^:\]\+\):\(\[a-f0-9\]\+\)/);
  assert.match(serverSource, /existing\.acceptToken !== token/);
  assert.match(serverSource, /confirmDocumentRequest\(reqId, \{ actor: telegramCallbackActor\(callbackQuery\) \}\)/);
  assert.match(serverSource, /setDocumentRequestAcceptanceReminderAt\(req\.id, new Date\(\)\.toISOString\(\), req\.acceptToken\)/);
});
