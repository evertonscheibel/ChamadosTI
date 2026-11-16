// Homologação do WhatsApp RH de ponta a ponta, sem celular: simula um colaborador
// escrevendo na caixa "WhatsApp RH" do Chatwoot (mensagens "incoming" pela API) e o RH
// respondendo pela central (conta de demonstração), e confere cada etapa nos dois lados.
//
// Uso (na homologação): node scripts/homologacao-whatsapp.mjs
//   CENTRAL_URL (padrão http://127.0.0.1:45873) e o Chatwoot/token do .env.local.
// O telefone é fictício (DDD 00) e contém o trecho de teste, então passa pelo atendente
// virtual mas nenhuma mensagem chega a um WhatsApp de verdade.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const env = { ...parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8")), ...process.env };
const CENTRAL = (env.CENTRAL_TEST_URL || "http://127.0.0.1:45873").replace(/\/+$/, "");
const CW = `${env.CHATWOOT_BASE_URL.replace(/\/+$/, "")}/api/v1/accounts/${env.CHATWOOT_ACCOUNT_ID}`;
const INBOX = Number(env.WHATSAPP_RH_INBOX_ID || 12);
const TRECHO = (env.WHATSAPP_RH_TELEFONES_TESTE || "98969836").split(",")[0].trim();
const RH = { identifier: env.HOMOLOG_RH_CPF || "00000000272", password: env.HOMOLOG_RH_SENHA || "FrizeloDemo!2026" };

const results = [];
let current = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = "") {
  results.push({ scenario: current, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "  ok  " : "  FALHA"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  return Boolean(ok);
}
async function waitFor(fn, timeout = 25000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(700);
  }
  return last;
}

// --- Chatwoot ---------------------------------------------------------------------
async function cw(path, method = "GET", body) {
  const r = await fetch(`${CW}${path}`, {
    method,
    headers: { api_access_token: env.CHATWOOT_API_TOKEN, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Chatwoot ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json().catch(() => null);
}
async function newConversation(label) {
  const phone = `+5500${TRECHO}${String(Math.floor(Math.random() * 90) + 10)}`;
  const c = await cw("/contacts", "POST", { inbox_id: INBOX, name: `Homologação ${label}`, phone_number: phone });
  const contact = c.payload.contact;
  const sourceId = c.payload.contact_inbox?.source_id || contact.contact_inboxes?.[0]?.source_id;
  const conv = await cw("/conversations", "POST", { inbox_id: INBOX, contact_id: contact.id, source_id: sourceId });
  return { id: conv.id, contactId: contact.id, phone, seen: new Set() };
}
const messages = async (conv) => (await cw(`/conversations/${conv.id}/messages`)).payload;
const conversation = (conv) => cw(`/conversations/${conv.id}`);
/** Colaborador escreve; devolve as respostas públicas novas do bot (espera até a 1ª). */
async function say(conv, content, { expect = true } = {}) {
  for (const m of await messages(conv)) conv.seen.add(m.id);
  await cw(`/conversations/${conv.id}/messages`, "POST", { content, message_type: "incoming" });
  if (!expect) return [];
  return newReplies(conv);
}
async function newReplies(conv, timeout) {
  const got = await waitFor(async () => {
    const fresh = (await messages(conv)).filter((m) => !conv.seen.has(m.id) && m.message_type === 1 && !m.private);
    return fresh.length ? fresh : null;
  }, timeout);
  await sleep(1200); // respostas em mais de uma mensagem
  const fresh = (await messages(conv)).filter((m) => !conv.seen.has(m.id) && m.message_type === 1 && !m.private);
  for (const m of fresh) conv.seen.add(m.id);
  return got ? fresh.map((m) => m.content || "") : [];
}

// --- Central (RH) ------------------------------------------------------------------
let cookie = "";
async function central(path, method = "GET", body) {
  const r = await fetch(`${CENTRAL}${path}`, {
    method,
    headers: { Cookie: cookie, Origin: CENTRAL, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie").split(";")[0];
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Central ${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
const requestOf = async (conv) =>
  (await central("/api/requests")).requests.find((r) => String(r.chatwoot_conversation_id) === String(conv.id));

// --- Cenários ----------------------------------------------------------------------
async function chamadoCompleto() {
  current = "Chamado do início ao fim";
  console.log(`\n${current}`);
  const conv = await newConversation("chamado");
  let r = await say(conv, "oi");
  check("primeiro contato recebe o menu", r.some((t) => t.includes("Responda com o **número**")), r.join(" | "));
  r = await say(conv, "batata");
  check("opção inválida pede o número", r.some((t) => t.includes("Não entendi")), r.join(" | "));
  r = await say(conv, "3");
  check("opção 3 pede os dados de ponto", r.some((t) => t.includes("Ponto: ajustes e dúvidas")), r.join(" | "));
  r = await say(conv, "oi");
  check("cumprimento solto não abre chamado", r.some((t) => t.includes("Para eu registrar")), r.join(" | "));
  r = await say(conv, "Teste Homologação, setor TI. Dia 10/11, entrada às 07:02 não registrou.");
  const protocol = r.join(" ").match(/FRZ-\d{4}-\d{6}/)?.[0];
  check("chamado aberto com protocolo e prazo", protocol && r.some((t) => t.includes("vai te responder")), r.join(" | "));
  const request = await waitFor(() => requestOf(conv));
  check("chamado aparece na central para o RH", request?.protocol === protocol, JSON.stringify(request?.protocol));
  if (!request) return;
  check("chamado com prazo e status Recebida", request.due_at && request.status === "Recebida", `${request.status} ${request.due_at}`);

  const attrsOk = await waitFor(async () => {
    const c = await conversation(conv);
    return c.custom_attributes?.chamado === protocol && c.priority === "low" ? c : null;
  });
  check("Chatwoot mostra o chamado e prioridade baixa", attrsOk, "atributos/prioridade não chegaram");

  r = await say(conv, "Complemento: foi na portaria 2.", { expect: false });
  const appended = await waitFor(async () => {
    const d = await central(`/api/requests/${request.id}`);
    return d.messages.some((m) => m.body.includes("portaria 2")) ? d : null;
  });
  check("complemento entra no chamado", appended);

  await central(`/api/requests/${request.id}/messages`, "POST", { body: "Olá! Recebemos e já estamos verificando. (homologação)" });
  r = await newReplies(conv);
  check("resposta do RH na central chega ao WhatsApp", r.some((t) => t.includes("já estamos verificando")), r.join(" | "));

  await cw(`/conversations/${conv.id}/messages`, "POST", { content: "Resposta da atendente pelo Chatwoot (homologação).", message_type: "outgoing" });
  const mirrored = await waitFor(async () => {
    const d = await central(`/api/requests/${request.id}`);
    return d.messages.some((m) => m.body.includes("pelo Chatwoot (homologação)")) ? d : null;
  });
  check("resposta dada no Chatwoot aparece no chamado", mirrored);

  r = await say(conv, "status");
  check("'status' mostra o chamado", r.some((t) => t.includes(protocol)), r.join(" | "));

  await central(`/api/requests/${request.id}`, "PATCH", { status: "Aguardando colaborador" });
  r = await newReplies(conv);
  check("pedido de informação avisa o colaborador", r.some((t) => t.includes("precisa de uma informação")), r.join(" | "));
  const awaitingAttr = await waitFor(async () => {
    const c = await conversation(conv);
    return c.custom_attributes?.chamado_status === "Aguardando colaborador" ? c : null;
  });
  check("Chatwoot mostra 'Aguardando colaborador'", awaitingAttr);

  await say(conv, "A batida certa era 07:02, segue.", { expect: false });
  const back = await waitFor(async () => ((await requestOf(conv))?.status === "Em atendimento" ? true : null));
  check("resposta do colaborador volta o chamado para 'Em atendimento'", back);

  await central(`/api/requests/${request.id}`, "PATCH", { status: "Concluída" });
  r = await newReplies(conv);
  check("conclusão avisa e pede nota", r.some((t) => t.includes("foi atendido") && t.includes("nota")), r.join(" | "));
  const closed = await waitFor(async () => {
    const c = await conversation(conv);
    return c.custom_attributes?.chamado_status === "Concluída" && !c.priority ? c : null;
  });
  check("Chatwoot: chamado concluído e sem prioridade", closed);
  r = await say(conv, "5");
  check("nota 5 recebe agradecimento", r.some((t) => t.includes("Obrigado pela avaliação")), r.join(" | "));
  const rated = await waitFor(async () => ((await central(`/api/requests/${request.id}`)).request?.rating === 5 ? true : null));
  check("nota gravada no chamado", rated);
  const resolved = await waitFor(async () => ((await conversation(conv)).status === "resolved" ? true : null));
  check("conversa resolvida no Chatwoot", resolved);
}

async function pedirAtendente() {
  current = "Pedido de atendente";
  console.log(`
${current}`);
  const conv = await newConversation("atendente");
  await say(conv, "oi");
  let r = await say(conv, "quero falar com um atendente");
  check("'atendente' pede o assunto (outros assuntos)", r.some((t) => t.includes("Outros assuntos")), r.join(" | "));
  r = await say(conv, "Teste Homologação, setor TI. Dúvida sobre o crachá novo.");
  const protocol = r.join(" ").match(/FRZ-\d{4}-\d{6}/)?.[0];
  check("vira chamado para o RH", protocol, r.join(" | "));
  const request = await waitFor(() => requestOf(conv));
  if (request) {
    await central(`/api/requests/${request.id}/messages`, "POST", { body: "Resolvido na homologação." });
    await central(`/api/requests/${request.id}`, "PATCH", { status: "Concluída" });
  }
  await cw(`/conversations/${conv.id}/toggle_status`, "POST", { status: "resolved" });
}

async function statusSemChamado() {
  current = "Status sem chamado";
  console.log(`\n${current}`);
  const conv = await newConversation("status");
  const r = await say(conv, "status");
  check("'status' sem chamados explica e oferece o menu", r.some((t) => t.includes("não tem chamados")), r.join(" | "));
  await cw(`/conversations/${conv.id}/toggle_status`, "POST", { status: "resolved" });
}

async function telefoneForaDoTeste() {
  current = "Telefone fora do modo teste";
  console.log(`\n${current}`);
  if (TRECHO === "todos") return check("modo teste desligado (todos)", true);
  const phone = `+5500${String(Date.now()).slice(-9)}`;
  const c = await cw("/contacts", "POST", { inbox_id: INBOX, name: "Homologação fora do teste", phone_number: phone });
  const conv = await cw("/conversations", "POST", { inbox_id: INBOX, contact_id: c.payload.contact.id, source_id: c.payload.contact_inbox?.source_id });
  const target = { id: conv.id, seen: new Set() };
  await say(target, "oi", { expect: false });
  const r = await newReplies(target, 8000);
  check("bot não responde número fora do teste", r.length === 0, r.join(" | "));
  await cw(`/conversations/${conv.id}/toggle_status`, "POST", { status: "resolved" });
}

// --- Execução ----------------------------------------------------------------------
const started = Date.now();
await central("/api/login", "POST", RH);
console.log(`Central ${CENTRAL} · Chatwoot ${CW} · caixa ${INBOX}`);
for (const scenario of [chamadoCompleto, pedirAtendente, statusSemChamado, telefoneForaDoTeste]) {
  try {
    await scenario();
  } catch (e) {
    check("cenário terminou sem erro", false, e.message);
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações ok em ${Math.round((Date.now() - started) / 1000)} s`);
process.exitCode = failed.length ? 1 : 0;
