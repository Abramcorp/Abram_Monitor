"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const telegramSource = fs.readFileSync(path.join(__dirname, "..", "src", "telegram.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const storeSource = fs.readFileSync(path.join(__dirname, "..", "src", "store.js"), "utf8");

test("кнопка «Принял» висит на самом запросе документов, а не на пакете", () => {
  assert.match(telegramSource, /function documentRequestAcceptKeyboard/);
  assert.match(telegramSource, /text: "✅ Принял"/);
  assert.match(telegramSource, /callback_data: `docreq_ack:\$\{req\.id\}:\$\{req\.acceptToken\}`/);
  // Кнопку несёт уведомление о новом/обновлённом запросе…
  const created = telegramSource.slice(
    telegramSource.indexOf("function notifyDocRequestCreated"),
    telegramSource.indexOf("async function sendDocument")
  );
  assert.match(created, /replyMarkup: documentRequestAcceptKeyboard\(req\)/);
  // …а уведомление о готовом пакете — уже нет.
  const fulfilled = telegramSource.slice(
    telegramSource.indexOf("async function notifyDocRequestFulfilled"),
    telegramSource.indexOf("function notifyDocRequestPartialUpload")
  );
  assert.match(fulfilled, /const replyMarkup = null;/);
  assert.doesNotMatch(fulfilled, /documentRequestAcceptKeyboard/);
  assert.doesNotMatch(telegramSource, /Подтвердить принятие/);
});

test("принятый запрос идёт без кнопки и с подписью принявшего", () => {
  assert.match(telegramSource, /req\?\.acknowledgedAt\)\s*\{\s*return null;/s);
  assert.match(telegramSource, /Принял в работу: <b>\$\{escapeHtml\(req\.acknowledgedBy/);
  assert.match(telegramSource, /function notifyDocRequestAcknowledged/);
  assert.match(telegramSource, /^\s+notifyDocRequestAcknowledged,\s*$/m);
});

test("webhook отмечает приём запроса в работу и глушит старую кнопку", () => {
  assert.match(serverSource, /pathname === "\/api\/telegram\/webhook"/);
  assert.match(serverSource, /docreq_ack:\(\[\^:\]\+\):\(\[a-f0-9\]\+\)/);
  assert.match(serverSource, /existing\.acceptToken !== token/);
  assert.match(serverSource, /acknowledgeDocumentRequest\(reqId, \{ actor \}\)/);
  // Старый callback приёмки пакета больше ничего не подтверждает.
  assert.match(serverSource, /\^docreq_confirm:\/i\.test\(data\)/);
  assert.match(serverSource, /Кнопка устарела: приём пакета подтверждается в Мониторе/);
});

test("напоминание раз в 2 часа обновляет сообщение с запросом, пока никто не принял", () => {
  const job = serverSource.slice(
    serverSource.indexOf("async function performDocumentAcceptanceReminders"),
    serverSource.indexOf("// ===== Ежедневный планировщик")
  );
  assert.match(job, /req\.status !== "open" \|\| req\.acknowledgedAt/);
  assert.match(job, /telegram\.deleteMessage\(\{ messageId: req\.openMessageId \}\)/);
  assert.match(job, /telegram\.notifyDocRequestCreated\(req, \{/);
  assert.doesNotMatch(job, /notifyDocRequestFulfilled/);
  assert.match(serverSource, /DOC_ACCEPTANCE_REMINDER_AFTER_MS = 2 \* 60 \* 60 \* 1000/);
});

test("store хранит отметку о приёме запроса в работу", () => {
  assert.match(storeSource, /async function acknowledgeDocumentRequest/);
  assert.match(storeSource, /acknowledgedAt,\s+acknowledgedBy:/);
  // Отметка не трогает статус запроса — он остаётся open до сбора документов.
  const fn = storeSource.slice(
    storeSource.indexOf("async function acknowledgeDocumentRequest"),
    storeSource.indexOf("// originalName =")
  );
  assert.doesNotMatch(fn, /status:/);
  assert.match(fn, /if \(current\?\.acknowledgedAt\)/);
});
