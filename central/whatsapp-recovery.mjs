// Recupera mensagens do WhatsApp que chegaram ao Chatwoot enquanto a central
// estava fora do ar (o webhook do Chatwoot não tenta de novo). Lê as conversas
// da caixa do RH com atividade recente e processa, em ordem, as mensagens
// recebidas que a central ainda não viu.
//
// Só considera mensagens depois de `since` (início da recuperação), para nunca
// reprocessar o histórico antigo. A deduplicação é pelo id da mensagem no Chatwoot.

/**
 * @param {object} o
 * @param {number} o.inboxId           caixa do WhatsApp do RH
 * @param {number} o.since             unix (segundos): ignora o que veio antes
 * @param {(id:number)=>boolean} o.seen  a central já processou essa mensagem?
 * @param {(payload:object)=>Promise<void>} o.process  mesmo caminho do webhook
 * @param {(page:number)=>Promise<object[]>} o.listConversations  conversas da caixa, mais recentes primeiro
 * @param {(conversationId:number)=>Promise<object[]>} o.listMessages  últimas mensagens da conversa
 */
export async function recoverMissed({ inboxId, since, seen, process, listConversations, listMessages, log = () => {} }) {
  let recovered = 0;
  const conversations = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await listConversations(page);
    if (!batch.length) break;
    const recent = batch.filter((c) => Number(c.last_activity_at || c.timestamp || 0) >= since);
    conversations.push(...recent);
    if (recent.length < batch.length) break;
  }
  for (const conversation of conversations) {
    if (Number(conversation.inbox_id) !== Number(inboxId)) continue;
    const messages = (await listMessages(conversation.id))
      .filter(
        (m) =>
          (m.message_type === 0 || m.message_type === "incoming") &&
          !m.private &&
          Number(m.created_at) >= since &&
          !seen(m.id),
      )
      .sort((a, b) => a.id - b.id);
    for (const m of messages) {
      log(`[recuperação] conversa ${conversation.id}: mensagem ${m.id} recebida com a central fora do ar`);
      await process({
        event: "message_created",
        id: m.id,
        message_type: "incoming",
        private: false,
        content: m.content || "",
        attachments: m.attachments || [],
        created_at: m.created_at,
        sender: m.sender || conversation.meta?.sender,
        inbox: { id: inboxId },
        conversation: { id: conversation.id, status: conversation.status, inbox_id: inboxId, meta: conversation.meta },
        recovered: true,
      });
      recovered++;
    }
  }
  return recovered;
}
