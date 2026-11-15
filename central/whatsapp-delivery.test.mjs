import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  STATUS,
  claimMessage,
  isSettled,
  hold,
  runTracked,
  rescueStuck,
} from "./whatsapp-delivery.mjs";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE whatsapp_seen (message_id INTEGER PRIMARY KEY, conversation_id TEXT, seen_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ok', error TEXT, updated_at TEXT)",
  );
  return db;
}
const msg = (id, conversation = 7) => ({
  id,
  conversation: { id: conversation },
});
const status = (db, id) =>
  db.prepare("SELECT status FROM whatsapp_seen WHERE message_id=?").get(id)
    ?.status;
const SINCE = "2000-01-01T00:00:00.000Z";

test("mensagem nova é aceita; reentrega enquanto está na fila é recusada", () => {
  const db = freshDb();
  const inFlight = new Set();
  assert.equal(claimMessage(db, inFlight, msg(1)), true);
  const release = hold(inFlight, msg(1));
  assert.equal(claimMessage(db, inFlight, msg(1)), false);
  assert.equal(isSettled(db, inFlight, 1), true);
  release();
});

test("mensagem gravada que nunca começou (central reiniciou) é retomada pela recuperação", () => {
  const db = freshDb();
  claimMessage(db, new Set(), msg(2));
  const depoisDoReinicio = new Set();
  assert.equal(isSettled(db, depoisDoReinicio, 2), false);
  assert.equal(claimMessage(db, depoisDoReinicio, msg(2)), true);
});

test("sucesso marca ok e a mensagem não volta a ser processada", async () => {
  const db = freshDb();
  claimMessage(db, new Set(), msg(3));
  const ok = await runTracked(db, {
    payload: msg(3),
    work: async () => {},
    notify: async () => assert.fail(),
  });
  assert.equal(ok, true);
  assert.equal(status(db, 3), STATUS.OK);
  assert.equal(isSettled(db, new Set(), 3), true);
  assert.equal(claimMessage(db, new Set(), msg(3)), false);
});

test("erro no tratamento passa a conversa para atendente, com o motivo", async () => {
  const db = freshDb();
  const avisos = [];
  claimMessage(db, new Set(), msg(4, 99));
  const ok = await runTracked(db, {
    payload: msg(4, 99),
    work: async () => {
      throw new Error("Senior fora do ar");
    },
    notify: async (conversationId, reason) =>
      avisos.push([conversationId, reason]),
  });
  assert.equal(ok, false);
  assert.equal(status(db, 4), STATUS.ATENDENTE);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0][0], 99);
  assert.match(avisos[0][1], /Senior fora do ar/);
  assert.equal(
    claimMessage(db, new Set(), msg(4, 99)),
    false,
    "não reprocessa depois de passar à atendente",
  );
});

test("se nem a passagem à atendente funciona, fica 'falhou' e a varredura tenta de novo", async () => {
  const db = freshDb();
  claimMessage(db, new Set(), msg(5, 50));
  await runTracked(db, {
    payload: msg(5, 50),
    work: async () => {
      throw new Error("timeout");
    },
    notify: async () => {
      throw new Error("Chatwoot fora do ar");
    },
  });
  assert.equal(status(db, 5), STATUS.FALHOU);

  let chamadas = 0;
  const falhaDeNovo = await rescueStuck(db, new Set(), {
    sinceIso: SINCE,
    notify: async () => {
      chamadas++;
      throw new Error("ainda fora");
    },
  });
  assert.equal(falhaDeNovo, 0);
  assert.equal(status(db, 5), STATUS.FALHOU);

  const avisos = [];
  const resgatadas = await rescueStuck(db, new Set(), {
    sinceIso: SINCE,
    notify: async (c, r) => avisos.push([c, r]),
  });
  assert.equal(resgatadas, 1);
  assert.equal(chamadas, 1);
  assert.equal(status(db, 5), STATUS.ATENDENTE);
  assert.deepEqual(avisos[0], [
    "50",
    "erro no atendimento automático: timeout",
  ]);
});

test("mensagem que parou no meio (central caiu) vai para atendente, sem reprocessar", async () => {
  const db = freshDb();
  claimMessage(db, new Set(), msg(6, 60));
  db.prepare(
    "UPDATE whatsapp_seen SET status='processando' WHERE message_id=6",
  ).run();
  const depoisDoReinicio = new Set();
  assert.equal(claimMessage(db, depoisDoReinicio, msg(6, 60)), false);
  assert.equal(isSettled(db, depoisDoReinicio, 6), true);
  const avisos = [];
  await rescueStuck(db, depoisDoReinicio, {
    sinceIso: SINCE,
    notify: async (c, r) => avisos.push([c, r]),
  });
  assert.equal(status(db, 6), STATUS.ATENDENTE);
  assert.match(avisos[0][1], /interrompida/);
});

test("a varredura não mexe no que ainda está sendo tratado nesta execução", async () => {
  const db = freshDb();
  const inFlight = new Set();
  claimMessage(db, inFlight, msg(7));
  hold(inFlight, msg(7));
  db.prepare(
    "UPDATE whatsapp_seen SET status='processando' WHERE message_id=7",
  ).run();
  const resgatadas = await rescueStuck(db, inFlight, {
    sinceIso: SINCE,
    notify: async () => assert.fail(),
  });
  assert.equal(resgatadas, 0);
  assert.equal(status(db, 7), STATUS.PROCESSANDO);
});

test("mensagens antigas (já existentes antes da mudança) contam como tratadas", () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO whatsapp_seen (message_id,conversation_id,seen_at) VALUES (8,'1','2026-11-01')",
  ).run();
  assert.equal(isSettled(db, new Set(), 8), true);
  assert.equal(claimMessage(db, new Set(), msg(8)), false);
});
