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
  // DDD 00 + trecho de teste + 3 dígitos (15 no total, o máximo do padrão); sorteia de novo se já existir.
  let phone, c;
  for (let attempt = 0; !c; attempt++) {
    phone = `+5500${TRECHO}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    try {
      c = await cw("/contacts", "POST", { inbox_id: INBOX, name: `Homologação ${label}`, phone_number: phone });
    } catch (e) {
      if (attempt >= 5 || !/already been taken/.test(e.message)) throw e;
    }
  }
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

/** Abre um chamado de teste e devolve { conv, request, protocol }. */
async function openTicket(label) {
  const conv = await newConversation(label);
  await say(conv, "oi");
  await say(conv, "3");
  const r = await say(conv, `Teste Homologação (${label}), setor TI. Dia 10/11 sem batida.`);
  const protocol = r.join(" ").match(/FRZ-\d{4}-\d{6}/)?.[0];
  const request = await waitFor(() => requestOf(conv));
  return { conv, request, protocol };
}
const quiet = async (conv, ms = 6000) => (await newReplies(conv, ms)).length === 0;

async function okSemRepetir() {
  current = "'ok/obrigado' com chamado aberto";
  console.log(`\n${current}`);
  const { conv, request, protocol } = await openTicket("ok");
  let r = await say(conv, "ok");
  check("'ok' recebe confirmação curta", r.length === 1 && r[0].includes("Combinado") && r[0].includes(protocol), r.join(" | "));
  await say(conv, "obrigado!", { expect: false });
  check("'obrigado' logo depois não repete nada", await quiet(conv));
  const d = await central(`/api/requests/${request.id}`);
  check("'ok/obrigado' não entram no chamado", !d.messages.some((m) => /^(ok|obrigado!)$/.test(m.body)));
  r = await say(conv, "ok, mas esqueci: foi na portaria 2", { expect: false });
  const appended = await waitFor(async () =>
    (await central(`/api/requests/${request.id}`)).messages.some((m) => m.body.includes("portaria 2")) ? true : null,
  );
  check("frase com conteúdo entra no chamado", appended);
  await central(`/api/requests/${request.id}/messages`, "POST", { body: "Resolvido na homologação." });
  await central(`/api/requests/${request.id}`, "PATCH", { status: "Concluída" });
  await newReplies(conv);
  r = await say(conv, "obrigada");
  check("'obrigada' na hora da nota é despedida, sem menu", r.some((t) => t.includes("Por nada")) && !r.some((t) => t.includes("Responda com o **número**")), r.join(" | "));
  const resolved = await waitFor(async () => ((await conversation(conv)).status === "resolved" ? true : null));
  check("conversa continua resolvida", resolved);
}

async function cancelarPeloColaborador() {
  current = "Colaborador cancela o chamado";
  console.log(`\n${current}`);
  const { conv, request, protocol } = await openTicket("cancelar");
  let r = await say(conv, "cancelar");
  check("'cancelar' pede confirmação", r.some((t) => t.includes("Quer **cancelar**") && t.includes(protocol)), r.join(" | "));
  r = await say(conv, "não");
  check("'não' mantém o chamado", r.some((t) => t.includes("continua aberto")), r.join(" | "));
  check("chamado segue aberto", (await requestOf(conv))?.status !== "Concluída");
  await say(conv, "encerrar chamado");
  r = await say(conv, "sim");
  check("'sim' cancela e avisa", r.some((t) => t.includes("cancelado")), r.join(" | "));
  const done = await waitFor(async () => {
    const d = await central(`/api/requests/${request.id}`);
    return d.request?.status === "Concluída" && d.history.some((h) => h.event?.includes("cancelado pelo colaborador")) ? true : null;
  });
  check("chamado concluído como cancelado na central", done);
  const note = await waitFor(async () =>
    (await messages(conv)).some((m) => m.private && m.content?.includes("cancelou o chamado")) ? true : null,
  );
  check("RH recebe nota interna no Chatwoot", note);
  const resolved = await waitFor(async () => {
    const c = await conversation(conv);
    return c.status === "resolved" && c.custom_attributes?.chamado_status === "Concluída" && !c.priority ? true : null;
  });
  check("conversa resolvida, chamado concluído e sem prioridade no Chatwoot", resolved);
}

async function notaPeloChatwoot() {
  current = "Atendente resolve pelo Chatwoot";
  console.log(`\n${current}`);
  const { conv, request } = await openTicket("chatwoot");
  await cw(`/conversations/${conv.id}/messages`, "POST", { content: "Pronto, ajustei seu ponto (homologação).", message_type: "outgoing" });
  await newReplies(conv);
  await cw(`/conversations/${conv.id}/toggle_status`, "POST", { status: "resolved" });
  const r = await newReplies(conv);
  check("colaborador recebe 'atendido' com pedido de nota", r.some((t) => t.includes("foi atendido") && t.includes("nota")), r.join(" | "));
  const concluded = await waitFor(async () => ((await requestOf(conv))?.status === "Concluída" ? true : null));
  check("chamado concluído na central", concluded);
  await say(conv, "4");
  const rated = await waitFor(async () => ((await central(`/api/requests/${request.id}`)).request?.rating === 4 ? true : null));
  check("nota gravada", rated);
  const resolved = await waitFor(async () => ((await conversation(conv)).status === "resolved" ? true : null));
  check("conversa volta a resolvida depois da nota", resolved);
}

async function variosChamados() {
  current = "Vários chamados na mesma conversa";
  console.log(`\n${current}`);
  const { conv, request: a, protocol: pa } = await openTicket("varios");
  const more = [];
  for (const [option, text] of [["4", "Atestado de 2 dias (homologação)."], ["8", "Quero marcar férias (homologação)."]]) {
    await say(conv, "menu");
    await say(conv, option);
    const r = await say(conv, `Teste Homologação, setor TI. ${text}`);
    more.push(r.join(" ").match(/FRZ-\d{4}-\d{6}/)?.[0]);
  }
  check("três chamados abertos na conversa", pa && more.every(Boolean), [pa, ...more].join(", "));
  const all = (await central("/api/requests")).requests.filter((r) => String(r.chatwoot_conversation_id) === String(conv.id));

  await central(`/api/requests/${a.id}/messages`, "POST", { body: "Resolvido o primeiro (homologação)." });
  await newReplies(conv);
  await central(`/api/requests/${a.id}`, "PATCH", { status: "Concluída" });
  const r1 = await newReplies(conv);
  await sleep(4000);
  const extra = await newReplies(conv, 3000);
  check("concluir um chamado avisa só dele", r1.length === 1 && r1[0].includes(pa) && extra.length === 0, [...r1, ...extra].join(" | "));
  const still = (await central("/api/requests")).requests.filter((r) => String(r.chatwoot_conversation_id) === String(conv.id) && r.status !== "Concluída");
  check("os outros dois continuam abertos", still.length === 2, still.map((r) => r.protocol).join(", "));
  check("conversa não é resolvida com chamado aberto", (await conversation(conv)).status !== "resolved");

  await cw(`/conversations/${conv.id}/toggle_status`, "POST", { status: "resolved" });
  const r2 = await newReplies(conv);
  await sleep(4000);
  const extra2 = await newReplies(conv, 3000);
  check(
    "atendente resolve: uma mensagem só com os dois chamados e a nota",
    r2.length === 1 && more.every((p) => r2[0].includes(p)) && r2[0].includes("nota") && extra2.length === 0,
    [...r2, ...extra2].join(" | "),
  );
  await say(conv, "5");
  const last = all.find((r) => r.protocol === more[1]);
  const rated = await waitFor(async () => ((await central(`/api/requests/${last.id}`)).request?.rating === 5 ? true : null));
  check("nota vai para o último chamado", rated);
  const resolved = await waitFor(async () => ((await conversation(conv)).status === "resolved" ? true : null));
  check("conversa resolvida no fim", resolved);
}

/** Colaborador manda um áudio (ogg/opus, como o WhatsApp). Arquivo em HOMOLOG_AUDIO. */
async function sayAudio(conv) {
  for (const m of await messages(conv)) conv.seen.add(m.id);
  const form = new FormData();
  form.append("message_type", "incoming");
  form.append("attachments[]", new Blob([readFileSync(env.HOMOLOG_AUDIO)], { type: "audio/ogg" }), "audio.ogg");
  const r = await fetch(`${CW}/conversations/${conv.id}/messages`, {
    method: "POST",
    headers: { api_access_token: env.CHATWOOT_API_TOKEN },
    body: form,
  });
  if (!r.ok) throw new Error(`Chatwoot áudio: ${r.status} ${await r.text()}`);
  return newReplies(conv);
}

async function audioDoColaborador() {
  current = "Áudio do colaborador";
  console.log(`\n${current}`);
  if (!env.HOMOLOG_AUDIO) return check("arquivo de áudio de teste (HOMOLOG_AUDIO)", false, "defina HOMOLOG_AUDIO");
  const conv = await newConversation("audio");
  let r = await sayAudio(conv);
  const protocol = r.join(" ").match(/FRZ-\d{4}-\d{6}/)?.[0];
  check("áudio logo de cara abre chamado", protocol && r.some((t) => t.includes("Outros assuntos")), r.join(" | "));
  const request = await waitFor(() => requestOf(conv));
  const detail = request && (await central(`/api/requests/${request.id}`));
  const audio = detail?.attachments.find((a) => a.type?.startsWith("audio/"));
  check("o áudio está anexado ao chamado na central", audio, JSON.stringify(detail?.attachments?.map((a) => a.type)));
  if (audio) {
    const res = await fetch(`${CENTRAL}/api/attachments/${audio.id}?inline=1`, { headers: { Cookie: cookie } });
    const bytes = (await res.arrayBuffer()).byteLength;
    check(
      "a central entrega o áudio para tocar no navegador",
      res.ok && res.headers.get("content-type")?.startsWith("audio/") && /inline/.test(res.headers.get("content-disposition") || "") && bytes > 1000,
      `${res.status} ${res.headers.get("content-type")} ${bytes} bytes`,
    );
  }
  r = await sayAudio(conv);
  const appended = await waitFor(async () =>
    (await central(`/api/requests/${request.id}`)).attachments.filter((a) => a.type?.startsWith("audio/")).length >= 2 ? true : null,
  );
  check("segundo áudio entra no mesmo chamado", appended);
  if (request) {
    await central(`/api/requests/${request.id}/messages`, "POST", { body: "Ouvido na homologação." });
    await central(`/api/requests/${request.id}`, "PATCH", { status: "Concluída" });
  }
  const conv2 = await newConversation("audio-cpf");
  await say(conv2, "oi");
  await say(conv2, "1");
  r = await sayAudio(conv2);
  check("áudio no pedido de CPF pede para digitar", r.some((t) => t.includes("digite") && t.includes("CPF")), r.join(" | "));
  await cw(`/conversations/${conv2.id}/toggle_status`, "POST", { status: "resolved" });
}

// --- Execução ----------------------------------------------------------------------
const started = Date.now();
await central("/api/login", "POST", RH);
console.log(`Central ${CENTRAL} · Chatwoot ${CW} · caixa ${INBOX}`);
const ALL = [chamadoCompleto, pedirAtendente, statusSemChamado, telefoneForaDoTeste, okSemRepetir, cancelarPeloColaborador, notaPeloChatwoot, variosChamados, audioDoColaborador];
const ONLY = (env.HOMOLOG_SO || "").split(",").filter(Boolean);
for (const scenario of ONLY.length ? ALL.filter((f) => ONLY.includes(f.name)) : ALL) {
  try {
    await scenario();
  } catch (e) {
    check("cenário terminou sem erro", false, e.message);
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações ok em ${Math.round((Date.now() - started) / 1000)} s`);
process.exitCode = failed.length ? 1 : 0;
