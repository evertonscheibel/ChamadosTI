import { db } from "./database.mjs";

/** Registra uma resposta de IA completa (categoria "duvida", nos dois chats)
 * para medir, ao longo do tempo: quantas dúvidas chegam à IA, em quantas o
 * RAG achou algo relevante, e em quantas virou chamado para o RH. */
export function recordAnswer({ kind, ragHit, ticketCreated }) {
  db.prepare(
    "INSERT INTO ai_answers (kind, rag_hit, ticket_created, created_at) VALUES (?,?,?,?)",
  ).run(kind, ragHit ? 1 : 0, ticketCreated ? 1 : 0, new Date().toISOString());
}

/** Resumo dos últimos `days` dias: totais gerais e a série diária, para o
 * painel do RH acompanhar se o RAG está realmente ajudando (rag_hit) e
 * quantas dúvidas ainda terminam em chamado humano. */
export function metricsSummary(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(rag_hit) AS rag_hits,
              SUM(ticket_created) AS tickets
       FROM ai_answers WHERE created_at >= ?`,
    )
    .get(since);
  const daily = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
              COUNT(*) AS total,
              SUM(rag_hit) AS rag_hits,
              SUM(ticket_created) AS tickets
       FROM ai_answers WHERE created_at >= ?
       GROUP BY day ORDER BY day DESC`,
    )
    .all(since);
  return {
    since,
    total: totals.total || 0,
    ragHits: totals.rag_hits || 0,
    tickets: totals.tickets || 0,
    daily,
  };
}
