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
  };
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

/** Posta uma mensagem de saída (outgoing) numa conversa do Chatwoot, como o Agent Bot. */
export async function sendMessage(conversationId, content) {
  const config = configuration();
  if (!config.enabled) throw error("Integração Chatwoot não configurada.", 503);
  const endpoint = new URL(
    `${config.base.replace(/\/+$/, "")}/api/v1/accounts/${config.accountId}/conversations/${conversationId}/messages`,
  );
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_access_token: config.botToken,
      },
      body: JSON.stringify({ content, message_type: "outgoing" }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw error("Não foi possível falar com o Chatwoot agora.", 503);
  }
  if (!response.ok)
    throw error(`O Chatwoot recusou a mensagem (${response.status}).`, 502);
  return response.json();
}
