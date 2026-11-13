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
import { realReply, parseMonth, candidateUser } from "./senior-reply.mjs";
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
  resolveConversation,
  sendMessageWithFiles,
  downloadAttachment,
  listInboxConversations,
  listConversationMessages,
} from "./chatwoot-client.mjs";
import { recoverMissed } from "./whatsapp-recovery.mjs";
import { configuration as chatwootConfiguration } from "./chatwoot-client.mjs";
import { startWahaWatchdog } from "./waha-watchdog.mjs";
import { createEmailAlerts } from "./email-alerts.mjs";
import {
  whatsappConfig,
  phoneAllowed,
  nextStep,
  businessDeadline,
  slaStatus,
  THEMES,
  ticketOpenedText,
  ticketClosedText,
  ticketOpenReminderText,
  sameName,
  verifiedText,
  retryIdentityText,
  identityFailedText,
  anotherMonthText,
  statusText,
  ratingThanksText,
  rememberedText,
  ticketTheme,
  withinOfficeHours,
  businessElapsed,
  awaitingEmployeeText,
  awaitingReminderText,
  firstResponseStatus,
} from "./whatsapp-rh.mjs";
import { holeritePdf, espelhoPdf } from "./senior-documents.mjs";
import { situationNames } from "./senior.mjs";
import { recordAgentReply, closeFromChatwoot } from "./chatwoot-sync.mjs";

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
      const conversation = /^chatwoot:(\d+)$/.exec(session.origin || "")?.[1];
      if (conversation)
        db.prepare("UPDATE requests SET chatwoot_conversation_id=? WHERE id=?").run(
          conversation,
          created.id,
        );
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
    `SELECT r.*, u.name requester_name, u.unit, u.department, a.name assigned_name,
       (SELECT MIN(m.created_at) FROM messages m JOIN users mu ON mu.id=m.user_id WHERE m.request_id=r.id AND m.internal=0 AND mu.role='rh') first_response_at,
       (SELECT mu.role FROM messages m JOIN users mu ON mu.id=m.user_id WHERE m.request_id=r.id AND m.internal=0 ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) last_role,
       (SELECT MAX(m.created_at) FROM messages m WHERE m.request_id=r.id AND m.internal=0) last_message_at
     FROM requests r JOIN users u ON u.id=r.user_id LEFT JOIN users a ON a.id=r.assigned_to ${clause} ORDER BY r.created_at DESC`,
  );
  const { holidays, officeHours, firstResponseHours } = whatsappConfig();
  const now = Date.now();
  return (user.role === "rh" ? statement.all() : statement.all(user.id)).map(
    ({ last_role, ...r }) => ({
      ...r,
      fields: JSON.parse(r.fields),
      // Criticidade pelo prazo útil consumido (verde/amarelo/laranja/vermelho).
      sla: r.status !== "Concluída" && r.due_at ? slaStatus(r.created_at, r.due_at, now, holidays) : null,
      // Primeira resposta do RH (prazo curto, só no expediente).
      first_response:
        user.role === "rh"
          ? r.status === "Concluída" && !r.first_response_at
            ? null
            : firstResponseStatus(r.created_at, r.first_response_at, now, { hours: firstResponseHours, officeHours, holidays })
          : undefined,
      // A vez é do RH: chamado aberto cuja última mensagem pública veio do colaborador.
      needs_reply: r.status !== "Concluída" && r.status !== "Aguardando colaborador" && last_role !== "rh",
    }),
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
function saveFiles(items, id, user, internal = 0, messageId = null) {
  for (const f of items)
    db.prepare(
      "INSERT INTO attachments (id,request_id,user_id,name,type,content,created_at,internal,message_id) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      id,
      user.id,
      f.name,
      f.type,
      f.content,
      new Date().toISOString(),
      internal,
      messageId,
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
// =============================================================================
// WhatsApp do RH: atendente virtual -> chamado na central (ver whatsapp-rh.mjs)
// =============================================================================
// Formatos que o colaborador pode mandar pelo WhatsApp e ficam guardados no chamado.
const WHATSAPP_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};
const EXTENSION_TYPES = Object.fromEntries(Object.entries(WHATSAPP_TYPES).map(([type, ext]) => [ext, type]));
Object.assign(EXTENSION_TYPES, { jpeg: "image/jpeg", oga: "audio/ogg", opus: "audio/ogg", m4v: "video/mp4" });
const INLINE_TYPES = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac)|video\/(mp4|3gpp)|application\/pdf)$/;
const WHATSAPP_MAX_BYTES = 16 * 1024 * 1024;
/** Tipo do arquivo: o que o Chatwoot informa ou, se vier genérico, pela extensão. */
function whatsappType(file, attachment) {
  if (WHATSAPP_TYPES[file.type]) return file.type;
  const ext = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(String(attachment.data_url || ""))?.[1]?.toLowerCase();
  if (ext && EXTENSION_TYPES[ext]) return EXTENSION_TYPES[ext];
  if (attachment.file_type === "audio") return "audio/ogg";
  return null;
}
const formatPhone = (digits) =>
  digits.length >= 12
    ? `(${digits.slice(2, 4)}) ${digits.slice(4, -4)}-${digits.slice(-4)}`
    : digits;
/** Dono do chamado vindo do WhatsApp: um usuário por telefone, sem acesso à central. */
function whatsappOwner(phone, contactName) {
  const digits = String(phone || "").replace(/\D/g, "");
  const identifier = `whatsapp:${digits}`;
  const existing = db.prepare("SELECT id,name FROM users WHERE identifier=?").get(identifier);
  if (existing) return existing;
  const raw = String(contactName || "").trim();
  const name = raw && !/@|^\+?\d[\d\s()-]*$/.test(raw) ? raw.slice(0, 120) : `WhatsApp ${formatPhone(digits)}`;
  const user = { id: randomUUID(), name };
  db.prepare(
    "INSERT INTO users (id,identifier,name,role,unit,department,password_hash) VALUES (?,?,?,?,?,?,?)",
  ).run(user.id, identifier, name, "colaborador", "WhatsApp", "Não informado", "!whatsapp");
  return user;
}
/**
 * Baixa os anexos da mensagem (foto, áudio, vídeo, PDF, Word, Excel…) e guarda no chamado.
 * Localização e contato viram texto; o que não der para guardar vira um aviso.
 */
async function whatsappFiles(attachments) {
  const files = [];
  const notes = [];
  const label = { audio: "áudio", video: "vídeo", image: "imagem", file: "arquivo" };
  for (const [i, a] of attachments.slice(0, 5).entries()) {
    if (a.file_type === "location") {
      const lat = a.coordinates_lat ?? a.latitude;
      const lng = a.coordinates_long ?? a.longitude;
      notes.push(lat && lng ? `📍 Localização enviada: https://maps.google.com/?q=${Number(lat)},${Number(lng)}` : "📍 Localização enviada");
      continue;
    }
    if (a.file_type === "contact") {
      notes.push(`👤 Contato enviado: ${String(a.fallback_title || a.name || "").slice(0, 120)}`.trim());
      continue;
    }
    try {
      const file = await downloadAttachment(a.data_url, WHATSAPP_MAX_BYTES);
      const type = whatsappType(file, a);
      if (!type) throw new Error("tipo");
      const kind = type.startsWith("audio/") ? "audio" : type.startsWith("video/") ? "video" : type.startsWith("image/") ? "imagem" : "arquivo";
      files.push({ name: `whatsapp-${kind}-${Date.now()}-${i + 1}.${WHATSAPP_TYPES[type]}`, type, content: file.content });
    } catch (e) {
      notes.push(
        e.status === 413
          ? `(${label[a.file_type] || "arquivo"} acima de 16 MB recebido no WhatsApp — veja a conversa no Chatwoot)`
          : `(${label[a.file_type] || "arquivo"} recebido no WhatsApp em formato não suportado — veja a conversa no Chatwoot)`,
      );
    }
  }
  return { files, notes };
}
function saveWhatsappState(conversationId, state, phone, requestId) {
  db.prepare(
    `INSERT INTO whatsapp_rh (conversation_id,stage,theme,invalid,request_id,phone,updated_at,data) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(conversation_id) DO UPDATE SET stage=excluded.stage,theme=excluded.theme,invalid=excluded.invalid,
     request_id=coalesce(excluded.request_id,whatsapp_rh.request_id),phone=excluded.phone,updated_at=excluded.updated_at,data=excluded.data`,
  ).run(
    String(conversationId),
    state.stage,
    state.theme ?? null,
    state.invalid || 0,
    requestId ?? null,
    phone,
    new Date().toISOString(),
    JSON.stringify(state.data || {}),
  );
}
// Identidade confirmada na Senior por conversa (só em memória, vale 30 min).
const whatsappIdentities = new Map();
const IDENTITY_TTL = 30 * 60000;
async function verifyWhatsappIdentity(conversationId, step, phone) {
  const { cpf, matricula, name } = step.verify;
  const attempts = (step.state.data?.attempts || 0) + 1;
  let candidate = null;
  try {
    candidate = await lookupCandidate({ cpf, matricula });
  } catch (e) {
    console.error(`WhatsApp RH conversa ${conversationId}: Senior indisponível na verificação:`, e.message);
    saveWhatsappState(conversationId, { ...step.state, stage: "doc_cpf", data: { attempts: step.state.data?.attempts || 0 } }, phone);
    return "A consulta à Senior está indisponível agora. Tente de novo em alguns minutos, ou envie **menu** para falar com o RH.";
  }
  if (candidate && sameName(name, candidate.NOMFUN)) {
    whatsappIdentities.set(String(conversationId), { candidate, expires: Date.now() + IDENTITY_TTL });
    saveWhatsappState(conversationId, { ...step.state, stage: "doc_mes", data: {} }, phone);
    return verifiedText(firstName(candidate), step.state.theme);
  }
  if (attempts < 2) {
    saveWhatsappState(conversationId, { ...step.state, stage: "doc_cpf", data: { attempts } }, phone);
    return retryIdentityText;
  }
  saveWhatsappState(conversationId, { ...step.state, stage: "tema", theme: ticketTheme(step.state.theme), data: {} }, phone);
  return identityFailedText(step.state.theme);
}
async function deliverWhatsappDocument(conversationId, step, phone) {
  const identity = whatsappIdentities.get(String(conversationId));
  if (!identity || identity.expires < Date.now()) {
    whatsappIdentities.delete(String(conversationId));
    saveWhatsappState(conversationId, { ...step.state, stage: "doc_cpf", data: { attempts: 0 } }, phone);
    return "Por segurança, preciso confirmar seus dados de novo.\nQual é o seu **CPF**? (só os números)";
  }
  const { kind, month } = step.deliver;
  const person = identity.candidate;
  const audit = (status) =>
    db
      .prepare(
        "INSERT INTO whatsapp_documents (conversation_id,phone,kind,month,numemp,numcad,status,created_at,name) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        String(conversationId), phone, kind, month, String(person.NUMEMP), String(person.NUMCAD), status, new Date().toISOString(),
        String(person.NOMFUN || "").trim() || null,
      );
  await sendChatwootMessage(conversationId, "Consultando a Senior… isso pode levar até 1 minuto. ⏳");
  let result;
  try {
    result = await consult(candidateUser(person), kind, month);
  } catch (e) {
    audit(`erro: ${e.message}`.slice(0, 200));
    return `Não consegui consultar a Senior agora (${e.message}). Tente de novo em alguns minutos.
${anotherMonthText}`;
  }
  const empty = kind === "holerite" ? !result.events?.length : !result.marks?.length && !result.situations?.length;
  if (empty) {
    audit("sem dados");
    return `${result.notice || "Não encontrei dados para essa competência."}
${anotherMonthText}`;
  }
  const names = kind === "ponto" ? await situationNames(result.situations.map((s) => s.CODSIT)).catch(() => ({})) : {};
  const content = kind === "holerite" ? holeritePdf(result, person, month) : espelhoPdf(result, person, month, names);
  const label = kind === "holerite" ? "Holerite" : "Espelho de ponto";
  const competence = `${month.slice(5, 7)}/${month.slice(0, 4)}`;
  await sendMessageWithFiles(conversationId, `📄 ${label} de ${competence}`, [
    { name: `${label.toLowerCase().replace(/ /g, "-")}-${month}.pdf`, type: "application/pdf", content },
  ]);
  audit("enviado");
  return anotherMonthText;
}
async function processWhatsappRh(payload, config) {
  const conversationId = String(payload.conversation.id);
  const phone = String(payload.sender?.phone_number || payload.conversation?.meta?.sender?.phone_number || "");
  const text = String(payload.content || "").slice(0, 4000);
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const row = db.prepare("SELECT * FROM whatsapp_rh WHERE conversation_id=?").get(conversationId);
  let state = row ? { stage: row.stage, theme: row.theme, invalid: row.invalid } : null;
  if (row?.request_id) {
    const request = db.prepare("SELECT status FROM requests WHERE id=?").get(row.request_id);
    const concluded = !request || request.status === "Concluída";
    // Pesquisa de satisfação só vale para chamado concluído (se foi reaberto, volta ao chamado).
    if (row.stage === "pesquisa") state = concluded ? state : { ...state, stage: "chamado" };
    else if (concluded) state = { stage: "encerrado" };
  }
  if (state) state.data = JSON.parse(row.data || "{}");
  const step = nextStep(state, text, { hasAttachment: attachments.length > 0 });
  if (step.status) {
    const digits = phone.replace(/\D/g, "");
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const requests = db
      .prepare(
        `SELECT r.protocol,r.subject,r.status,r.due_at,r.closed_at FROM requests r JOIN users u ON u.id=r.user_id
         WHERE u.identifier=? AND (r.status<>'Concluída' OR r.closed_at>=?)
         ORDER BY (r.status='Concluída'), r.created_at DESC LIMIT 6`,
      )
      .all(`whatsapp:${digits}`, since);
    saveWhatsappState(conversationId, step.state, phone, null);
    await sendChatwootMessage(conversationId, statusText(requests));
    return;
  }
  if (step.rate) {
    transaction(() => {
      const owner = db.prepare("SELECT u.id,u.name FROM requests r JOIN users u ON u.id=r.user_id WHERE r.id=?").get(row.request_id);
      db.prepare("UPDATE requests SET rating=?,rated_at=? WHERE id=? AND status='Concluída'").run(step.rate, new Date().toISOString(), row.request_id);
      history(row.request_id, owner, `Atendimento avaliado pelo colaborador: ${step.rate} de 5`, "rating", { nota: step.rate });
      saveWhatsappState(conversationId, step.state, phone, null);
    });
    await sendChatwootMessage(conversationId, ratingThanksText(step.rate));
    return;
  }
  if (step.identity) {
    // Identidade confirmada há menos de 30 min nesta conversa: vai direto ao mês.
    const identity = whatsappIdentities.get(conversationId);
    if (identity && identity.expires > Date.now()) {
      saveWhatsappState(conversationId, { ...step.state, stage: "doc_mes", data: {} }, phone);
      await sendChatwootMessage(conversationId, rememberedText(firstName(identity.candidate), step.state.theme));
      return;
    }
  }
  if (step.verify) {
    await sendChatwootMessage(conversationId, await verifyWhatsappIdentity(conversationId, step, phone));
    return;
  }
  if (step.deliver) {
    await sendChatwootMessage(conversationId, await deliverWhatsappDocument(conversationId, step, phone));
    return;
  }
  if (step.remind && row?.request_id) {
    const { protocol } = db.prepare("SELECT protocol FROM requests WHERE id=?").get(row.request_id);
    await sendChatwootMessage(conversationId, ticketOpenReminderText(protocol));
    return;
  }
  if (step.append || step.open) {
    const { files, notes } = await whatsappFiles(attachments);
    const body = [text.trim(), ...notes].filter(Boolean).join("\n") || "(anexo enviado pelo WhatsApp)";
    if (step.append) {
      transaction(() => {
        const owner = db.prepare("SELECT u.id,u.name FROM requests r JOIN users u ON u.id=r.user_id WHERE r.id=?").get(row.request_id);
        const status = db.prepare("SELECT status FROM requests WHERE id=?").get(row.request_id).status;
        const now = new Date().toISOString();
        const messageId = randomUUID();
        db.prepare("INSERT INTO messages (id,request_id,user_id,body,created_at,internal) VALUES (?,?,?,?,?,0)").run(
          messageId, row.request_id, owner.id, body, now,
        );
        saveFiles(files, row.request_id, owner, 0, messageId);
        history(row.request_id, owner, "Mensagem enviada pelo colaborador (WhatsApp)", "message", { attachments: files.length });
        if (status === "Aguardando colaborador") {
          db.prepare("UPDATE requests SET status='Em atendimento' WHERE id=?").run(row.request_id);
          history(row.request_id, owner, "Informações enviadas pelo colaborador", "status", {
            from: "Aguardando colaborador",
            to: "Em atendimento",
          });
        }
        db.prepare("UPDATE requests SET updated_at=? WHERE id=?").run(now, row.request_id);
        saveWhatsappState(conversationId, step.state, phone, row.request_id);
      });
      return;
    }
    const theme = THEMES[step.state.theme ?? 0];
    const openedAt = Date.now();
    const dueMs = businessDeadline(openedAt, config.deadlineHours, config.holidays);
    const due = new Date(dueMs).toISOString();
    const created = transaction(() => {
      const owner = whatsappOwner(phone, payload.sender?.name);
      const request = insertRequest(owner, theme.serviceId, theme.title, body, {
        Origem: "WhatsApp",
        Telefone: formatPhone(phone.replace(/\D/g, "")),
      });
      db.prepare("UPDATE requests SET due_at=?,chatwoot_conversation_id=? WHERE id=?").run(due, conversationId, request.id);
      saveFiles(files, request.id, owner);
      history(request.id, owner, "Solicitação aberta pelo atendente virtual do WhatsApp", "created", {
        origem: "whatsapp",
        conversa: conversationId,
        prazo: due,
      });
      saveWhatsappState(conversationId, step.state, phone, request.id);
      return request;
    });
    emailNewRequest(created.id);
    await sendChatwootMessage(
      conversationId,
      ticketOpenedText(created.protocol, step.state.theme ?? 0, {
        dueMs,
        offHours: !withinOfficeHours(openedAt, config),
        officeHours: config.officeHours,
      }),
    );
    return;
  }
  saveWhatsappState(conversationId, step.state, phone, null);
  if (step.reply) await sendChatwootMessage(conversationId, step.reply);
}
// --- Mensagens do WhatsApp: fila por conversa, deduplicação e recuperação --------
function markWhatsappSeen(payload) {
  if (!Number.isInteger(Number(payload.id)) || !payload.id) return true;
  return (
    db
      .prepare("INSERT OR IGNORE INTO whatsapp_seen (message_id,conversation_id,seen_at) VALUES (?,?,?)")
      .run(Number(payload.id), String(payload.conversation?.id ?? ""), new Date().toISOString()).changes > 0
  );
}
/** Processa em ordem as mensagens de cada conversa (uma de cada vez). */
function enqueueWhatsapp(payload, config) {
  const conversationId = payload.conversation.id;
  const previous = chatwootQueues.get(conversationId) || Promise.resolve();
  const next = previous
    .then(() => processWhatsappRh(payload, config))
    .catch((e) => console.error(`WhatsApp RH conversa ${conversationId}:`, e.message))
    .finally(() => {
      if (chatwootQueues.get(conversationId) === next) chatwootQueues.delete(conversationId);
    });
  chatwootQueues.set(conversationId, next);
  return next;
}
const recoveryState = { enabled: false, lastRun: null, lastRecovered: 0, lastError: null };
/** Busca no Chatwoot o que chegou enquanto a central estava fora (no início e a cada 5 min). */
async function recoverWhatsapp() {
  const chatwoot = chatwootConfiguration();
  recoveryState.enabled = Boolean(chatwoot.enabled && chatwoot.apiToken);
  if (!recoveryState.enabled) return 0;
  const config = whatsappConfig();
  let start = db.prepare("SELECT value FROM settings WHERE key='whatsapp_recovery_since'").get()?.value;
  if (!start) {
    // Primeira vez: começa a partir de agora (o histórico antigo nunca é reprocessado).
    start = String(Math.floor(Date.now() / 1000));
    db.prepare("INSERT INTO settings (key,value) VALUES ('whatsapp_recovery_since',?)").run(start);
  }
  const since = Math.max(Number(start), Math.floor(Date.now() / 1000) - 3 * 86400);
  try {
    const recovered = await recoverMissed({
      inboxId: config.inboxId,
      since,
      seen: (id) => Boolean(db.prepare("SELECT 1 FROM whatsapp_seen WHERE message_id=?").get(Number(id))),
      listConversations: (page) => listInboxConversations(config.inboxId, page),
      listMessages: (id) => listConversationMessages(id),
      log: console.log,
      process: async (payload) => {
        const phone = payload.sender?.phone_number || payload.conversation?.meta?.sender?.phone_number;
        if (!phoneAllowed(phone, config)) return;
        if (!markWhatsappSeen(payload)) return;
        await enqueueWhatsapp(payload, config);
      },
    });
    Object.assign(recoveryState, { lastRun: new Date().toISOString(), lastRecovered: recovered, lastError: null });
    return recovered;
  } catch (e) {
    Object.assign(recoveryState, { lastRun: new Date().toISOString(), lastError: e.message });
    console.error("[recuperação] WhatsApp:", e.message);
    return 0;
  }
}

// --- Entrega das respostas do RH no WhatsApp ----------------------------------
// Tenta na hora; se falhar, tenta de novo sozinho (1, 2, 5, 10, 20, 30, 60 min).
// Depois de 8 tentativas fica "não entregue" e o RH pode mandar de novo no chamado.
const RETRY_MINUTES = [1, 2, 5, 10, 20, 30, 60];
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
const delivering = new Set();
async function deliverToWhatsapp(messageId) {
  if (delivering.has(messageId)) return false;
  delivering.add(messageId);
  try {
    const m = db
      .prepare(
        "SELECT m.id,m.body,m.request_id,m.wa_attempts,u.name author,r.chatwoot_conversation_id FROM messages m JOIN users u ON u.id=m.user_id JOIN requests r ON r.id=m.request_id WHERE m.id=?",
      )
      .get(messageId);
    if (!m?.chatwoot_conversation_id) return false;
    const files = db.prepare("SELECT name,type,content FROM attachments WHERE message_id=? ORDER BY created_at").all(messageId);
    const attempts = m.wa_attempts + 1;
    try {
      await sendMessageWithFiles(m.chatwoot_conversation_id, `${m.body}\n— ${m.author}, RH Frizelo`, files);
      db.prepare("UPDATE messages SET wa_status='enviado',wa_attempts=?,wa_error=NULL,wa_next_at=NULL WHERE id=?").run(attempts, messageId);
      return true;
    } catch (e) {
      const final = attempts >= MAX_ATTEMPTS;
      const next = final ? null : new Date(Date.now() + RETRY_MINUTES[attempts - 1] * 60000).toISOString();
      db.prepare("UPDATE messages SET wa_status=?,wa_attempts=?,wa_error=?,wa_next_at=? WHERE id=?").run(
        final ? "nao_entregue" : "falhou",
        attempts,
        String(e.message).slice(0, 300),
        next,
        messageId,
      );
      if (attempts === 1 || final) {
        const author = db.prepare("SELECT u.id,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?").get(messageId);
        transaction(() =>
          history(
            m.request_id,
            author,
            final ? "Resposta NÃO entregue no WhatsApp depois de várias tentativas" : "Falha ao enviar a resposta pelo WhatsApp (nova tentativa automática)",
            "whatsapp_error",
            { erro: e.message, tentativas: attempts },
            1,
          ),
        );
      }
      return false;
    }
  } finally {
    delivering.delete(messageId);
  }
}
async function retryWhatsappDeliveries() {
  const due = db
    .prepare("SELECT id FROM messages WHERE wa_status IN ('pendente','falhou') AND (wa_next_at IS NULL OR wa_next_at<=?) ORDER BY created_at LIMIT 20")
    .all(new Date().toISOString());
  for (const { id } of due) await deliverToWhatsapp(id);
}

// --- Avisos automáticos -------------------------------------------------------
const LEVEL_RANK = { verde: 0, amarelo: 1, laranja: 2, vermelho: 3 };
/** Dados mínimos do chamado para o e-mail (sem o texto do chamado). */
function alertRequest(id) {
  const row = db
    .prepare(
      "SELECT r.protocol,r.subject,r.due_at,r.fields,u.name requester_name FROM requests r JOIN users u ON u.id=r.user_id WHERE r.id=?",
    )
    .get(id);
  if (!row) return null;
  const whatsapp = JSON.parse(row.fields || "{}").Origem === "WhatsApp";
  return {
    ...row,
    requester_name: whatsapp ? row.requester_name.replace(/^WhatsApp\s+/i, "") : row.requester_name,
    channel: whatsapp ? "WhatsApp" : "Portal",
  };
}
function emailNewRequest(id) {
  const request = alertRequest(id);
  if (request) void emailAlerts.notify(request, "novo");
}
/** Conversa do WhatsApp ativa para este chamado (o atendente virtual cuida dela). */
const whatsappConversation = (request) =>
  request.chatwoot_conversation_id &&
  db.prepare("SELECT 1 FROM whatsapp_rh WHERE conversation_id=?").get(String(request.chatwoot_conversation_id))
    ? String(request.chatwoot_conversation_id)
    : null;
/**
 * A cada 5 minutos: e-mail quando um chamado entra em laranja ou vermelho, e
 * lembrete no WhatsApp para quem não respondeu o RH em 2 dias úteis.
 */
async function automaticAlerts(now = Date.now()) {
  const { holidays, officeHours, firstResponseHours } = whatsappConfig();
  const open = db
    .prepare(
      `SELECT r.id,r.protocol,r.created_at,r.due_at,r.alert_level,r.status,r.awaiting_since,r.reminder_sent_at,r.chatwoot_conversation_id,r.first_response_alerted,
         (SELECT MIN(m.created_at) FROM messages m JOIN users mu ON mu.id=m.user_id WHERE m.request_id=r.id AND m.internal=0 AND mu.role='rh') first_response_at
       FROM requests r WHERE r.status<>'Concluída'`,
    )
    .all();
  for (const request of open) {
    // 1ª resposta estourou o prazo sem nenhuma resposta do RH: e-mail uma vez.
    if (!request.first_response_alerted && !request.first_response_at) {
      const first = firstResponseStatus(request.created_at, null, now, { hours: firstResponseHours, officeHours, holidays });
      if (first?.level === "atrasado") {
        db.prepare("UPDATE requests SET first_response_alerted=1 WHERE id=?").run(request.id);
        const data = alertRequest(request.id);
        if (data) void emailAlerts.notify(data, "primeira");
      }
    }
    const sla = request.due_at ? slaStatus(request.created_at, request.due_at, now, holidays) : null;
    const rank = sla ? LEVEL_RANK[sla.level] : -1;
    if (request.alert_level === null) {
      // Primeira verificação deste chamado: só memoriza (não avisa do que já estava assim).
      db.prepare("UPDATE requests SET alert_level=? WHERE id=?").run(rank, request.id);
    } else if (rank > request.alert_level) {
      db.prepare("UPDATE requests SET alert_level=? WHERE id=?").run(rank, request.id);
      if (rank >= LEVEL_RANK.laranja) {
        const data = alertRequest(request.id);
        if (data) void emailAlerts.notify(data, sla.level);
      }
    }
    if (
      request.status === "Aguardando colaborador" &&
      request.awaiting_since &&
      !request.reminder_sent_at &&
      businessElapsed(Date.parse(request.awaiting_since), now, holidays) >= 48 * 3600000 &&
      withinOfficeHours(now, { officeHours, holidays })
    ) {
      const conversationId = whatsappConversation(request);
      if (!conversationId) continue;
      db.prepare("UPDATE requests SET reminder_sent_at=? WHERE id=?").run(new Date(now).toISOString(), request.id);
      try {
        await sendChatwootMessage(conversationId, awaitingReminderText(request.protocol));
        const owner = db.prepare("SELECT u.id,u.name FROM requests r JOIN users u ON u.id=r.user_id WHERE r.id=?").get(request.id);
        transaction(() => history(request.id, owner, "Lembrete enviado ao colaborador pelo WhatsApp (2 dias sem resposta)", "reminder", {}, 1));
      } catch (e) {
        console.error(`Lembrete do chamado ${request.protocol}:`, e.message);
      }
    }
  }
}

/** Chamado do WhatsApp concluído na central: avisa o colaborador e encerra a conversa. */
async function closeWhatsappTicket(request) {
  const conversationId = request.chatwoot_conversation_id;
  const row = conversationId && db.prepare("SELECT request_id,stage FROM whatsapp_rh WHERE conversation_id=?").get(String(conversationId));
  if (!row) return;
  // Só pergunta a nota e encerra a conversa se o colaborador não estiver no meio
  // de outro assunto (menu, holerite...).
  const survey = row.request_id === request.id && row.stage === "chamado";
  await sendChatwootMessage(conversationId, ticketClosedText(request.protocol, { survey }));
  if (survey) {
    db.prepare("UPDATE whatsapp_rh SET stage='pesquisa',updated_at=? WHERE conversation_id=?").run(
      new Date().toISOString(),
      String(conversationId),
    );
    await resolveConversation(conversationId);
  }
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
        // Espelho no chamado: resposta pública de atendente e conversa resolvida.
        if (
          payload.event === "message_created" &&
          payload.message_type === "outgoing" &&
          !payload.private &&
          payload.sender?.type === "user" &&
          payload.conversation?.id
        ) {
          transaction(() =>
            recordAgentReply(db, history, payload.conversation.id, payload.sender.name, payload.content),
          );
          return json(res, 200, { ok: true, mirrored: true });
        }
        if (
          (payload.event === "conversation_resolved" ||
            (payload.event === "conversation_status_changed" && payload.status === "resolved")) &&
          payload.id
        ) {
          // Conversa do WhatsApp RH resolvida no Chatwoot: o chamado é concluído e o colaborador avisado.
          const whatsappOpen = db.prepare("SELECT 1 FROM whatsapp_rh WHERE conversation_id=?").get(String(payload.id))
            ? db
                .prepare("SELECT protocol,chatwoot_conversation_id FROM requests WHERE chatwoot_conversation_id=? AND status<>'Concluída'")
                .all(String(payload.id))
            : [];
          transaction(() =>
            closeFromChatwoot(db, history, payload.id, payload.meta?.assignee?.name),
          );
          for (const request of whatsappOpen) {
            db.prepare("UPDATE whatsapp_rh SET stage='encerrado',updated_at=? WHERE conversation_id=?").run(
              new Date().toISOString(),
              String(payload.id),
            );
            await sendChatwootMessage(payload.id, ticketClosedText(request.protocol)).catch((e) =>
              console.error(`WhatsApp RH conversa ${payload.id}:`, e.message),
            );
          }
          return json(res, 200, { ok: true, mirrored: true });
        }
        // WhatsApp do RH: atendente virtual da central (menu -> chamado). Trata toda
        // mensagem recebida da caixa, em qualquer status, porque depois de aberto o
        // chamado as mensagens do colaborador continuam entrando nele.
        const whatsapp = whatsappConfig();
        if (
          payload.event === "message_created" &&
          payload.message_type === "incoming" &&
          !payload.private &&
          payload.conversation?.id &&
          Number(payload.inbox?.id ?? payload.conversation?.inbox_id) === whatsapp.inboxId
        ) {
          const conversationId = payload.conversation.id;
          const phone = payload.sender?.phone_number || payload.conversation?.meta?.sender?.phone_number;
          if (!phoneAllowed(phone, whatsapp)) {
            // Modo teste: contato fora da lista vai direto para as atendentes no Chatwoot.
            if (payload.conversation.status === "pending") await handToHuman(conversationId).catch(() => {});
            return json(res, 200, { ok: true, skipped: true });
          }
          if (!chatAllowed(`wa-${conversationId}`)) return json(res, 200, { ok: true, skipped: true });
          // Mesma mensagem duas vezes (reenvio do Chatwoot ou recuperação): só a primeira conta.
          if (!markWhatsappSeen(payload)) return json(res, 200, { ok: true, duplicate: true });
          enqueueWhatsapp(payload, whatsapp);
          return json(res, 200, { ok: true, accepted: true });
        }
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
        if (pathname === "/api/whatsapp/status" && req.method === "GET") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          return json(res, 200, { ...wahaWatchdog.getHealth(), recovery: recoveryState });
        }
        if (pathname === "/api/whatsapp/documents" && req.method === "GET") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 3650);
          const since = new Date(Date.now() - days * 86400000).toISOString();
          return json(res, 200, {
            documents: db
              .prepare(
                `SELECT d.id,d.kind,d.month,d.status,d.created_at,d.numcad,d.phone,
                        coalesce(d.name,(SELECT u.name FROM requests r JOIN users u ON u.id=r.user_id WHERE r.chatwoot_conversation_id=d.conversation_id ORDER BY r.created_at DESC LIMIT 1)) name
                 FROM whatsapp_documents d WHERE d.created_at>=? ORDER BY d.id DESC LIMIT 1000`,
              )
              .all(since)
              .map((d) => ({ ...d, phone: formatPhone(String(d.phone || "").replace(/\D/g, "")) })),
          });
        }
        const templateMatch = pathname.match(/^\/api\/reply-templates(?:\/(\d+))?$/);
        if (templateMatch) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          if (!templateMatch[1] && req.method === "GET")
            return json(res, 200, { templates: db.prepare("SELECT id,title,body FROM reply_templates ORDER BY title COLLATE NOCASE").all() });
          if (!templateMatch[1] && req.method === "POST") {
            const input = await body(req);
            const title = text(input.title, 80, "título");
            const content = text(input.body, 4000, "texto");
            const result = db
              .prepare("INSERT INTO reply_templates (title,body,created_by,created_at) VALUES (?,?,?,?)")
              .run(title, content, user.id, new Date().toISOString());
            return json(res, 201, { template: { id: Number(result.lastInsertRowid), title, body: content } });
          }
          if (templateMatch[1] && req.method === "DELETE") {
            db.prepare("DELETE FROM reply_templates WHERE id=?").run(Number(templateMatch[1]));
            return json(res, 200, { ok: true });
          }
          fail(405, "Método não permitido.");
        }
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
          emailNewRequest(id);
          return json(res, 201, {
            request: list(user).find((r) => r.id === id),
          });
        }
        const resend = pathname.match(/^\/api\/requests\/([a-f0-9-]+)\/messages\/([a-f0-9-]+)\/resend$/);
        if (resend && req.method === "POST") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const row = db.prepare("SELECT id,wa_status FROM messages WHERE id=? AND request_id=?").get(resend[2], resend[1]);
          if (!row || !row.wa_status) fail(404, "Mensagem não encontrada.");
          if (row.wa_status === "enviado") return json(res, 200, { ok: true, status: "enviado" });
          db.prepare("UPDATE messages SET wa_attempts=0 WHERE id=?").run(row.id);
          const ok = await deliverToWhatsapp(row.id);
          return json(res, 200, { ok, status: ok ? "enviado" : "falhou" });
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
                  "SELECT id,name,type,length(content) size,created_at,internal,message_id FROM attachments WHERE request_id=? AND (internal=0 OR ?=1) ORDER BY created_at",
                )
                .all(id, user.role === "rh" ? 1 : 0),
              // RH: outros chamados da mesma pessoa e documentos que ela recebeu pelo WhatsApp.
              ...(user.role === "rh"
                ? {
                    related: {
                      requests: db
                        .prepare(
                          "SELECT id,protocol,subject,status,created_at,rating FROM requests WHERE user_id=? AND id<>? ORDER BY created_at DESC LIMIT 20",
                        )
                        .all(request.user_id, id),
                      documents: request.chatwoot_conversation_id
                        ? db
                            .prepare(
                              "SELECT id,kind,month,status,created_at FROM whatsapp_documents WHERE conversation_id=? ORDER BY id DESC LIMIT 20",
                            )
                            .all(String(request.chatwoot_conversation_id))
                        : [],
                    },
                  }
                : {}),
            });
          }
          if (match[2] && req.method === "POST") {
            if (request.status === "Concluída")
              fail(
                409,
                "Esta solicitação está concluída. Abra uma nova solicitação, se necessário.",
              );
            const input = await body(req);
            const attachments = files(input.attachments);
            // Só anexo, sem texto: vale para o RH mandar um documento ao colaborador.
            const message = text(input.body, 10000, "mensagem", attachments.length === 0) || "📎 Segue o anexo.";
            if (input.internal && user.role !== "rh")
              fail(403, "Notas internas são exclusivas do RH.");
            const internal = input.internal ? 1 : 0;
            const messageId = randomUUID();
            // Resposta pública do RH num chamado do WhatsApp: sai também no WhatsApp do colaborador.
            const toWhatsapp = user.role === "rh" && !internal && Boolean(whatsappConversation(request));
            transaction(() => {
              db.prepare(
                "INSERT INTO messages (id,request_id,user_id,body,created_at,internal,wa_status) VALUES (?,?,?,?,?,?,?)",
              ).run(
                messageId,
                id,
                user.id,
                message,
                new Date().toISOString(),
                internal,
                toWhatsapp ? "pendente" : null,
              );
              saveFiles(attachments, id, user, internal, messageId);
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
            if (toWhatsapp && !(await deliverToWhatsapp(messageId)))
              return json(res, 201, {
                ok: true,
                warning: "Resposta salva, mas o WhatsApp não respondeu agora. A central vai tentar enviar de novo sozinha.",
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
            // Aguardando colaborador: o WhatsApp avisa que o RH precisa de uma resposta;
            // depois de 2 dias úteis sem resposta, sai um lembrete (automaticAlerts).
            if (input.status === "Aguardando colaborador" && request.status !== "Aguardando colaborador") {
              db.prepare("UPDATE requests SET awaiting_since=?,reminder_sent_at=NULL WHERE id=?").run(new Date().toISOString(), id);
              const conversationId = whatsappConversation(request);
              if (conversationId)
                try {
                  await sendChatwootMessage(conversationId, awaitingEmployeeText(request.protocol));
                } catch (e) {
                  transaction(() =>
                    history(id, user, "Falha ao avisar o colaborador pelo WhatsApp", "whatsapp_error", { erro: e.message }, 1),
                  );
                  return json(res, 200, {
                    ok: true,
                    warning: "Status alterado, mas não foi possível avisar o colaborador pelo WhatsApp.",
                  });
                }
            }
            // Concluído na central: o colaborador do WhatsApp recebe o aviso e a conversa é encerrada.
            if (input.status === "Concluída" && request.status !== "Concluída") {
              try {
                await closeWhatsappTicket(request);
              } catch (e) {
                transaction(() =>
                  history(id, user, "Falha ao avisar o colaborador pelo WhatsApp", "whatsapp_error", { erro: e.message }, 1),
                );
                return json(res, 200, {
                  ok: true,
                  warning: "Chamado concluído, mas não foi possível avisar o colaborador pelo WhatsApp.",
                });
              }
            }
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
          // ?inline=1: imagem, áudio, vídeo e PDF abrem na própria central (o resto sempre baixa).
          const inline = url.searchParams.get("inline") === "1" && INLINE_TYPES.test(file.type);
          const content = Buffer.from(file.content);
          const headers = {
            "Content-Type": file.type,
            "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
          };
          // Áudio e vídeo pedem pedaços (Range) para tocar e avançar.
          const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
          if (range && (range[1] || range[2])) {
            const size = content.length;
            let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
            let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            if (start >= size || start > end) {
              res.writeHead(416, { "Content-Range": `bytes */${size}` });
              return res.end();
            }
            res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
            return res.end(content.subarray(start, end + 1));
          }
          res.writeHead(200, { ...headers, "Content-Length": content.length });
          return res.end(content);
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
// Vigia da sessão do WhatsApp (WAHA): reinicia sozinho quando ela trava.
const wahaWatchdog = startWahaWatchdog({ chatwootBase: chatwootConfiguration().base });
const emailAlerts = createEmailAlerts();
console.log(emailAlerts.enabled ? "Avisos por e-mail ligados." : "Avisos por e-mail desligados (configure SMTP_HOST e ALERTA_EMAILS no .env.local).");
if (process.env.CENTRAL_AVISOS !== "off") {
  const alertTimer = setInterval(() => void automaticAlerts().catch((e) => console.error("Avisos automáticos:", e.message)), 5 * 60000);
  alertTimer.unref?.();
  setTimeout(() => void automaticAlerts().catch((e) => console.error("Avisos automáticos:", e.message)), 20000).unref?.();
  // Respostas do RH que não saíram no WhatsApp: tenta de novo a cada minuto.
  setInterval(() => void retryWhatsappDeliveries().catch((e) => console.error("Reenvio WhatsApp:", e.message)), 60000).unref?.();
  // Recupera mensagens do WhatsApp perdidas enquanto a central esteve fora.
  setTimeout(() => void recoverWhatsapp(), 8000).unref?.();
  setInterval(() => void recoverWhatsapp(), 5 * 60000).unref?.();
}
console.log(
  wahaWatchdog.getHealth().enabled
    ? "Vigia do WhatsApp (WAHA) ligado."
    : "Vigia do WhatsApp (WAHA) desligado: defina WAHA_API_KEY no .env.local.",
);
