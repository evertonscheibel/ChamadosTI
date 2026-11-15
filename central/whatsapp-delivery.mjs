// Garantia de entrega das mensagens do WhatsApp RH: nenhuma mensagem some em silêncio.
//
// Cada mensagem recebida (id no Chatwoot) tem um estado em whatsapp_seen:
//   recebida    -> gravada, ainda não começou a ser processada
//   processando -> o atendente virtual está tratando
//   ok          -> tratada
//   atendente   -> deu erro (ou a central caiu no meio) e a conversa foi passada a uma atendente
//   falhou      -> deu erro e nem a passagem à atendente funcionou (Chatwoot fora): tenta de novo depois
//
// Mensagem "recebida" que não está na fila desta execução da central (ex.: a central reiniciou antes
// de chegar a vez dela) pode ser processada de novo com segurança: nada dela foi feito ainda.
// Mensagem que parou em "processando" NÃO é reprocessada (o menu poderia avançar duas vezes):
// vai para uma atendente, que vê a conversa inteira.

export const STATUS = Object.freeze({
  RECEBIDA: "recebida",
  PROCESSANDO: "processando",
  OK: "ok",
  ATENDENTE: "atendente",
  FALHOU: "falhou",
});

const messageId = (payload) => {
  const id = Number(payload?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

function row(db, id) {
  return db
    .prepare("SELECT status FROM whatsapp_seen WHERE message_id=?")
    .get(id);
}

export function setStatus(db, id, status, error = null) {
  if (!id) return;
  db.prepare(
    "UPDATE whatsapp_seen SET status=?, error=COALESCE(?, error), updated_at=? WHERE message_id=?",
  ).run(status, error, new Date().toISOString(), id);
}

/**
 * Reserva a mensagem para processamento. Verdadeiro se é nova, ou se já foi gravada mas nunca
 * começou a ser tratada e não está na fila desta execução (sobrou de uma central que reiniciou).
 * Mensagem sem id válido é sempre aceita (não há como deduplicar).
 */
export function claimMessage(db, inFlight, payload) {
  const id = messageId(payload);
  if (!id) return true;
  const inserted = db
    .prepare(
      "INSERT OR IGNORE INTO whatsapp_seen (message_id,conversation_id,seen_at,status,updated_at) VALUES (?,?,?,?,?)",
    )
    .run(
      id,
      String(payload.conversation?.id ?? ""),
      new Date().toISOString(),
      STATUS.RECEBIDA,
      new Date().toISOString(),
    );
  if (inserted.changes > 0) return true;
  return row(db, id)?.status === STATUS.RECEBIDA && !inFlight.has(id);
}

/** Para a recuperação: a mensagem já está resolvida (ou em andamento) e não deve ser pega de novo. */
export function isSettled(db, inFlight, id) {
  const current = row(db, Number(id));
  if (!current) return false;
  return !(current.status === STATUS.RECEBIDA && !inFlight.has(Number(id)));
}

/** Mensagens que precisam ir para uma atendente: falharam, ou pararam no meio (central caiu). */
export function stuckMessages(db, inFlight, sinceIso) {
  return db
    .prepare(
      "SELECT message_id, conversation_id, status, error FROM whatsapp_seen WHERE status IN (?,?) AND seen_at>=? ORDER BY message_id",
    )
    .all(STATUS.FALHOU, STATUS.PROCESSANDO, sinceIso)
    .filter((r) => !inFlight.has(Number(r.message_id)) && r.conversation_id);
}

/**
 * Passa a conversa para uma atendente (nota interna + status "open").
 * Se nem isso funcionar, a mensagem fica "falhou" e a varredura tenta de novo.
 */
export async function escalate(
  db,
  { id, conversationId, reason, notify, log = () => {} },
) {
  try {
    await notify(conversationId, reason);
    setStatus(db, id, STATUS.ATENDENTE, reason);
    log(
      `[entrega] conversa ${conversationId}: mensagem ${id ?? "?"} passada para atendente (${reason})`,
    );
    return true;
  } catch (e) {
    setStatus(
      db,
      id,
      STATUS.FALHOU,
      `${reason} | ao passar para atendente: ${e.message}`,
    );
    log(
      `[entrega] conversa ${conversationId}: não deu para passar a atendente agora (${e.message}); tento de novo`,
    );
    return false;
  }
}

/** Marca a mensagem como "na fila desta execução" (quem enfileira chama; release ao terminar). */
export function hold(inFlight, payload) {
  const id = messageId(payload);
  if (id) inFlight.add(id);
  return () => id && inFlight.delete(id);
}

/** Executa o tratamento da mensagem registrando o estado; em erro, passa para atendente. */
export async function runTracked(
  db,
  { payload, work, notify, log = () => {} },
) {
  const id = messageId(payload);
  const conversationId = payload?.conversation?.id;
  try {
    setStatus(db, id, STATUS.PROCESSANDO);
    await work();
    setStatus(db, id, STATUS.OK);
    return true;
  } catch (e) {
    log(`WhatsApp RH conversa ${conversationId}: ${e.message}`);
    await escalate(db, {
      id,
      conversationId,
      reason: `erro no atendimento automático: ${e.message}`,
      notify,
      log,
    });
    return false;
  }
}

/** Varredura: tudo que falhou ou parou no meio vai para uma atendente. */
export async function rescueStuck(
  db,
  inFlight,
  { sinceIso, notify, log = () => {} },
) {
  let rescued = 0;
  for (const r of stuckMessages(db, inFlight, sinceIso)) {
    const reason =
      r.status === STATUS.PROCESSANDO
        ? "a central foi interrompida enquanto tratava esta mensagem"
        : String(r.error || "falha anterior").split(" | ")[0];
    if (
      await escalate(db, {
        id: Number(r.message_id),
        conversationId: r.conversation_id,
        reason,
        notify,
        log,
      })
    )
      rescued++;
  }
  return rescued;
}

/**
 * Resumo para o painel do RH: quantas mensagens desde `sinceIso` foram passadas a uma
 * atendente por erro, e quantas ainda esperam (nem a passagem funcionou).
 */
export function deliveryStats(db, sinceIso) {
  const counts = Object.fromEntries(
    db
      .prepare(
        "SELECT status, COUNT(*) n FROM whatsapp_seen WHERE seen_at>=? AND status IN (?,?) GROUP BY status",
      )
      .all(sinceIso, STATUS.ATENDENTE, STATUS.FALHOU)
      .map((r) => [r.status, Number(r.n)]),
  );
  return {
    since: sinceIso,
    escalated: counts[STATUS.ATENDENTE] || 0,
    waiting: counts[STATUS.FALHOU] || 0,
  };
}
