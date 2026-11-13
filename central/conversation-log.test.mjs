import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Banco temporário: o teste nunca toca o banco real da central (data/central.sqlite).
process.env.CENTRAL_DATA_DIR = mkdtempSync(join(tmpdir(), "central-conversas-"));
const { logConversationMessage, listConversations, conversationMessages } = await import("./conversation-log.mjs");

test("logConversationMessage cria a conversa na primeira mensagem e acumula as seguintes", () => {
  const sessionId = randomUUID();
  logConversationMessage("chatbot", sessionId, "user", "Olá, tenho uma dúvida");
  logConversationMessage(
    "chatbot",
    sessionId,
    "assistant",
    "Pode me contar mais?",
  );
  const id = `chatbot:${sessionId}`;
  const messages = conversationMessages(id);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "Olá, tenho uma dúvida");
  assert.equal(messages[1].role, "assistant");
  const summary = listConversations().find((c) => c.id === id);
  assert.ok(summary, "a conversa deve aparecer na listagem");
  assert.equal(summary.message_count, 2);
  assert.equal(summary.last_message, "Pode me contar mais?");
});

test("logConversationMessage preenche o candidato quando ele se torna conhecido, sem apagar o que já foi confirmado", () => {
  const sessionId = randomUUID();
  const id = `atendimento:${sessionId}`;
  logConversationMessage("atendimento", sessionId, "user", "não sei meu CPF");
  logConversationMessage(
    "atendimento",
    sessionId,
    "assistant",
    "Qual é a sua matrícula?",
    { name: "Mariana Silva", identifier: "00000000191" },
  );
  let summary = listConversations().find((c) => c.id === id);
  assert.equal(summary.candidate_name, "Mariana Silva");
  assert.equal(summary.candidate_identifier, "00000000191");

  logConversationMessage(
    "atendimento",
    sessionId,
    "user",
    "quero ver meu holerite",
  );
  summary = listConversations().find((c) => c.id === id);
  assert.equal(
    summary.candidate_name,
    "Mariana Silva",
    "candidato já identificado não deve ser apagado por uma mensagem sem candidato",
  );
});

test("chatbot e atendimento com o mesmo session_id geram conversas distintas", () => {
  const sessionId = randomUUID();
  logConversationMessage("chatbot", sessionId, "user", "mensagem do simulador");
  logConversationMessage(
    "atendimento",
    sessionId,
    "user",
    "mensagem do atendimento real",
  );
  const chatbotMessages = conversationMessages(`chatbot:${sessionId}`);
  const atendimentoMessages = conversationMessages(`atendimento:${sessionId}`);
  assert.equal(chatbotMessages.length, 1);
  assert.equal(atendimentoMessages.length, 1);
  assert.equal(chatbotMessages[0].content, "mensagem do simulador");
  assert.equal(atendimentoMessages[0].content, "mensagem do atendimento real");
});
