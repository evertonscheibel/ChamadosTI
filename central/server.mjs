import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { db, verifyPassword, hashPassword } from "./database.mjs";
import { services, statuses } from "./catalog.mjs";
import { configuration, links, consult } from "./senior.mjs";
import { extraction, startExtraction, csv } from "./senior-export.mjs";
import { synchronization, startSynchronization } from "./senior-import.mjs";
import { managementCsv } from "./management-export.mjs";
import { managementReport } from "./indicators.mjs";
import { initializeLinks, registerLink } from "./integration-links.mjs";
import {
  reply as hermesReply,
  systemPrompt,
  realSystemPrompt,
} from "./hermes-chat.mjs";
import { contextFor } from "./knowledge.mjs";
import { syncAll } from "./knowledge-sync.mjs";
import { recordAnswer, metricsSummary } from "./ai-metrics.mjs";
import { classify as classifyChat } from "./chatbot-router.mjs";
import {
  welcomeMessage,
  identityPrompt,
  identityDeclinedMessage,
  exampleFor,
} from "./chatbot-templates.mjs";
import {
  lookupCandidate,
  buildChallenge,
  looksUnknown,
} from "./senior-identity.mjs";
import { realReply, parseMonth } from "./senior-reply.mjs";
import { normalizedCpf } from "./identity.mjs";
import {
  logConversationMessage,
  listConversations,
  conversationMessages,
} from "./conversation-log.mjs";
import {
  vacancyStatus,
  vacancyApplications,
  createVacancy,
  setVacancyPublication,
} from "./ats-integration.mjs";
import {
  portalVacancies,
  portalVacancyById,
  decidePortalVacancy,
} from "./portal-integration.mjs";
import {
  verifySignature,
  sendMessage as sendChatwootMessage,
  handOffTicket,
  handToHuman,
} from "./chatwoot-client.mjs";

initializeLinks(db);

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.CENTRAL_PORT || 45873);
const origin = `http://127.0.0.1:${port}`;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const failures = new Map();
const seniorInFlight = new Set();
const chatSessions = new Map();
const chatLimits = new Map();
function chatSession(id) {
  const now = Date.now();
  for (const [key, value] of chatSessions)
    if (now - value.updated > 2 * 3600000) chatSessions.delete(key);
  let session = chatSessions.get(id);
  if (!session) {
    session = {
      messages: [],
      tickets: [],
      identified: false,
      pendingTopic: null,
      aiActive: false,
      updated: now,
    };
    chatSessions.set(id, session);
  }
  session.updated = now;
  return session;
}
function chatAllowed(key) {
  const now = Date.now();
  const limit = chatLimits.get(key);
  const active = limit && limit.resetAt > now;
  if (active && limit.count >= 20) return false;
  chatLimits.set(key, {
    count: active ? limit.count + 1 : 1,
    resetAt: active ? limit.resetAt : now + 60000,
  });
  return true;
}
// =============================================================================
// Atendimento real (dado real da Senior, após verificação de identidade)
// =============================================================================
const attendanceSessions = new Map();
function attendanceSession(id) {
  const now = Date.now();
  for (const [key, value] of attendanceSessions)
    if (now - value.updated > 2 * 3600000) attendanceSessions.delete(key);
  let session = attendanceSessions.get(id);
  if (!session) {
    session = {
      stage: "collect_cpf", // collect_cpf -> collect_matricula -> challenge -> verified | blocked
      cpf: null,
      matricula: null,
      candidate: null,
      challenge: [],
      attempts: 0,
      lookupFails: 0,
      awaitingMonthFor: null,
      month: null,
      messages: [],
      tickets: [],
      aiActive: false,
      updated: now,
    };
    attendanceSessions.set(id, session);
  }
  session.updated = now;
  return session;
}
/** Acrescenta trechos de políticas internas relevantes à pergunta, se
 * algum documento local tiver termos em comum com ela. Sem documentos ou
 * sem relevância, devolve o prompt original sem alteração. */
function withKnowledge(prompt, query) {
  const context = contextFor(query);
  return context ? `${prompt}\n\n${context}` : prompt;
}
function firstName(candidate) {
  return (candidate?.NOMFUN || "").trim().split(/\s+/)[0] || "";
}
async function startChallengeOrVerify(session) {
  const found = await lookupCandidate({
    cpf: session.cpf,
    matricula: session.matricula,
  });
  if (!found) {
    session.lookupFails++;
    if (session.lookupFails >= 3) {
      session.stage = "blocked";
      return "Não consegui confirmar esse cadastro depois de algumas tentativas. Procure o RH para continuar.";
    }
    session.stage = "collect_cpf";
    session.cpf = null;
    session.matricula = null;
    return "Não encontrei um cadastro ativo com esses dados. Vamos tentar de novo — qual é o seu CPF? (Se não souber, digite 'não sei'.)";
  }
  session.candidate = found;
  if (session.cpf && session.matricula) {
    session.stage = "verified";
    return `Identidade confirmada, ${firstName(found)}! Posso consultar seu holerite, espelho de ponto, férias ou benefícios de verdade, ou você pode me contar uma dúvida.`;
  }
  session.challenge = buildChallenge(found, {
    cpfKnown: Boolean(session.cpf),
    matriculaKnown: Boolean(session.matricula),
  });
  session.attempts = 0;
  if (!session.challenge.length) {
    // nenhuma pergunta extra disponível neste cadastro: segue com o que já foi confirmado
    session.stage = "verified";
    return `Identidade confirmada, ${firstName(found)}! Posso consultar seu holerite, espelho de ponto, férias ou benefícios de verdade, ou você pode me contar uma dúvida.`;
  }
  session.stage = "challenge";
  return `Preciso confirmar mais um detalhe do seu cadastro. ${session.challenge[0].prompt}`;
}
function monthChoices() {
  const now = new Date();
  const choices = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    choices.push(
      `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
    );
  }
  return choices;
}
function attendanceOptions(session) {
  if (session.stage === "collect_cpf" || session.stage === "collect_matricula")
    return { kind: "unknown" };
  if (session.stage === "verified") {
    if (session.awaitingMonthFor)
      return { kind: "month", choices: monthChoices() };
    return { kind: "topics" };
  }
  return null;
}
async function handleAttendanceMessage(session, message) {
  // "blocked" é definitivo para a sessão: checar isso ANTES do atalho de
  // reinício evita que "reiniciar" vire um jeito de reaproveitar as
  // tentativas do desafio de identidade indefinidamente (zerava
  // session.attempts a cada chamada, sem tocar em lookupFails).
  if (session.stage === "blocked")
    return "Esta sessão não pôde confirmar sua identidade. Procure o RH para continuar — por telefone ou presencialmente.";
  if (/^(reiniciar|recome[çc]ar|menu)$/i.test(message.trim())) {
    session.stage = "collect_cpf";
    session.cpf = null;
    session.matricula = null;
    session.candidate = null;
    session.challenge = [];
    session.attempts = 0;
    session.awaitingMonthFor = null;
    return "Vamos recomeçar. Qual é o seu CPF? (Se não souber, digite 'não sei'.)";
  }
  if (session.stage === "collect_cpf") {
    if (looksUnknown(message)) {
      session.cpf = null;
    } else {
      const cpf = normalizedCpf(message);
      if (!cpf) return "Não entendi. Digite seu CPF (só números) ou 'não sei'.";
      session.cpf = cpf;
    }
    session.stage = "collect_matricula";
    return "Agora sua matrícula, se souber. (Pode digitar 'não sei'.)";
  }
  if (session.stage === "collect_matricula") {
    if (looksUnknown(message)) {
      session.matricula = null;
    } else {
      const digits = message.replace(/\D/g, "");
      if (!digits)
        return "Não entendi. Digite sua matrícula (só números) ou 'não sei'.";
      session.matricula = digits;
    }
    if (!session.cpf && !session.matricula) {
      session.stage = "blocked";
      return "Sem CPF nem matrícula não consigo confirmar sua identidade com segurança. Procure o RH para continuar — por telefone ou presencialmente.";
    }
    return startChallengeOrVerify(session);
  }
  if (session.stage === "challenge") {
    const current = session.challenge[0];
    if (current.check(message)) {
      session.challenge.shift();
      session.attempts = 0;
      if (!session.challenge.length) {
        session.stage = "verified";
        return `Identidade confirmada, ${firstName(session.candidate)}! Posso consultar seu holerite, espelho de ponto, férias ou benefícios de verdade, ou você pode me contar uma dúvida.`;
      }
      return session.challenge[0].prompt;
    }
    session.attempts++;
    if (session.attempts >= 2) {
      session.stage = "blocked";
      return "Não bateu com o nosso cadastro. Procure o RH para continuar — por telefone ou presencialmente.";
    }
    return `Não confere com o nosso cadastro. Tente de novo: ${current.prompt}`;
  }
  // stage === "verified"
  if (session.awaitingMonthFor) {
    const month = parseMonth(message);
    if (!month) return "Não entendi o mês. Pode informar assim: 09/2026.";
    session.month = month;
    const kind = session.awaitingMonthFor;
    session.awaitingMonthFor = null;
    return realReply(session.candidate, kind, month);
  }
  const category = session.aiActive ? "duvida" : await classifyChat(message);
  session.aiActive = false;
  if (["holerite", "ponto", "ferias", "beneficios"].includes(category)) {
    if (category !== "ferias" && !session.month) {
      session.awaitingMonthFor = category;
      return "Qual mês você quer consultar? (ex.: 09/2026)";
    }
    return realReply(session.candidate, category, session.month);
  }
  if (category === "saudacao")
    return `Olá, ${firstName(session.candidate)}! Posso consultar seu holerite, espelho de ponto, férias ou benefícios de verdade, ou me contar uma dúvida.`;
  // "duvida": única categoria que fala com a IA nesta sessão — o histórico só
  // acumula a partir daqui, nunca os passos de verificação de identidade.
  session.aiActive = true;
  session.messages.push({ role: "user", content: message });
  const ragHit = Boolean(contextFor(message));
  let outcome;
  try {
    outcome = await hermesReply(session.messages, {
      systemPrompt: withKnowledge(realSystemPrompt, message),
    });
  } catch (e) {
    session.messages.pop();
    session.aiActive = false;
    throw e;
  }
  session.messages.push({ role: "assistant", content: outcome.text });
  let ticketCreated = false;
  if (outcome.request && session.tickets.length < 10) {
    const subject = String(outcome.request.subject || "Dúvida de RH").slice(0, 160);
    const description = String(outcome.request.description || message).slice(0, 10000);
    let protocol;
    transaction(() => {
      const owner = colaboradorFromCandidate(session.candidate);
      const created = insertRequest(owner, "outros", subject, description, {});
      protocol = created.protocol;
      history(created.id, owner, "Solicitação aberta pelo assistente de atendimento", "created", {
        origem: session.origin || "atendimento",
      });
    });
    session.tickets.push({ protocol, subject, description, status: "Recebida" });
    session.aiActive = false;
    ticketCreated = true;
  }
  recordAnswer({ kind: "atendimento", ragHit, ticketCreated });
  return outcome.text;
}
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  role: user.role,
  unit: user.unit,
  department: user.department,
});
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) fail(413, "O tamanho máximo do envio é 5 MB.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "Dados inválidos.");
    return value;
  } catch {
    fail(400, "Dados inválidos.");
  }
}
/** Mantém o texto bruto (necessário pra conferir a assinatura HMAC do
 * Chatwoot, calculada em cima dos bytes originais) além do JSON já parseado. */
async function rawBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) fail(413, "O tamanho máximo do envio é 5 MB.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString();
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "Dados inválidos.");
    return { text, value };
  } catch {
    fail(400, "Dados inválidos.");
  }
}
function text(value, max, name, required = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(400, `Verifique o campo ${name}.`);
  return value.trim();
}
function cpfValue(value) {
  const cpf = text(value, 32, "CPF").replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf))
    fail(400, "Informe um CPF válido.");
  for (let index = 9; index < 11; index++) {
    let sum = 0;
    for (let i = 0; i < index; i++) sum += Number(cpf[i]) * (index + 1 - i);
    const check = (sum * 10) % 11;
    if (Number(cpf[index]) !== (check === 10 ? 0 : check))
      fail(400, "Informe um CPF válido.");
  }
  return cpf;
}
function issueCode(userId) {
  if (
    db
      .prepare(
        "SELECT user_id FROM senior_accounts WHERE user_id=? AND active=0",
      )
      .get(userId)
  )
    fail(403, "O vínculo deste colaborador não está ativo.");
  const code = randomBytes(16).toString("hex");
  db.prepare("DELETE FROM access_codes WHERE user_id=? OR expires<=?").run(
    userId,
    Date.now(),
  );
  db.prepare("INSERT INTO access_codes VALUES (?,?,?)").run(
    digest(code),
    userId,
    Date.now() + 24 * 3600000,
  );
  return code;
}
function auth(req) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("frizelo_session="))
    ?.split("=")[1];
  if (!cookie) fail(401, "Entre para continuar.");
  const user = db
    .prepare(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires>?",
    )
    .get(digest(cookie), Date.now());
  if (!user) fail(401, "Sua sessão terminou. Entre novamente.");
  if (
    db
      .prepare(
        "SELECT user_id FROM senior_accounts WHERE user_id=? AND active=0",
      )
      .get(user.id)
  )
    fail(401, "Seu acesso não está ativo. Procure o RH.");
  return user;
}
function owned(id, user) {
  const request = db.prepare("SELECT * FROM requests WHERE id=?").get(id);
  if (!request || (user.role !== "rh" && request.user_id !== user.id))
    fail(404, "Solicitação não encontrada.");
  return request;
}
function history(id, user, event, kind = "legacy", data = {}, internal = 0) {
  db.prepare(
    "INSERT INTO history(request_id,user_id,event,created_at,kind,data,internal,actor_name) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    id,
    user.id,
    event,
    new Date().toISOString(),
    kind,
    JSON.stringify(data),
    internal,
    user.name,
  );
}
function list(user) {
  const clause = user.role === "rh" ? "" : "WHERE r.user_id=?";
  const statement = db.prepare(
    `SELECT r.*, u.name requester_name, u.unit, u.department, a.name assigned_name FROM requests r JOIN users u ON u.id=r.user_id LEFT JOIN users a ON a.id=r.assigned_to ${clause} ORDER BY r.created_at DESC`,
  );
  return (user.role === "rh" ? statement.all() : statement.all(user.id)).map(
    (r) => ({ ...r, fields: JSON.parse(r.fields) }),
  );
}
function files(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 3)
    fail(400, "Anexe até 3 arquivos.");
  let total = 0;
  return input.map((f) => {
    if (!f || typeof f !== "object") fail(400, "Arquivo inválido.");
    const name = text(f.name, 160, "nome do arquivo");
    if (
      !["application/pdf", "image/jpeg", "image/png"].includes(f.type) ||
      typeof f.data !== "string"
    )
      fail(400, "Use arquivos PDF, JPG ou PNG.");
    const content = Buffer.from(f.data, "base64");
    total += content.length;
    const valid =
      f.type === "application/pdf"
        ? content.subarray(0, 5).toString() === "%PDF-"
        : f.type === "image/png"
          ? content
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : content[0] === 255 && content[1] === 216 && content[2] === 255;
    if (!valid || !content.length || total > 5 * 1024 * 1024)
      fail(400, "Arquivos inválidos ou acima do limite total de 5 MB.");
    return { name, type: f.type, content };
  });
}
function saveFiles(items, id, user, internal = 0) {
  for (const f of items)
    db.prepare(
      "INSERT INTO attachments (id,request_id,user_id,name,type,content,created_at,internal) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      id,
      user.id,
      f.name,
      f.type,
      f.content,
      new Date().toISOString(),
      internal,
    );
}
const chatwootQueues = new Map();
async function processChatwootMessage(conversationId, message) {
  const sessionId = `cw-${conversationId}`;
  const session = attendanceSession(sessionId);
  session.origin = `chatwoot:${conversationId}`;
  logConversationMessage("atendimento", sessionId, "user", message);
  const ticketsBefore = session.tickets.length;
  // Pedido explícito de pessoa: passa para o rodízio das atendentes.
  if (/\b(atendente|humano|pessoa|falar com (o )?rh)\b/i.test(message)) {
    const reply = "Certo! Vou te passar para uma atendente do RH. Ela continua a conversa por aqui.";
    logConversationMessage("atendimento", sessionId, "assistant", reply);
    await sendChatwootMessage(conversationId, reply);
    await handToHuman(conversationId);
    return;
  }
  // No Chatwoot não há tela de boas-vindas: na primeira mensagem que não
  // seja já o CPF, o assistente se apresenta em vez de responder "Não entendi".
  const firstContact = !session.greeted;
  session.greeted = true;
  let replyText =
    firstContact &&
    session.stage === "collect_cpf" &&
    !normalizedCpf(message) &&
    !looksUnknown(message)
      ? "Olá! Sou o assistente do RH da Frizelo. Posso consultar seu holerite, espelho de ponto, férias e benefícios, ou abrir um chamado para o RH.\n\nPrimeiro preciso confirmar quem você é. Qual é o seu CPF? (só números; se não souber, digite 'não sei')\n\nSe preferir falar direto com uma pessoa, digite 'atendente'."
      : await handleAttendanceMessage(session, message);
  // Sem confirmar a identidade, aqui no chat do RH a saída é uma atendente.
  if (session.stage === "blocked") {
    replyText =
      "Não consegui confirmar seu cadastro por aqui. Vou te passar para uma atendente do RH, que continua a conversa.";
    logConversationMessage("atendimento", sessionId, "assistant", replyText);
    await sendChatwootMessage(conversationId, replyText);
    await handToHuman(conversationId);
    return;
  }
  const ticket =
    session.tickets.length > ticketsBefore ? session.tickets.at(-1) : null;
  if (ticket)
    replyText += `\n\nAbri o chamado ${ticket.protocol} e uma atendente do RH vai continuar daqui.`;
  const candidate = session.candidate
    ? {
        name: session.candidate.NOMFUN,
        identifier: session.matricula || session.cpf || null,
      }
    : null;
  logConversationMessage("atendimento", sessionId, "assistant", replyText, candidate);
  await sendChatwootMessage(conversationId, replyText);
  if (ticket) await handOffTicket(conversationId, ticket);
}
/** Grava uma solicitação com protocolo e histórico. Chamar dentro de transaction(). */
function insertRequest(user, serviceId, subject, description, values) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const number =
    db.prepare("SELECT COUNT(*) total FROM requests").get().total + 1;
  const protocol = `FRZ-${new Date().getFullYear()}-${String(number).padStart(6, "0")}`;
  db.prepare(
    "INSERT INTO requests (id,protocol,user_id,service_id,subject,description,fields,status,assigned_to,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    protocol,
    user.id,
    serviceId,
    subject,
    description,
    JSON.stringify(values),
    "Recebida",
    null,
    now,
    now,
  );
  return { id, protocol };
}
/**
 * Colaborador do central para quem a Senior acabou de confirmar a identidade.
 * Se ainda não tem cadastro, cria igual ao importador da Senior (conta
 * aguardando ativação), para o chamado ter dono e aparecer no painel do RH.
 */
function colaboradorFromCandidate(candidate) {
  const cpf = normalizedCpf(candidate.NUMCPF);
  if (!cpf) throw Object.assign(new Error("CPF do cadastro inválido."), { status: 502 });
  const existing = db
    .prepare("SELECT id,name FROM users WHERE identifier=?")
    .get(cpf);
  if (existing) return existing;
  const user = { id: randomUUID(), name: candidate.NOMFUN.trim() };
  db.prepare(
    "INSERT INTO users (id,identifier,name,role,unit,department,password_hash) VALUES (?,?,?,?,?,?,?)",
  ).run(user.id, cpf, user.name, "colaborador", "Não informado", "Não informado", "!activation-required");
  return user;
}
function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

http
  .createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    try {
      const url = new URL(req.url, origin);
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        fail(400, "Endereço inválido.");
      }
      // Webhook do Chatwoot é servidor-a-servidor (não envia Origin de
      // navegador) e se autentica pela assinatura HMAC checada na própria
      // rota — não pelo cabeçalho Origin usado contra CSRF nas demais rotas.
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers.origin !== origin &&
        req.headers.origin !== `http://localhost:${port}` &&
        pathname !== "/api/chatwoot/webhook"
      )
        fail(403, "Origem do envio não autorizada.");
      if (pathname === "/health")
        return json(res, 200, {
          status: "ok",
          app: "Central de Relacionamentos Frizelo",
          port,
          storage: "sqlite",
        });
      if (pathname === "/api/login" && req.method === "POST") {
        const input = await body(req);
        const identifier = cpfValue(input.identifier);
        text(input.password, 256, "senha");
        const password = input.password;
        const key = req.socket.remoteAddress;
        const prior = failures.get(key);
        if (prior && prior.until > Date.now() && prior.count >= 10)
          fail(
            429,
            "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
          );
        const user = db
          .prepare("SELECT * FROM users WHERE identifier=?")
          .get(identifier);
        if (
          !user ||
          db
            .prepare(
              "SELECT user_id FROM senior_accounts WHERE user_id=? AND active=0",
            )
            .get(user.id) ||
          !verifyPassword(password, user.password_hash)
        ) {
          failures.set(key, {
            count: prior?.until > Date.now() ? prior.count + 1 : 1,
            until: Date.now() + 5 * 60000,
          });
          fail(401, "CPF ou senha incorreta.");
        }
        failures.delete(key);
        db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
        const token = randomBytes(32).toString("hex");
        db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
          digest(token),
          user.id,
          Date.now() + 8 * 3600000,
        );
        return json(
          res,
          200,
          { user: publicUser(user) },
          {
            "Set-Cookie": `frizelo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
          },
        );
      }
      if (pathname === "/api/activate" && req.method === "POST") {
        const input = await body(req);
        const identifier = cpfValue(input.identifier);
        const code = text(input.code, 64, "código de acesso");
        text(input.password, 256, "senha");
        if (input.password.length < 10)
          fail(400, "Escolha uma senha com pelo menos 10 caracteres.");
        const user = db
          .prepare(
            "SELECT u.* FROM users u JOIN access_codes c ON c.user_id=u.id WHERE u.identifier=? AND c.token_hash=? AND c.expires>?",
          )
          .get(identifier, digest(code), Date.now());
        if (
          !user ||
          db
            .prepare(
              "SELECT user_id FROM senior_accounts WHERE user_id=? AND active=0",
            )
            .get(user?.id || "")
        )
          fail(
            400,
            "Código inválido ou expirado. Solicite um novo código ao RH.",
          );
        transaction(() => {
          db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
            hashPassword(input.password),
            user.id,
          );
          db.prepare("DELETE FROM access_codes WHERE user_id=?").run(user.id);
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        });
        return json(res, 200, { ok: true });
      }
      if (pathname === "/api/chatbot/message" && req.method === "POST") {
        const input = await body(req);
        const sessionId = text(input.sessionId, 64, "sessão");
        if (!/^[a-zA-Z0-9-]{8,64}$/.test(sessionId))
          fail(400, "Sessão de simulação inválida.");
        const message = text(input.text, 1000, "mensagem");
        if (!chatAllowed(req.socket.remoteAddress))
          fail(429, "Muitas mensagens em pouco tempo. Aguarde um instante.");
        const session = chatSession(sessionId);
        if (session.messages.length >= 40)
          fail(
            429,
            "Esta simulação atingiu o limite de mensagens. Reinicie a conversa.",
          );
        session.messages.push({ role: "user", content: message });
        logConversationMessage("chatbot", sessionId, "user", message);
        const automated = (text, options = null) => {
          session.messages.push({ role: "assistant", content: text });
          logConversationMessage("chatbot", sessionId, "assistant", text);
          return json(res, 200, {
            text,
            ticket: null,
            tickets: session.tickets,
            automated: true,
            options,
          });
        };
        // Enquanto a IA está no meio de uma troca (ex.: pediu confirmação
        // para abrir um protocolo), a resposta seguinte continua com ela —
        // a triagem só decide de novo quando a conversa está "livre".
        const category = session.aiActive
          ? "duvida"
          : await classifyChat(message);
        session.aiActive = false;
        if (session.pendingTopic && category !== "duvida") {
          const topic = session.pendingTopic;
          if (category === "confirmacao") {
            session.identified = true;
            session.pendingTopic = null;
            return automated(exampleFor(topic), { kind: "topics" });
          }
          if (category === "negacao") {
            session.pendingTopic = null;
            return automated(identityDeclinedMessage, { kind: "topics" });
          }
        }
        if (category === "saudacao")
          return automated(welcomeMessage, { kind: "topics" });
        if (["holerite", "ponto", "ferias", "beneficios"].includes(category)) {
          if (!session.identified) {
            session.pendingTopic = category;
            return automated(identityPrompt, { kind: "yesno" });
          }
          return automated(exampleFor(category), { kind: "topics" });
        }
        // "duvida", "confirmacao"/"negacao" fora de contexto, ou categoria
        // desconhecida: caminho seguro é a IA completa.
        session.aiActive = true;
        const ragHit = Boolean(contextFor(message));
        let outcome;
        try {
          outcome = await hermesReply(session.messages, {
            systemPrompt: withKnowledge(systemPrompt, message),
          });
        } catch (e) {
          session.messages.pop();
          session.aiActive = false;
          throw e;
        }
        session.messages.push({ role: "assistant", content: outcome.text });
        logConversationMessage("chatbot", sessionId, "assistant", outcome.text);
        let ticket = null;
        if (outcome.request && session.tickets.length < 10) {
          ticket = {
            protocol: `SIM-${String(session.tickets.length + 1).padStart(4, "0")}`,
            subject: outcome.request.subject || "Dúvida de RH",
            description: outcome.request.description || "",
            status: "Aberto",
          };
          session.tickets.push(ticket);
        }
        if (ticket) session.aiActive = false; // protocolo fechado: próxima mensagem volta pra triagem
        recordAnswer({
          kind: "chatbot",
          ragHit,
          ticketCreated: Boolean(ticket),
        });
        return json(res, 200, {
          text: outcome.text,
          ticket,
          tickets: session.tickets,
          options: ticket ? { kind: "topics" } : null,
        });
      }
      if (pathname === "/api/atendimento/message" && req.method === "POST") {
        const input = await body(req);
        const sessionId = text(input.sessionId, 64, "sessão");
        if (!/^[a-zA-Z0-9-]{8,64}$/.test(sessionId))
          fail(400, "Sessão de atendimento inválida.");
        const message = text(input.text, 500, "mensagem");
        if (!chatAllowed(req.socket.remoteAddress))
          fail(429, "Muitas mensagens em pouco tempo. Aguarde um instante.");
        const session = attendanceSession(sessionId);
        if (session.messages.length >= 40)
          fail(
            429,
            "Esta conversa atingiu o limite de mensagens. Reinicie o atendimento.",
          );
        logConversationMessage("atendimento", sessionId, "user", message);
        const before = session.tickets.length;
        const replyText = await handleAttendanceMessage(session, message);
        const candidate = session.candidate
          ? {
              name: session.candidate.NOMFUN,
              identifier: session.matricula || session.cpf || null,
            }
          : null;
        logConversationMessage(
          "atendimento",
          sessionId,
          "assistant",
          replyText,
          candidate,
        );
        const ticket =
          session.tickets.length > before
            ? session.tickets[session.tickets.length - 1]
            : null;
        return json(res, 200, {
          text: replyText,
          stage: session.stage,
          ticket,
          tickets: session.tickets,
          options: attendanceOptions(session),
        });
      }
      // =============================================================================
      // Webhook do Agent Bot do Chatwoot (atendimento real via WhatsApp)
      // =============================================================================
      if (pathname === "/api/chatwoot/webhook" && req.method === "POST") {
        const { text: raw, value: payload } = await rawBody(req);
        if (
          !verifySignature(
            raw,
            req.headers["x-chatwoot-timestamp"],
            req.headers["x-chatwoot-signature"],
          )
        )
          fail(401, "Assinatura inválida.");
        // Só mensagem recebida do contato dispara o atendimento. Respostas do
        // bot/atendente chegam como "outgoing" e notas internas como private.
        // (O sender de contato no payload do Chatwoot não traz campo "type".)
        // O Chatwoot manda ao bot toda mensagem da caixa, inclusive depois que
        // a conversa passou para uma atendente ("open"): o bot só fala enquanto
        // ela está "pending", que é a fila dele.
        if (
          payload.event !== "message_created" ||
          payload.message_type !== "incoming" ||
          payload.private ||
          payload.conversation?.status !== "pending"
        )
          return json(res, 200, { ok: true, skipped: true });
        const conversationId = payload.conversation?.id;
        const message = String(payload.content || "").slice(0, 500);
        if (!conversationId || !message.trim())
          return json(res, 200, { ok: true, skipped: true });
        if (!chatAllowed(`cw-${conversationId}`))
          return json(res, 200, { ok: true, skipped: true });
        // O Chatwoot só espera 5 s pelo webhook e, se estourar, tira a conversa
        // do bot. Consulta à Senior/IA passa disso: responde já e processa em
        // seguida, uma mensagem por vez por conversa (a sessão tem estado).
        const previous = chatwootQueues.get(conversationId) || Promise.resolve();
        const next = previous
          .then(() => processChatwootMessage(conversationId, message))
          .catch(async (e) => {
            console.error(`Chatwoot conversa ${conversationId}:`, e.message);
            await sendChatwootMessage(
              conversationId,
              "Não consegui concluir seu atendimento agora. Uma atendente do RH vai continuar daqui.",
            ).catch(() => {});
            await handToHuman(conversationId).catch(() => {});
          })
          .finally(() => {
            if (chatwootQueues.get(conversationId) === next)
              chatwootQueues.delete(conversationId);
          });
        chatwootQueues.set(conversationId, next);
        return json(res, 200, { ok: true, accepted: true });
      }
      if (pathname.startsWith("/api/")) {
        const user = auth(req);
        if (pathname === "/api/ai-metrics" && req.method === "GET") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          return json(res, 200, metricsSummary());
        }
        if (pathname === "/api/knowledge/sync" && req.method === "POST") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          return json(res, 200, await syncAll());
        }
        if (pathname === "/api/conversations" && req.method === "GET") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          return json(res, 200, { conversations: listConversations() });
        }
        if (
          pathname.startsWith("/api/conversations/") &&
          req.method === "GET"
        ) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const id = decodeURIComponent(
            pathname.slice("/api/conversations/".length),
          );
          if (!/^(chatbot|atendimento):[a-zA-Z0-9-]{8,64}$/.test(id))
            fail(400, "Conversa inválida.");
          return json(res, 200, { messages: conversationMessages(id) });
        }
        if (pathname === "/api/portal-vacancies" && req.method === "GET") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          try {
            return json(res, 200, await portalVacancies());
          } catch {
            return json(res, 502, { error: "Portal do Líder indisponível." });
          }
        }
        if (
          pathname.startsWith("/api/portal-vacancies/") &&
          req.method === "GET"
        ) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const sourceId = pathname.slice("/api/portal-vacancies/".length);
          if (!/^\d+$/.test(sourceId)) fail(400, "Solicitação inválida.");
          let portal;
          try {
            portal = await portalVacancyById(sourceId);
          } catch {
            fail(502, "Portal do Líder indisponível.");
          }
          if (portal.state === "missing")
            fail(404, "Solicitação não encontrada no Portal.");
          if (portal.state !== "ok") fail(502, "Portal do Líder indisponível.");
          return json(res, 200, portal.solicitacao);
        }
        if (
          pathname.startsWith("/api/portal-vacancies/") &&
          pathname.endsWith("/decision") &&
          req.method === "POST"
        ) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const sourceId = pathname.slice(
            "/api/portal-vacancies/".length,
            -"/decision".length,
          );
          if (!/^\d+$/.test(sourceId)) fail(400, "Solicitação inválida.");
          const input = await body(req);
          if (!["APROVADA", "REPROVADA"].includes(input?.decision))
            fail(400, "Decisão inválida.");
          try {
            return json(
              res,
              200,
              await decidePortalVacancy(sourceId, input.decision, user.id),
            );
          } catch (error) {
            fail(
              error.status >= 400 && error.status < 500 ? error.status : 502,
              error.message,
            );
          }
        }
        if (
          pathname.startsWith("/api/portal-vacancies/") &&
          pathname.endsWith("/create-ats") &&
          req.method === "POST"
        ) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const sourceId = pathname.slice(
            "/api/portal-vacancies/".length,
            -"/create-ats".length,
          );
          if (!/^\d+$/.test(sourceId)) fail(400, "Solicitação inválida.");
          let portal;
          try {
            portal = await portalVacancyById(sourceId);
          } catch {
            fail(502, "Portal do Líder indisponível.");
          }
          if (portal.state === "missing")
            fail(404, "Solicitação não encontrada no Portal.");
          if (portal.state !== "ok") fail(502, "Portal do Líder indisponível.");
          const request = portal.solicitacao;
          if (!request) fail(404, "Solicitação não encontrada no Portal.");
          if (request.status !== "aprovado" || request.resultado !== "APROVADA")
            fail(409, "A solicitação ainda não foi aprovada pelo RH.");
          if (!request.vaga)
            fail(
              409,
              "O pedido antigo não contém os campos necessários da vaga.",
            );
          let vacancy;
          try {
            vacancy = await createVacancy(request);
          } catch (error) {
            fail(
              error.status >= 400 && error.status < 500 ? error.status : 502,
              error.message,
            );
          }
          const linked = registerLink(
            db,
            {
              sourceSystem: "portal-lider-isolado",
              sourceId,
              sourceProtocol: request.codigo,
              atsInstance: "ats-recrutamento-local",
              atsVacancyId: String(vacancy.id),
            },
            user.id,
          );
          return json(res, vacancy.created ? 201 : 200, {
            vacancy,
            link: linked.link,
          });
        }
        if (pathname === "/api/integration-links") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          if (req.method === "GET")
            return json(res, 200, {
              links: db
                .prepare(
                  "SELECT * FROM integration_links ORDER BY created_at DESC LIMIT 200",
                )
                .all(),
            });
          if (req.method === "POST") {
            const result = registerLink(db, await body(req), user.id);
            return json(res, result.created ? 201 : 200, result);
          }
          fail(405, "Método não permitido.");
        }
        if (
          pathname.startsWith("/api/integration-links/") &&
          pathname.endsWith("/status") &&
          req.method === "GET"
        ) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const linkId = pathname.slice(
            "/api/integration-links/".length,
            -"/status".length,
          );
          const link = db
            .prepare("SELECT * FROM integration_links WHERE id=?")
            .get(linkId);
          if (!link) fail(404, "Vínculo não encontrado.");
          return json(res, 200, await vacancyStatus(link));
        }
        if (
          pathname.startsWith("/api/integration-links/") &&
          pathname.endsWith("/applications") &&
          req.method === "GET"
        ) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const linkId = pathname.slice(
            "/api/integration-links/".length,
            -"/applications".length,
          );
          const link = db
            .prepare("SELECT * FROM integration_links WHERE id=?")
            .get(linkId);
          if (!link) fail(404, "Vínculo não encontrado.");
          try {
            return json(res, 200, await vacancyApplications(link));
          } catch (error) {
            fail(
              error.status >= 400 && error.status < 500 ? error.status : 502,
              error.message,
            );
          }
        }
        if (
          pathname.startsWith("/api/integration-links/") &&
          pathname.endsWith("/publication") &&
          req.method === "PATCH"
        ) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const linkId = pathname.slice(
            "/api/integration-links/".length,
            -"/publication".length,
          );
          const link = db
            .prepare("SELECT * FROM integration_links WHERE id=?")
            .get(linkId);
          if (!link) fail(404, "Vínculo não encontrado.");
          const input = await body(req);
          if (typeof input?.publish !== "boolean")
            fail(400, "Informe a decisão de divulgação.");
          let result;
          try {
            result = await setVacancyPublication(link, input.publish, user.id);
          } catch (error) {
            fail(
              error.status >= 400 && error.status < 500 ? error.status : 502,
              error.message,
            );
          }
          if (result.changed)
            db.prepare(
              "INSERT INTO integration_link_history (link_id,actor_id,event,created_at) VALUES (?,?,?,?)",
            ).run(
              link.id,
              user.id,
              input.publish ? "DIVULGACAO_AUTORIZADA" : "DIVULGACAO_RETIRADA",
              new Date().toISOString(),
            );
          return json(res, 200, result);
        }
        if (
          ["/api/management", "/api/management.csv"].includes(pathname) &&
          req.method === "GET"
        ) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const days = Number(url.searchParams.get("days") ?? 30);
          if (![0, 7, 30, 90].includes(days)) fail(400, "Período inválido.");
          const includeDemo = url.searchParams.get("demo") === "true";
          const report = managementReport(db, { days, includeDemo });
          if (pathname.endsWith(".csv")) {
            res.writeHead(200, {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="indicadores-rh.csv"',
            });
            return res.end(managementCsv(report, { days, includeDemo }));
          }
          return json(res, 200, report);
        }
        if (pathname === "/api/senior/synchronize") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          if (req.method === "POST") {
            startSynchronization(db);
            return json(res, 202, { state: synchronization.state });
          }
          if (req.method === "GET") return json(res, 200, synchronization);
          fail(405, "Método não permitido.");
        }
        if (pathname.startsWith("/api/senior/employees")) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          if (pathname === "/api/senior/employees" && req.method === "POST") {
            if (synchronization.state === "running")
              fail(
                429,
                "A sincronização está em andamento. Aguarde antes de extrair.",
              );
            startExtraction(user.id);
            return json(res, 202, { state: extraction.state });
          }
          if (extraction.owner && extraction.owner !== user.id) {
            if (pathname === "/api/senior/employees" && req.method === "GET")
              return json(res, 200, {
                state: extraction.state === "running" ? "busy" : "idle",
              });
            fail(403, "Esta extração pertence a outro usuário do RH.");
          }
          if (
            extraction.completedAt &&
            Date.now() - Date.parse(extraction.completedAt) > 15 * 60 * 1000
          ) {
            extraction.rows = undefined;
            extraction.state = "expired";
          }
          if (pathname === "/api/senior/employees" && req.method === "GET") {
            const { rows, owner, job, ...status } = extraction;
            return json(res, 200, status);
          }
          if (
            pathname === "/api/senior/employees.csv" &&
            req.method === "GET"
          ) {
            if (extraction.state !== "complete" || !extraction.rows)
              fail(409, "Execute uma extração completa antes de baixar.");
            res.writeHead(200, {
              "Content-Type": "text/csv; charset=utf-8",
              "Cache-Control": "no-store",
              "Content-Disposition":
                'attachment; filename="colaboradores-senior.csv"',
            });
            return res.end(csv(extraction.rows));
          }
          fail(405, "Método não permitido.");
        }
        if (pathname === "/api/senior/status" && req.method === "GET") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const config = configuration();
          return json(res, 200, {
            enabled: config.enabled,
            configured: Boolean(config.base && config.user && config.password),
            mode: "Somente leitura",
            officialReports: "Pendente de homologação",
            benefitMapping: config.benefits.length > 0,
          });
        }
        if (
          ["/api/senior/links", "/api/senior/consult"].includes(pathname) &&
          req.method === "GET"
        ) {
          if (seniorInFlight.has(user.id) || seniorInFlight.size >= 3)
            fail(
              429,
              "Há uma consulta em andamento. Aguarde e tente novamente.",
            );
          seniorInFlight.add(user.id);
          try {
            return json(
              res,
              200,
              pathname.endsWith("/links")
                ? { links: await links(user) }
                : await consult(
                    user,
                    url.searchParams.get("kind"),
                    url.searchParams.get("month"),
                    url.searchParams.get("link"),
                  ),
            );
          } finally {
            seniorInFlight.delete(user.id);
          }
        }
        if (pathname === "/api/me" && req.method === "GET")
          return json(res, 200, { user: publicUser(user) });
        if (pathname === "/api/team" && req.method === "GET") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          return json(res, 200, {
            team: db
              .prepare(
                "SELECT id,name FROM users WHERE role='rh' ORDER BY name",
              )
              .all(),
          });
        }
        if (pathname === "/api/users" && req.method === "GET") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          return json(res, 200, {
            users: db
              .prepare(
                "SELECT u.id,u.name,u.unit,u.department,substr(u.identifier,1,3)||'.***.***-'||substr(u.identifier,10,2) cpf_masked,CASE WHEN a.user_id IS NULL THEN 'local' ELSE 'senior' END source FROM users u LEFT JOIN senior_accounts a ON a.user_id=u.id WHERE u.role='colaborador' AND a.active=1 AND u.id NOT LIKE 'demo-%' ORDER BY u.name",
              )
              .all(),
          });
        }
        if (pathname === "/api/users" && req.method === "POST") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          fail(
            405,
            "Os colaboradores são cadastrados pela sincronização da Senior.",
          );
        }
        const accessMatch = pathname.match(
          /^\/api\/users\/([a-z0-9-]+)\/access-code$/,
        );
        if (accessMatch && req.method === "POST") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const employee = db
            .prepare("SELECT * FROM users WHERE id=? AND role='colaborador'")
            .get(accessMatch[1]);
          if (!employee) fail(404, "Colaborador não encontrado.");
          return json(res, 200, {
            code: issueCode(employee.id),
            name: employee.name,
          });
        }
        if (pathname === "/api/logout" && req.method === "POST") {
          const token = req.headers.cookie?.match(
            /(?:^|;\s*)frizelo_session=([^;]+)/,
          )?.[1];
          if (token)
            db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
              digest(token),
            );
          return json(
            res,
            200,
            { ok: true },
            {
              "Set-Cookie":
                "frizelo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
            },
          );
        }
        if (pathname === "/api/requests" && req.method === "GET")
          return json(res, 200, { requests: list(user) });
        if (pathname === "/api/requests" && req.method === "POST") {
          if (user.role !== "colaborador")
            fail(
              403,
              "Use o acesso de colaborador para abrir uma solicitação.",
            );
          const input = await body(req);
          const service = services.find((s) => s.id === input.service_id);
          if (!service) fail(400, "Escolha um serviço.");
          const subject = text(input.subject, 160, "assunto");
          const description = text(input.description, 10000, "descrição");
          const values = {};
          for (const field of service.fields)
            values[field] = text(input.fields?.[field], 200, field);
          const attachments = files(input.attachments);
          let id;
          transaction(() => {
            ({ id } = insertRequest(user, service.id, subject, description, values));
            history(id, user, "Solicitação recebida", "created", {
              attachments: attachments.length,
            });
            saveFiles(attachments, id, user);
          });
          return json(res, 201, {
            request: list(user).find((r) => r.id === id),
          });
        }
        const match = pathname.match(
          /^\/api\/requests\/([a-f0-9-]+)(?:\/(messages))?$/,
        );
        if (match) {
          const id = match[1];
          const request = owned(id, user);
          if (!match[2] && req.method === "GET") {
            return json(res, 200, {
              request: list(user).find((r) => r.id === id),
              messages: db
                .prepare(
                  "SELECT m.*,u.name author,u.role FROM messages m JOIN users u ON u.id=m.user_id WHERE request_id=? AND (m.internal=0 OR ?=1) ORDER BY created_at",
                )
                .all(id, user.role === "rh" ? 1 : 0),
              history: db
                .prepare(
                  "SELECT h.*,coalesce(h.actor_name,u.name) author FROM history h JOIN users u ON u.id=h.user_id WHERE request_id=? AND (h.internal=0 OR ?=1) ORDER BY h.id",
                )
                .all(id, user.role === "rh" ? 1 : 0)
                .map((row) => ({ ...row, data: JSON.parse(row.data) })),
              attachments: db
                .prepare(
                  "SELECT id,name,type,length(content) size,created_at,internal FROM attachments WHERE request_id=? AND (internal=0 OR ?=1) ORDER BY created_at",
                )
                .all(id, user.role === "rh" ? 1 : 0),
            });
          }
          if (match[2] && req.method === "POST") {
            if (request.status === "Concluída")
              fail(
                409,
                "Esta solicitação está concluída. Abra uma nova solicitação, se necessário.",
              );
            const input = await body(req);
            const message = text(input.body, 10000, "mensagem");
            const attachments = files(input.attachments);
            if (input.internal && user.role !== "rh")
              fail(403, "Notas internas são exclusivas do RH.");
            const internal = input.internal ? 1 : 0;
            transaction(() => {
              db.prepare(
                "INSERT INTO messages (id,request_id,user_id,body,created_at,internal) VALUES (?,?,?,?,?,?)",
              ).run(
                randomUUID(),
                id,
                user.id,
                message,
                new Date().toISOString(),
                internal,
              );
              saveFiles(attachments, id, user, internal);
              history(
                id,
                user,
                internal
                  ? "Nota interna registrada"
                  : user.role === "rh"
                    ? "Resposta enviada pelo RH"
                    : "Mensagem enviada pelo colaborador",
                internal ? "internal_note" : "message",
                { attachments: attachments.length },
                internal,
              );
              if (
                user.role === "colaborador" &&
                request.status === "Aguardando colaborador"
              ) {
                db.prepare("UPDATE requests SET status=? WHERE id=?").run(
                  "Em atendimento",
                  id,
                );
                history(
                  id,
                  user,
                  "Informações enviadas pelo colaborador",
                  "status",
                  { from: "Aguardando colaborador", to: "Em atendimento" },
                );
              }
              db.prepare("UPDATE requests SET updated_at=? WHERE id=?").run(
                new Date().toISOString(),
                id,
              );
            });
            return json(res, 201, { ok: true });
          }
          if (!match[2] && req.method === "PATCH") {
            if (user.role !== "rh")
              fail(403, "Apenas o RH pode atualizar o atendimento.");
            const input = await body(req);
            if (input.status !== undefined && !statuses.includes(input.status))
              fail(400, "Status inválido.");
            if (
              input.priority !== undefined &&
              !["Baixa", "Normal", "Alta"].includes(input.priority)
            )
              fail(400, "Prioridade inválida.");
            if (
              input.due_at !== undefined &&
              input.due_at !== null &&
              (typeof input.due_at !== "string" ||
                !Number.isFinite(Date.parse(input.due_at)))
            )
              fail(400, "Prazo inválido.");
            if (
              input.assigned_to !== undefined &&
              input.assigned_to !== null &&
              !db
                .prepare("SELECT id FROM users WHERE id=? AND role='rh'")
                .get(input.assigned_to)
            )
              fail(400, "Responsável inválido.");
            if (
              input.status === "Concluída" &&
              !db
                .prepare(
                  "SELECT id FROM messages WHERE request_id=? AND internal=0 AND user_id IN (SELECT id FROM users WHERE role=?) LIMIT 1",
                )
                .get(id, "rh")
            )
              fail(400, "Envie uma resposta ao colaborador antes de concluir.");
            transaction(() => {
              if (input.assign) {
                db.prepare("UPDATE requests SET assigned_to=? WHERE id=?").run(
                  user.id,
                  id,
                );
                history(
                  id,
                  user,
                  "Atendimento assumido pelo RH",
                  "assignment",
                  {
                    from: request.assigned_to
                      ? db
                          .prepare("SELECT name FROM users WHERE id=?")
                          .get(request.assigned_to)?.name
                      : "Sem responsável",
                    to: user.name,
                  },
                );
              }
              if (input.status && input.status !== request.status) {
                db.prepare(
                  "UPDATE requests SET status=?,closed_at=?,closed_due_at=? WHERE id=?",
                ).run(
                  input.status,
                  input.status === "Concluída"
                    ? new Date().toISOString()
                    : null,
                  input.status === "Concluída"
                    ? input.due_at !== undefined
                      ? input.due_at
                      : request.due_at
                    : null,
                  id,
                );
                history(
                  id,
                  user,
                  `Status alterado para ${input.status}`,
                  "status",
                  { from: request.status, to: input.status },
                );
              }
              if (
                input.priority !== undefined &&
                input.priority !== request.priority
              ) {
                db.prepare("UPDATE requests SET priority=? WHERE id=?").run(
                  input.priority,
                  id,
                );
                history(
                  id,
                  user,
                  `Prioridade definida: ${input.priority}`,
                  "priority",
                  { from: request.priority, to: input.priority },
                );
              }
              if (
                input.due_at !== undefined &&
                input.due_at !== request.due_at
              ) {
                db.prepare("UPDATE requests SET due_at=? WHERE id=?").run(
                  input.due_at,
                  id,
                );
                history(
                  id,
                  user,
                  input.due_at
                    ? "Prazo de atendimento atualizado"
                    : "Prazo de atendimento removido",
                  "deadline",
                  { from: request.due_at, to: input.due_at },
                );
              }
              if (
                input.assigned_to !== undefined &&
                input.assigned_to !== request.assigned_to
              ) {
                db.prepare("UPDATE requests SET assigned_to=? WHERE id=?").run(
                  input.assigned_to,
                  id,
                );
                history(
                  id,
                  user,
                  "Responsável pelo atendimento atualizado",
                  "assignment",
                  {
                    from: request.assigned_to
                      ? db
                          .prepare("SELECT name FROM users WHERE id=?")
                          .get(request.assigned_to)?.name
                      : "Sem responsável",
                    to: input.assigned_to
                      ? db
                          .prepare("SELECT name FROM users WHERE id=?")
                          .get(input.assigned_to)?.name
                      : "Sem responsável",
                  },
                );
              }
              db.prepare("UPDATE requests SET updated_at=? WHERE id=?").run(
                new Date().toISOString(),
                id,
              );
            });
            return json(res, 200, { ok: true });
          }
        }
        const attachment = pathname.match(/^\/api\/attachments\/([a-f0-9-]+)$/);
        if (attachment && req.method === "GET") {
          const file = db
            .prepare("SELECT * FROM attachments WHERE id=?")
            .get(attachment[1]);
          if (!file || (file.internal && user.role !== "rh"))
            fail(404, "Arquivo não encontrado.");
          owned(file.request_id, user);
          res.writeHead(200, {
            "Content-Type": file.type,
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            "Cache-Control": "no-store",
          });
          return res.end(Buffer.from(file.content));
        }
        fail(404, "Recurso não encontrado.");
      }
      if (!["GET", "HEAD"].includes(req.method))
        fail(405, "Método não permitido.");
      const file = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root) || !(await stat(file)).isFile())
        fail(404, "Não encontrado.");
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (e) {
      if (e.status) return json(res, e.status, { error: e.message });
      if (e.code === "ENOENT")
        return json(res, 404, { error: "Não encontrado." });
      console.error("Request failed:", e.message);
      json(res, 500, { error: "Não foi possível concluir. Tente novamente." });
    }
  })
  .listen(port, process.env.CENTRAL_HOST || "127.0.0.1", () =>
    console.log(
      `Central Frizelo: ${origin} (escutando em ${process.env.CENTRAL_HOST || "127.0.0.1"})`,
    ),
  );
