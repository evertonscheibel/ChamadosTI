import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTiAlerts, backupProblem, tiConfig } from "./ti-alerts.mjs";

const config = { enabled: true, from: "central@x.com", recipients: ["ti@x.com"] };

test("alerta da TI: avisa uma vez, lembra depois de 6 h e avisa quando normaliza", async () => {
  const sent = [];
  let t = 0;
  const alerts = createTiAlerts({ config, log: () => {}, now: () => t, transport: { sendMail: async (m) => sent.push(m.subject) } });
  assert.equal(await alerts.raise("senior", "Senior falhando", "x"), true);
  assert.equal(await alerts.raise("senior", "Senior falhando", "x"), false);
  t = 6 * 3600000;
  await alerts.raise("senior", "Senior falhando", "x");
  assert.equal(await alerts.clear("senior", "Conexão com a Senior"), true);
  assert.equal(await alerts.clear("senior", "Conexão com a Senior"), false);
  assert.deepEqual(sent, ["[Central RH · TI] Senior falhando", "[Central RH · TI] Continua: Senior falhando", "[Central RH · TI] Normalizado: Conexão com a Senior"]);
});

test("alerta da TI sem SMTP fica só no log", async () => {
  const lines = [];
  const alerts = createTiAlerts({ config: { enabled: false }, log: (l) => lines.push(l) });
  assert.equal(await alerts.raise("backup", "Backup", "x"), false);
  assert.match(lines[0], /Backup/);
  assert.equal(tiConfig({ SMTP_HOST: "smtp", ALERTA_TI_EMAILS: "a@b.com" }).enabled, true);
  assert.equal(tiConfig({ SMTP_HOST: "smtp" }).enabled, false);
});

test("situação do backup", () => {
  const dir = mkdtempSync(join(tmpdir(), "bkp-"));
  const file = join(dir, "s.json");
  const now = Date.parse("2026-11-17T12:00:00-04:00");
  assert.equal(backupProblem(file, now), null);
  writeFileSync(file, JSON.stringify({ result: "ok", lastOk: "2026-11-17T03:31:00-04:00" }));
  assert.equal(backupProblem(file, now), null);
  writeFileSync(file, JSON.stringify({ result: "ok", lastOk: "2026-11-15T03:31:00-04:00" }));
  assert.match(backupProblem(file, now), /último backup/);
  writeFileSync(file, JSON.stringify({ result: "erro", at: "2026-11-17T03:30:05-04:00", lastOk: "2026-11-16T03:31:00-04:00" }));
  assert.match(backupProblem(file, now), /falhou/);
});
