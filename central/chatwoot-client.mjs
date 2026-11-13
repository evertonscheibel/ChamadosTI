import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHmac, timingSafeEqual } from "node:crypto";

const error = (message, status = 502) =>
  Object.assign(new Error(message), { status });

export function configuration() {
  let local = {};
  try {
    local = parseEnv(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const settings = { ...local, ...process.env };
  return {
    enabled: Boolean(
      settings.CHATWOOT_BASE_URL &&
        settings.CHATWOOT_ACCOUNT_ID &&
        settings.CHATWOOT_BOT_TOKEN,
    ),
    base: settings.CHATWOOT_BASE_URL,
    accountId: settings.CHATWOOT_ACCOUNT_ID,
    botToken: settings.CHATWOOT_BOT_TOKEN,
    secret: settings.CHATWOOT_BOT_SECRET,
    // Token de um usuário do Chatwoot (Perfil > Token de acesso). O token do bot
    // não pode ler conversas; este é usado só para recuperar mensagens perdidas.
    apiToken: settings.CHATWOOT_API_TOKEN,
  };
}

/** Leitura com o token de usuário (recuperação de mensagens). */
async function readApi(path) {
  const config = configuration();
  if (!config.enabled || !config.apiToken) throw error("Leitura do Chatwoot não configurada (CHATWOOT_API_TOKEN).", 503);
  const response = await fetch(`${config.base.replace(/\/+$/, "")}/api/v1/accounts/${config.accountId}${path}`, {
    headers: { api_access_token: config.apiToken, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw error(`Chatwoot recusou a leitura (${response.status}).`, 502);
  return response.json();
}
/** Conversas da caixa, da atividade mais recente para a mais antiga. */
export async function listInboxConversations(inboxId, page = 1) {
  const result = await readApi(`/conversations?inbox_id=${Number(inboxId)}&status=all&sort_by=last_activity_at_desc&page=${Number(page)}`);
  return result.data?.payload || [];
}
/** Últimas mensagens de uma conversa (o Chatwoot devolve as mais recentes). */
export async function listConversationMessages(conversationId) {
  const result = await readApi(`/conversations/${Number(conversationId)}/messages`);
  return result.payload || [];
}

/**
 * Valida a assinatura HMAC que o Chatwoot envia (X-Chatwoot-Signature,
 * X-Chatwoot-Timestamp) para o webhook de Agent Bot. rawBody precisa ser o
 * texto exato recebido, antes de qualquer JSON.parse — a assinatura é
 * calculada em cima dos bytes originais.
 */
export function verifySignature(rawBody, timestamp, signatureHeader) {
  const config = configuration();
  if (!config.secret) return true; // sem segredo configurado: aceita (ambiente de teste)
  if (!timestamp || !signatureHeader) return false;
  // janela de 5 minutos contra replay
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = `sha256=${createHmac("sha256", config.secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function conversationApi(conversationId, path, method, body) {
  const config = configuration();
  if (!config.enabled) throw error("Integração Chatwoot não configurada.", 503);
  const endpoint = new URL(
    `${config.base.replace(/\/+$/, "")}/api/v1/accounts/${config.accountId}/conversations/${conversationId}${path}`,
  );
  let response;
  try {
    response = await fetch(endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        api_access_token: config.botToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw error("Não foi possível falar com o Chatwoot agora.", 503);
  }
  if (!response.ok)
    throw error(`O Chatwoot recusou a mensagem (${response.status}).`, 502);
  return response.json();
}

/** Posta uma mensagem de saída (outgoing) numa conversa do Chatwoot, como o Agent Bot. */
export function sendMessage(conversationId, content) {
  return conversationApi(conversationId, "/messages", "POST", {
    content,
    message_type: "outgoing",
  });
}

/**
 * Chamado aberto pelo bot: nota interna para a equipe, etiqueta
 * "chamado_aberto" (somada às que já existirem) e a conversa volta a
 * "open", o que tira do bot e entra no rodízio das atendentes.
 */
export async function handOffTicket(conversationId, ticket) {
  await conversationApi(conversationId, "/messages", "POST", {
    content: `Chamado ${ticket.protocol} aberto pelo assistente.\nAssunto: ${ticket.subject}\n\n${ticket.description}`,
    message_type: "outgoing",
    private: true,
  });
  const current = await conversationApi(conversationId, "/labels", "GET");
  const labels = [...new Set([...(current.payload || []), "chamado_aberto"])];
  await conversationApi(conversationId, "/labels", "POST", { labels });
  await handToHuman(conversationId);
}

/** Tira a conversa do bot ("open"), o que a coloca no rodízio das atendentes. */
export function handToHuman(conversationId) {
  return conversationApi(conversationId, "/toggle_status", "POST", {
    status: "open",
  });
}

/** Resolve a conversa (a próxima mensagem do contato abre uma conversa nova no WAHA). */
export function resolveConversation(conversationId) {
  return conversationApi(conversationId, "/toggle_status", "POST", {
    status: "resolved",
  });
}

/** Mensagem de saída com anexos ({ name, type, content: Buffer }), via multipart. */
export async function sendMessageWithFiles(conversationId, content, files) {
  if (!files?.length) return sendMessage(conversationId, content);
  const config = configuration();
  if (!config.enabled) throw error("Integração Chatwoot não configurada.", 503);
  const form = new FormData();
  form.append("content", content);
  form.append("message_type", "outgoing");
  for (const f of files)
    form.append("attachments[]", new Blob([f.content], { type: f.type }), f.name);
  let response;
  try {
    response = await fetch(
      `${config.base.replace(/\/+$/, "")}/api/v1/accounts/${config.accountId}/conversations/${conversationId}/messages`,
      { method: "POST", headers: { api_access_token: config.botToken }, body: form, signal: AbortSignal.timeout(60000) },
    );
  } catch {
    throw error("Não foi possível falar com o Chatwoot agora.", 503);
  }
  if (!response.ok) throw error(`O Chatwoot recusou a mensagem (${response.status}).`, 502);
  return response.json();
}

/**
 * Baixa um anexo recebido. Só o caminho do data_url é usado, sempre contra o
 * endereço configurado do Chatwoot (nunca um host vindo do payload).
 */
export async function downloadAttachment(dataUrl, maxBytes = 5 * 1024 * 1024) {
  const config = configuration();
  if (!config.enabled) throw error("Integração Chatwoot não configurada.", 503);
  const source = new URL(dataUrl);
  const target = new URL(source.pathname + source.search, config.base);
  const response = await fetch(target, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw error(`Anexo indisponível (${response.status}).`, 502);
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length > maxBytes) throw error("Anexo acima do limite.", 413);
  return { type: (response.headers.get("content-type") || "").split(";")[0].trim(), content };
}
