import { db } from "./database.mjs";

/** Registra uma mensagem (usuário ou assistente) de uma conversa de chat (chatbot/atendimento),
 * criando a conversa na primeira mensagem e atualizando o nome/identificador do candidato
 * quando ele se torna conhecido (ex.: após a verificação de identidade no atendimento real). */
export function logConversationMessage(
  kind,
  sessionId,
  role,
  content,
  candidate,
) {
  const id = `${kind}:${sessionId}`;
  const now = new Date().toISOString();
  const exists = db.prepare("SELECT id FROM conversations WHERE id=?").get(id);
  if (exists) {
    db.prepare(
      "UPDATE conversations SET updated_at=?, candidate_name=COALESCE(?,candidate_name), candidate_identifier=COALESCE(?,candidate_identifier) WHERE id=?",
    ).run(now, candidate?.name || null, candidate?.identifier || null, id);
  } else {
    db.prepare(
      "INSERT INTO conversations (id, kind, session_id, candidate_name, candidate_identifier, started_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      id,
      kind,
      sessionId,
      candidate?.name || null,
      candidate?.identifier || null,
      now,
      now,
    );
  }
  db.prepare(
    "INSERT INTO conversation_messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)",
  ).run(id, role, content, now);
}

export function listConversations() {
  return db
    .prepare(
      `SELECT c.id, c.kind, c.session_id, c.candidate_name, c.candidate_identifier,
              c.started_at, c.updated_at,
              (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id=c.id) AS message_count,
              (SELECT content FROM conversation_messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) AS last_message
       FROM conversations c
       ORDER BY c.updated_at DESC
       LIMIT 200`,
    )
    .all();
}

export function conversationMessages(id) {
  return db
    .prepare(
      "SELECT id, role, content, created_at FROM conversation_messages WHERE conversation_id=? ORDER BY id ASC",
    )
    .all(id);
}
