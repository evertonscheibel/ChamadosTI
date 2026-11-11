import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { recordAgentReply, closeFromChatwoot, chatwootAgent } from "./chatwoot-sync.mjs";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, identifier TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, unit TEXT NOT NULL, department TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE requests (id TEXT PRIMARY KEY, status TEXT NOT NULL, due_at TEXT, closed_at TEXT, closed_due_at TEXT, updated_at TEXT, chatwoot_conversation_id TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, request_id TEXT, user_id TEXT, body TEXT, created_at TEXT, internal INTEGER);
  `);
  db.prepare("INSERT INTO requests (id,status,chatwoot_conversation_id) VALUES ('r1','Recebida','7'),('r2','Concluída','7'),('r3','Recebida','8')").run();
  const events = [];
  const history = (id, actor, event, kind, data) => events.push({ id, actor: actor.name, event, data });
  return { db, events, history };
}

test("resposta da atendente vira mensagem só nos chamados abertos da conversa e marca Em atendimento", () => {
  const { db, events, history } = setup();
  assert.equal(recordAgentReply(db, history, 7, "Mayara", "Seu holerite está no portal."), 1);
  const messages = db.prepare("SELECT request_id,body FROM messages").all();
  assert.deepEqual(messages.map((m) => ({ ...m })), [
    { request_id: "r1", body: "Mayara (Chatwoot): Seu holerite está no portal." },
  ]);
  assert.equal(db.prepare("SELECT status FROM requests WHERE id='r1'").get().status, "Em atendimento");
  assert.equal(db.prepare("SELECT status FROM requests WHERE id='r3'").get().status, "Recebida");
  assert.deepEqual(events.map((e) => e.event), ["Status alterado para Em atendimento"]);
});

test("conversa sem chamado vinculado não grava nada", () => {
  const { db, events, history } = setup();
  assert.equal(recordAgentReply(db, history, 99, "Mayara", "oi"), 0);
  assert.equal(closeFromChatwoot(db, history, 99, "Mayara"), 0);
  assert.equal(db.prepare("SELECT count(*) n FROM messages").get().n, 0);
  assert.equal(events.length, 0);
});

test("conversa resolvida conclui os chamados abertos dela, uma vez só", () => {
  const { db, events, history } = setup();
  assert.equal(closeFromChatwoot(db, history, 7, "Haliny"), 1);
  const r1 = db.prepare("SELECT status,closed_at FROM requests WHERE id='r1'").get();
  assert.equal(r1.status, "Concluída");
  assert.ok(r1.closed_at);
  assert.equal(events[0].actor, "Haliny (Chatwoot)");
  assert.equal(closeFromChatwoot(db, history, 7, "Haliny"), 0); // evento repetido não duplica histórico
  assert.equal(events.length, 1);
});

test("usuário técnico do Chatwoot é criado uma vez, como RH e sem senha válida", () => {
  const { db } = setup();
  const a = chatwootAgent(db);
  const b = chatwootAgent(db);
  assert.equal(a.id, b.id);
  const row = db.prepare("SELECT role,password_hash FROM users WHERE id=?").get(a.id);
  assert.equal(row.role, "rh");
  assert.equal(row.password_hash, "!disabled");
});
