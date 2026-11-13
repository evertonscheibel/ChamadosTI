import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverMissed } from "./whatsapp-recovery.mjs";

const since = 1_000_000;
const conversations = [
  { id: 12, inbox_id: 12, status: "open", last_activity_at: since + 500, meta: { sender: { phone_number: "+5567998969836" } } },
  { id: 13, inbox_id: 12, status: "resolved", last_activity_at: since + 100 },
  { id: 99, inbox_id: 7, status: "open", last_activity_at: since + 900 }, // outra caixa
  { id: 5, inbox_id: 12, status: "open", last_activity_at: since - 10 }, // antes do início
];
const messages = {
  12: [
    { id: 300, message_type: 0, content: "antiga", created_at: since - 50 },
    { id: 302, message_type: 0, content: "segunda", created_at: since + 400 },
    { id: 301, message_type: 0, content: "primeira", created_at: since + 300 },
    { id: 303, message_type: 1, content: "resposta do RH", created_at: since + 450 },
    { id: 304, message_type: 0, private: true, content: "nota", created_at: since + 460 },
    { id: 305, message_type: 0, content: "já processada", created_at: since + 480 },
  ],
  13: [{ id: 400, message_type: 0, content: "status", created_at: since + 100, attachments: [{ data_url: "x" }] }],
};

test("recupera só mensagens recebidas, novas, não vistas, em ordem", async () => {
  const processed = [];
  const pages = [];
  const count = await recoverMissed({
    inboxId: 12,
    since,
    seen: (id) => id === 305,
    process: async (p) => processed.push(p),
    listConversations: async (page) => (pages.push(page), page === 1 ? conversations : []),
    listMessages: async (id) => messages[id] || [],
  });
  assert.equal(count, 3);
  assert.deepEqual(processed.map((p) => p.content), ["primeira", "segunda", "status"]);
  assert.equal(processed[0].conversation.id, 12);
  assert.equal(processed[0].sender.phone_number, "+5567998969836");
  assert.equal(processed[0].message_type, "incoming");
  assert.equal(processed[2].attachments.length, 1);
  assert.deepEqual(pages, [1], "parou de paginar ao achar conversa anterior ao início");
});

test("sem nada novo não processa nada", async () => {
  const count = await recoverMissed({
    inboxId: 12,
    since: since + 10_000,
    seen: () => false,
    process: async () => assert.fail("não deveria processar"),
    listConversations: async () => conversations,
    listMessages: async () => assert.fail("não deveria ler mensagens"),
  });
  assert.equal(count, 0);
});
