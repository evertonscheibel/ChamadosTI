import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, initialState, wahaConfig, COOLDOWN_MS } from "./waha-watchdog.mjs";

const MIN = 60000;
const working = (extra = {}) => ({ reachable: true, status: "WORKING", uptimeMs: 60 * MIN, probeOk: true, chatwootUp: true, ...extra });

test("sessão saudável não faz nada", () => {
  const r = decide(initialState(), working(), 10 * COOLDOWN_MS);
  assert.equal(r.action, null);
  assert.equal(r.health, "ok");
});

test("depois do reboot reinicia a sessão uma vez, quando o Chatwoot já responde", () => {
  let now = 10 * COOLDOWN_MS;
  let r = decide(initialState(), working({ uptimeMs: 30000, chatwootUp: false }), now);
  assert.equal(r.action, null);
  assert.equal(r.health, "reconectando");
  r = decide(r.state, working({ uptimeMs: 3 * MIN, chatwootUp: false }), (now += 2 * MIN));
  assert.equal(r.action, null);
  r = decide(r.state, working({ uptimeMs: 5 * MIN }), (now += 2 * MIN));
  assert.equal(r.action, "restart");
  assert.match(r.reason, /reboot/);
  r = decide(r.state, working({ uptimeMs: 7 * MIN }), (now += 2 * MIN));
  assert.equal(r.action, null);
  assert.equal(r.health, "ok");
});

test("central reiniciada sozinha (WAHA antigo) não reinicia a sessão", () => {
  const r = decide(initialState(), working({ uptimeMs: 5 * 60 * MIN }), 10 * COOLDOWN_MS);
  assert.equal(r.action, null);
});

test("WAHA reiniciado enquanto a central rodava também dispara o reinício", () => {
  let r = decide(initialState(), working(), 10 * COOLDOWN_MS);
  r = decide(r.state, working({ uptimeMs: 2 * MIN }), 11 * COOLDOWN_MS);
  assert.equal(r.action, "restart");
});

test("WAHA rodando há horas não é tratado como reboot a cada verificação", () => {
  let r = { state: initialState() };
  let now = 10 * COOLDOWN_MS;
  for (let i = 0; i < 20; i++) {
    r = decide(r.state, working({ uptimeMs: 17 * 60 * MIN + i * 2 * MIN }), (now += 2 * MIN));
    assert.equal(r.action, null);
    assert.equal(r.health, "ok");
  }
});

test("conexão morta: reinicia na segunda falha seguida da sonda", () => {
  let r = decide(initialState(), working({ probeOk: false }), 10 * COOLDOWN_MS);
  assert.equal(r.action, null);
  assert.equal(r.health, "sem_conexao");
  r = decide(r.state, working({ probeOk: false }), 10 * COOLDOWN_MS + 2 * MIN);
  assert.equal(r.action, "restart");
});

test("parada, falha, presa iniciando e QR code", () => {
  const now = 10 * COOLDOWN_MS;
  assert.equal(decide(initialState(), working({ status: "STOPPED", probeOk: null }), now).action, "start");
  assert.equal(decide(initialState(), working({ status: "FAILED", probeOk: null }), now).action, "restart");
  const qr = decide(initialState(), working({ status: "SCAN_QR_CODE", probeOk: null }), now);
  assert.equal(qr.action, null);
  assert.equal(qr.health, "qr");
  let r = { state: initialState() };
  for (const expected of [null, null, "restart"]) {
    r = decide(r.state, working({ status: "STARTING", probeOk: null }), now);
    assert.equal(r.action, expected);
  }
  assert.equal(decide(initialState(), { reachable: false }, now).health, "waha_offline");
});

test("no máximo um reinício a cada 10 minutos", () => {
  let r = decide(initialState(), working({ status: "FAILED" }), 10 * COOLDOWN_MS);
  assert.equal(r.action, "restart");
  r = decide(r.state, working({ status: "FAILED" }), 10 * COOLDOWN_MS + 2 * MIN);
  assert.equal(r.action, null);
  r = decide(r.state, working({ status: "FAILED" }), 11 * COOLDOWN_MS + 1);
  assert.equal(r.action, "restart");
});

test("sem chave da API o vigia fica desligado", () => {
  assert.equal(wahaConfig({}).enabled, false);
  assert.equal(wahaConfig({ WAHA_API_KEY: "x" }).enabled, true);
  assert.equal(wahaConfig({ WAHA_API_KEY: "x", WAHA_WATCHDOG: "off" }).enabled, false);
});
