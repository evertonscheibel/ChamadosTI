import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Banco temporário, como em produção: CENTRAL_DEMO=off bloqueia as contas de demonstração.
process.env.CENTRAL_DATA_DIR = mkdtempSync(join(tmpdir(), "central-demo-"));
process.env.CENTRAL_DEMO = "off";
const { db, verifyPassword, demoAccountsLocked } = await import("./database.mjs");

test("CENTRAL_DEMO=off: contas de demonstração não entram mais", () => {
  assert.equal(demoAccountsLocked, true);
  for (const id of ["demo-colaborador", "demo-rh"]) {
    const user = db.prepare("SELECT password_hash FROM users WHERE id=?").get(id);
    assert.equal(user.password_hash, "bloqueado");
    assert.equal(verifyPassword("FrizeloDemo!2026", user.password_hash), false);
  }
});

test("SQLite em WAL com synchronous=NORMAL (gravação sem esperar o disco a cada operação)", () => {
  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(db.prepare("PRAGMA synchronous").get().synchronous, 1);
});
