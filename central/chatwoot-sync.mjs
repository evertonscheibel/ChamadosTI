import { randomUUID } from "node:crypto";

// Espelha no central o que acontece no Chatwoot com conversas que geraram
// chamado: resposta da atendente vira mensagem do chamado e conversa
// resolvida conclui o chamado. O vínculo é requests.chatwoot_conversation_id.

const AGENT_IDENTIFIER = "chatwoot-atendimento";

/** Usuário RH técnico que assina o que vem do Chatwoot. Não tem senha válida. */
export function chatwootAgent(db) {
  let agent = db
    .prepare("SELECT id,name FROM users WHERE identifier=?")
    .get(AGENT_IDENTIFIER);
  if (!agent) {
    agent = { id: randomUUID(), name: "Atendimento RH (Chatwoot)" };
    db.prepare(
      "INSERT INTO users (id,identifier,name,role,unit,department,password_hash) VALUES (?,?,?,?,?,?,?)",
    ).run(agent.id, AGENT_IDENTIFIER, agent.name, "rh", "RH", "RH", "!disabled");
  }
  return agent;
}

function openRequests(db, conversationId) {
  return db
    .prepare(
      "SELECT id,status,due_at FROM requests WHERE chatwoot_conversation_id=? AND status<>'Concluída'",
    )
    .all(String(conversationId));
}

/** Resposta pública de atendente no Chatwoot → mensagem nos chamados abertos da conversa. */
export function recordAgentReply(db, history, conversationId, agentName, content) {
  const requests = openRequests(db, conversationId);
  if (!requests.length || !String(content || "").trim()) return 0;
  const agent = chatwootAgent(db);
  const actor = { id: agent.id, name: `${agentName || "Atendente"} (Chatwoot)` };
  const now = new Date().toISOString();
  for (const request of requests) {
    db.prepare(
      "INSERT INTO messages (id,request_id,user_id,body,created_at,internal) VALUES (?,?,?,?,?,0)",
    ).run(randomUUID(), request.id, agent.id, `${actor.name}: ${content}`.slice(0, 10000), now);
    db.prepare("UPDATE requests SET updated_at=? WHERE id=?").run(now, request.id);
    if (request.status === "Recebida") {
      db.prepare("UPDATE requests SET status='Em atendimento' WHERE id=?").run(request.id);
      history(request.id, actor, "Status alterado para Em atendimento", "status", {
        from: "Recebida",
        to: "Em atendimento",
      });
    }
  }
  return requests.length;
}

/** Conversa resolvida no Chatwoot → conclui os chamados abertos dela. */
export function closeFromChatwoot(db, history, conversationId, agentName) {
  const requests = openRequests(db, conversationId);
  if (!requests.length) return 0;
  const agent = chatwootAgent(db);
  const actor = { id: agent.id, name: `${agentName || "Atendimento RH"} (Chatwoot)` };
  const now = new Date().toISOString();
  for (const request of requests) {
    db.prepare(
      "UPDATE requests SET status='Concluída',closed_at=?,closed_due_at=?,updated_at=? WHERE id=?",
    ).run(now, request.due_at ?? null, now, request.id);
    history(request.id, actor, "Status alterado para Concluída", "status", {
      from: request.status,
      to: "Concluída",
      origem: `chatwoot:${conversationId}`,
    });
  }
  return requests.length;
}
