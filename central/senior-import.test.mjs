import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyActiveEmployees, accountsSchema } from "./senior-import.mjs";
import { normalizedCpf } from "./identity.mjs";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE users(id TEXT PRIMARY KEY,identifier TEXT UNIQUE,name TEXT,role TEXT,unit TEXT,department TEXT,password_hash TEXT);CREATE TABLE sessions(user_id TEXT);CREATE TABLE access_codes(user_id TEXT);${accountsSchema}`,
  );
  return db;
}
const row = (cpf = "00000000434", changes = {}) => ({
  NUMEMP: "7",
  TIPCOL: "1",
  NUMCAD: "1",
  SITAFA: "1",
  NUMCPF: cpf,
  NOMFUN: "Colaborador fictício",
  CODFIL: "1",
  ...changes,
});
test("import keeps passwords and roles, deduplicates CPF and preserves vacation/leave", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)").run(
      "existing",
      "00000000434",
      "Anterior",
      "colaborador",
      "Anterior",
      "Setor validado",
      "existing-hash",
    );
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)").run(
      "rh",
      "00000000272",
      "RH",
      "rh",
      "Matriz",
      "RH",
      "rh-hash",
    );
    const result = applyActiveEmployees(
      db,
      [
        row(),
        row("00000000434", { NUMCAD: "2", SITAFA: "2" }),
        row("00000000515", { NUMCAD: "3", SITAFA: "3" }),
        row("00000000272", { NUMCAD: "4" }),
      ],
      "7",
    );
    assert.equal(result.created, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.roleConflicts, 1);
    const employee = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get("existing");
    assert.equal(employee.password_hash, "existing-hash");
    assert.equal(employee.department, "Setor validado");
    assert.equal(employee.name, "Colaborador fictício");
    assert.equal(
      db
        .prepare("SELECT password_hash FROM users WHERE identifier=?")
        .get("00000000515").password_hash,
      "!activation-required",
    );
    assert.equal(
      JSON.parse(
        db
          .prepare("SELECT links FROM senior_accounts WHERE user_id=?")
          .get("existing").links,
      ).length,
      2,
    );
    assert.equal(
      db.prepare("SELECT role FROM users WHERE id=?").get("rh").role,
      "rh",
    );
  } finally {
    db.close();
  }
});
test("empty, foreign, terminated or ambiguous snapshots never partially write", () => {
  const db = fixture();
  try {
    assert.throws(() => applyActiveEmployees(db, [], "7"));
    assert.throws(() =>
      applyActiveEmployees(db, [row("", { SITAFA: "7" })], "7"),
    );
    assert.throws(() =>
      applyActiveEmployees(db, [row("", { NUMEMP: "8" })], "7"),
    );
    assert.throws(() =>
      applyActiveEmployees(
        db,
        [
          row("00000000515"),
          row("00000000434"),
          row("00000000434", { NUMCAD: "2", NOMFUN: "Outro nome" }),
        ],
        "7",
      ),
    );
    assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 0);
  } finally {
    db.close();
  }
});
test("reconciliation revokes absent managed users only with a valid complete snapshot", () => {
  const db = fixture();
  try {
    applyActiveEmployees(db, [row(), row("00000000515", { NUMCAD: "2" })], "7");
    const id = db
      .prepare("SELECT id FROM users WHERE identifier=?")
      .get("00000000515").id;
    db.prepare("INSERT INTO sessions VALUES (?)").run(id);
    db.prepare("INSERT INTO access_codes VALUES (?)").run(id);
    const unsafe = applyActiveEmployees(
      db,
      [row(), row("00000000000", { NUMCAD: "3" })],
      "7",
    );
    assert.equal(unsafe.invalidCpf, 1);
    assert.equal(unsafe.deactivationDeferred, true);
    assert.equal(unsafe.deactivated, 0);
    const complete = applyActiveEmployees(db, [row()], "7");
    assert.equal(complete.deactivated, 1);
    assert.equal(
      db.prepare("SELECT active FROM senior_accounts WHERE user_id=?").get(id)
        .active,
      0,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM sessions").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM access_codes").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 2);
  } finally {
    db.close();
  }
});
test("Senior CPF normalization preserves zeros and rejects invalid check digits", () => {
  assert.equal(normalizedCpf("434"), "00000000434");
  assert.equal(normalizedCpf("000.000.004-34"), "00000000434");
  assert.equal(normalizedCpf("00000000000"), null);
  assert.equal(normalizedCpf("00000000435"), null);
});
