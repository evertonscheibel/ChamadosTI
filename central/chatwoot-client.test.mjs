import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";

process.env.CHATWOOT_BASE_URL = "https://chatwoot.test";
process.env.CHATWOOT_ACCOUNT_ID = "1";
process.env.CHATWOOT_BOT_TOKEN = "bot-token";
process.env.CHATWOOT_BOT_SECRET = "shh";

const { verifySignature, sendMessage } = await import("./chatwoot-client.mjs");

function sign(secret, timestamp, body) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

test("verifySignature aceita uma assinatura válida e recente", () => {
  const body = '{"event":"message_created"}';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign("shh", timestamp, body);
  assert.equal(verifySignature(body, timestamp, signature), true);
});

test("verifySignature rejeita assinatura incorreta", () => {
  const body = '{"event":"message_created"}';
  const timestamp = String(Math.floor(Date.now() / 1000));
  assert.equal(
    verifySignature(body, timestamp, "sha256=0000000000000000"),
    false,
  );
});

test("verifySignature rejeita corpo alterado (assinatura não bate mais)", () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign("shh", timestamp, '{"event":"message_created"}');
  assert.equal(
    verifySignature('{"event":"outra coisa"}', timestamp, signature),
    false,
  );
});

test("verifySignature rejeita timestamp fora da janela de 5 minutos (replay)", () => {
  const body = '{"event":"message_created"}';
  const old = String(Math.floor(Date.now() / 1000) - 600);
  const signature = sign("shh", old, body);
  assert.equal(verifySignature(body, old, signature), false);
});

test("verifySignature rejeita quando timestamp ou assinatura estão ausentes", () => {
  assert.equal(verifySignature("{}", null, "sha256=abc"), false);
  assert.equal(verifySignature("{}", "123", null), false);
});

test("sendMessage posta na conversa certa com o token do bot", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, json: async () => ({ id: 42 }) };
  };
  try {
    const result = await sendMessage(99, "Olá, colaborador!");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://chatwoot.test/api/v1/accounts/1/conversations/99/messages",
    );
    assert.equal(calls[0].options.headers.api_access_token, "bot-token");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      content: "Olá, colaborador!",
      message_type: "outgoing",
    });
    assert.deepEqual(result, { id: 42 });
  } finally {
    global.fetch = originalFetch;
  }
});

test("sendMessage lança erro quando o Chatwoot recusa a mensagem", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 422 });
  try {
    await assert.rejects(() => sendMessage(1, "oi"), /recusou/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("handOffTicket deixa nota interna, soma a etiqueta e devolve a conversa para humano", async () => {
  const { handOffTicket } = await import("./chatwoot-client.mjs");
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body && JSON.parse(options.body) });
    const payload = String(url).endsWith("/labels") && options.method === "GET" ? { payload: ["rh"] } : {};
    return { ok: true, json: async () => payload };
  };
  try {
    await handOffTicket(7, { protocol: "FRZ-2026-000042", subject: "Dúvida", description: "Quero saber X" });
    const base = "https://chatwoot.test/api/v1/accounts/1/conversations/7";
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace(base, "")}`), [
      "POST /messages",
      "GET /labels",
      "POST /labels",
      "POST /toggle_status",
    ]);
    assert.equal(calls[0].body.private, true);
    assert.match(calls[0].body.content, /FRZ-2026-000042/);
    assert.deepEqual(calls[2].body.labels, ["rh", "chamado_aberto"]);
    assert.deepEqual(calls[3].body, { status: "open" });
  } finally {
    global.fetch = originalFetch;
  }
});
