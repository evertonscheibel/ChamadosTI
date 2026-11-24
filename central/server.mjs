import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { db, verifyPassword, hashPassword } from "./database.mjs";
import { services, statuses } from "./catalog.mjs";
import { configuration, links, consult, warmUp as warmUpSenior, seniorHealth } from "./senior.mjs";
import { createTiAlerts, backupProblem } from "./ti-alerts.mjs";
import { extraction, startExtraction, csv } from "./senior-export.mjs";
import { synchronization, startSynchronization } from "./senior-import.mjs";
import { managementCsv } from "./management-export.mjs";
import { managementReport, managementRows, indicatorRows } from "./indicators.mjs";
import { managerConfig, isManager, managementPdf, monthlyReportDue, monthLabel, localMidnight, createManagerMailer } from "./managers.mjs";
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
  escalateToHuman,
  syncTicket,
  addPrivateNote,
  conversationStatus,
} from "./chatwoot-client.mjs";
import { recoverMissed } from "./whatsapp-recovery.mjs";
import { claimMessage, ignoreMessage, isSettled, hold, runTracked, rescueStuck, deliveryStats } from "./whatsapp-delivery.mjs";
import { configuration as chatwootConfiguration } from "./chatwoot-client.mjs";
import { startWahaWatchdog } from "./waha-watchdog.mjs";
import { allowedOrigins } from "./origins.mjs";
import { createEmailAlerts, emailConfig } from "./email-alerts.mjs";
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
  digestDay,
  businessElapsed,
  awaitingEmployeeText,
  awaitingReminderText,
  firstResponseStatus,
  chatwootTicket,
  ackText,
  goodbyeText,
  endedText,
  cancelConfirmText,
  keptText,
  cancelledText,
  ticketsClosedText,
} from "./whatsapp-rh.mjs";
import { holeritePdf, espelhoPdf } from "./senior-documents.mjs";
import { situationNames } from "./senior.mjs";
import { recordAgentReply, closeFromChatwoot } from "./chatwoot-sync.mjs";

initializeLinks(db);

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.CENTRAL_PORT || 45873);
const origin = `http://127.0.0.1:${port}`;
// Endereços de onde o navegador pode enviar (local + CENTRAL_URL/CENTRAL_ORIGINS, ex.: http://10.1.1.53:45873).
const acceptedOrigins = allowedOrigins(port);
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
const managers = managerConfig();
/** Gestores = CENTRAL_GESTORES (servidor) + contas marcadas na tela "Equipe do RH". */
const managerSettings = () => ({
  ...managers,
  identifiers: [
    ...managers.identifiers,
    ...db.prepare("SELECT identifier FROM users WHERE role='rh' AND manager=1").all().map((r) => r.identifier),
  ],
});
// Equipe do RH = pessoas com CPF; ficam de fora as contas técnicas, de teste e de demonstração.
const RH_TEAM = "u.role='rh' AND u.id NOT LIKE 'demo-%' AND length(u.identifier)=11 AND u.identifier NOT GLOB '*[^0-9]*'";
const maskCpf = (cpf) => `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`;
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  role: user.role,
  // Gestor do atendimento: vê os indicadores da equipe toda (managers.mjs).
  manager: isManager(user, managerSettings()),
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
       (SELECT MAX(m.created_at) FROM messages m WHERE m.request_id=r.id AND m.internal=0) last_message_at,
       (SELECT json_object('id',h.id,'by_id',h.user_id,'by_name',h.actor_name) FROM history h WHERE h.request_id=r.id AND h.kind='transfer' ORDER BY h.id DESC LIMIT 1) last_transfer
     FROM requests r JOIN users u ON u.id=r.user_id LEFT JOIN users a ON a.id=r.assigned_to ${clause} ORDER BY r.created_at DESC`,
  );
  const { holidays, officeHours, firstResponseHours } = whatsappConfig();
  const now = Date.now();
  return (user.role === "rh" ? statement.all() : statement.all(user.id)).map(
    ({ last_role, last_transfer, ...r }) => ({
      ...r,
      // Última transferência (só o RH vê): o painel avisa quem recebeu o chamado.
      transfer: user.role === "rh" && last_transfer ? JSON.parse(last_transfer) : undefined,
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
      console.warn(`[whatsapp] anexo ${a.file_type || "?"} não baixado: ${e.message}`);
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
// Falha passageira da Senior (rede, partida a frio): espera um pouco e tenta mais uma vez
// antes de devolver o erro ao colaborador.
async function withSeniorRetry(fn, wait = 15000) {
  try {
    return await fn();
  } catch (e) {
    if (!e?.transient) throw e;
    console.warn(`[senior] falha passageira, nova tentativa em ${wait / 1000} s: ${e.message}`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return fn();
  }
}
// Identidade confirmada na Senior por conversa (só em memória, vale 30 min).
const whatsappIdentities = new Map();
const IDENTITY_TTL = 30 * 60000;
async function verifyWhatsappIdentity(conversationId, step, phone) {
  const { cpf, matricula, name } = step.verify;
  const attempts = (step.state.data?.attempts || 0) + 1;
  let candidate = null;
  try {
    candidate = await withSeniorRetry(() => lookupCandidate({ cpf, matricula }));
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
  await sendChatwootMessage(conversationId, "Consultando a Senior… costuma levar alguns segundos, mas pode chegar a 2 minutos. ⏳");
  let result;
  try {
    result = await withSeniorRetry(() => consult(candidateUser(person), kind, month));
  } catch (e) {
    if (e?.transient && scheduleLateDocument(conversationId, person, kind, month, audit)) {
      audit("aguardando senior");
      return `A Senior está lenta agora. Assim que ela responder eu te envio o documento aqui, não precisa pedir de novo. 🙂
${anotherMonthText}`;
    }
    audit(`erro: ${e.message}`.slice(0, 200));
    return `Não consegui consultar a Senior agora (${e.message}). Tente de novo em alguns minutos.
${anotherMonthText}`;
  }
  return (await sendWhatsappDocument(conversationId, result, person, kind, month, audit)) ?? anotherMonthText;
}
/** Envia o PDF; devolve um texto quando não há dados (senão null). */
async function sendWhatsappDocument(conversationId, result, person, kind, month, audit) {
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
  return null;
}
// Pedidos que a Senior não respondeu: o bot tenta de novo sozinho a cada 3 min por até 1 h e
// entrega quando conseguir. Fica só em memória (o vínculo já confirmado não vai para o banco).
const lateDocuments = new Map();
const LATE_WAIT = 3 * 60000;
const LATE_TRIES = 20;
function scheduleLateDocument(conversationId, person, kind, month, audit) {
  const key = `${conversationId}:${kind}:${month}`;
  if (lateDocuments.has(key)) return true;
  if (lateDocuments.size >= 50) return false;
  const attempt = async (tries) => {
    try {
      const result = await consult(candidateUser(person), kind, month);
      lateDocuments.delete(key);
      const text = await sendWhatsappDocument(conversationId, result, person, kind, month, audit);
      if (text) await sendChatwootMessage(conversationId, text);
    } catch (e) {
      if (e?.transient && tries < LATE_TRIES) {
        lateDocuments.set(key, setTimeout(() => void attempt(tries + 1), LATE_WAIT));
        return;
      }
      lateDocuments.delete(key);
      audit(`erro: ${e.message}`.slice(0, 200));
      const label = kind === "holerite" ? "holerite" : "espelho de ponto";
      await sendChatwootMessage(conversationId, `Não consegui buscar seu ${label} na Senior. Envie **menu** e escolha falar com o RH, que eles te enviam.`).catch(() => {});
    }
  };
  lateDocuments.set(key, setTimeout(() => void attempt(1), LATE_WAIT));
  return true;
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
  // A resposta da pesquisa pode chegar numa conversa nova do Chatwoot (a do chamado já estava
  // resolvida): a pesquisa pendente do mesmo telefone, dos últimos 3 dias, vale para esta mensagem.
  const pendingSurvey =
    phone && (!row || state?.stage === "encerrado")
      ? db
          .prepare(
            `SELECT w.* FROM whatsapp_rh w JOIN requests r ON r.id=w.request_id
             WHERE w.phone=? AND w.conversation_id<>? AND w.stage='pesquisa' AND r.status='Concluída' AND w.updated_at>=?
             ORDER BY w.updated_at DESC LIMIT 1`,
          )
          .get(phone, conversationId, new Date(Date.now() - 3 * 86400000).toISOString())
      : null;
  if (pendingSurvey) state = { stage: "pesquisa", theme: pendingSurvey.theme, invalid: 0, data: {} };
  const surveyRow = pendingSurvey || row;
  const step = nextStep(state, text, {
    hasAttachment: attachments.length > 0,
    hasAudio: attachments.some((a) => a.file_type === "audio"),
  });
  // Qualquer resposta encerra a pesquisa da conversa antiga (só se avalia uma vez).
  if (pendingSurvey)
    db.prepare("UPDATE whatsapp_rh SET stage='encerrado',updated_at=? WHERE conversation_id=?").run(
      new Date().toISOString(),
      pendingSurvey.conversation_id,
    );
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
      const owner = db.prepare("SELECT u.id,u.name FROM requests r JOIN users u ON u.id=r.user_id WHERE r.id=?").get(surveyRow.request_id);
      db.prepare("UPDATE requests SET rating=?,rated_at=? WHERE id=? AND status='Concluída'").run(step.rate, new Date().toISOString(), surveyRow.request_id);
      history(surveyRow.request_id, owner, `Atendimento avaliado pelo colaborador: ${step.rate} de 5`, "rating", { nota: step.rate });
      afterTicketClosed(conversationId, phone, step.state);
    });
    await sendChatwootMessage(conversationId, ratingThanksText(step.rate));
    // A nota reabre a conversa no Chatwoot; o atendimento já terminou, então volta a resolvida.
    await resolveWhenDone(conversationId);
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
  if (step.goodbye) {
    // "obrigado" depois de encerrado: despedida e a conversa (reaberta pela mensagem) volta a resolvida.
    saveWhatsappState(conversationId, step.state, phone);
    await sendChatwootMessage(conversationId, step.ended ? endedText : goodbyeText);
    await resolveWhenDone(conversationId);
    return;
  }
  const protocol = row?.request_id ? db.prepare("SELECT protocol FROM requests WHERE id=?").get(row.request_id)?.protocol : null;
  if (protocol && (step.remind || step.ack || step.silent || step.confirmCancel || step.kept)) {
    saveWhatsappState(conversationId, step.state, phone);
    if (step.remind) await sendChatwootMessage(conversationId, ticketOpenReminderText(protocol));
    if (step.ack) await sendChatwootMessage(conversationId, ackText(protocol));
    if (step.confirmCancel) await sendChatwootMessage(conversationId, cancelConfirmText(protocol));
    if (step.kept) await sendChatwootMessage(conversationId, keptText(protocol));
    return;
  }
  if (step.cancel && row?.request_id) {
    const cancelled = transaction(() => {
      const request = db.prepare("SELECT id,protocol,status,due_at,user_id FROM requests WHERE id=?").get(row.request_id);
      if (!request || request.status === "Concluída") return null;
      const owner = db.prepare("SELECT id,name FROM users WHERE id=?").get(request.user_id);
      const now = new Date().toISOString();
      db.prepare("UPDATE requests SET status='Concluída',closed_at=?,closed_due_at=?,updated_at=? WHERE id=?").run(
        now, request.due_at ?? null, now, request.id,
      );
      history(request.id, owner, "Chamado cancelado pelo colaborador (WhatsApp)", "status", {
        from: request.status,
        to: "Concluída",
        cancelado: true,
      });
      afterTicketClosed(conversationId, phone, step.state);
      return request;
    });
    if (!cancelled) {
      saveWhatsappState(conversationId, step.state, phone);
      return;
    }
    await sendChatwootMessage(conversationId, cancelledText(cancelled.protocol));
    await addPrivateNote(conversationId, `O colaborador cancelou o chamado ${cancelled.protocol} pelo WhatsApp.`).catch((e) =>
      console.error(`Nota do cancelamento ${cancelled.protocol}:`, e.message),
    );
    syncChatwootTicket(cancelled.id);
    await resolveWhenDone(conversationId);
    return;
  }
  if (step.append || step.open) {
    const { files, notes } = await whatsappFiles(attachments);
    const onlyAudio = !text.trim() && files.length > 0 && files.every((f) => f.type.startsWith("audio/"));
    const body =
      [text.trim(), ...notes].filter(Boolean).join("\n") ||
      (onlyAudio ? "🎤 Áudio enviado pelo WhatsApp (ouça no anexo)" : "(anexo enviado pelo WhatsApp)");
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
    syncChatwootTicket(created.id);
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
// Ids de mensagens na fila desta execução da central (ver whatsapp-delivery.mjs).
const whatsappInFlight = new Set();
/** Falso se a mensagem já foi (ou está sendo) tratada. */
function markWhatsappSeen(payload) {
  return claimMessage(db, whatsappInFlight, payload);
}
/** Processa em ordem as mensagens de cada conversa (uma de cada vez). Erro -> atendente. */
function enqueueWhatsapp(payload, config) {
  const conversationId = payload.conversation.id;
  const release = hold(whatsappInFlight, payload);
  const previous = chatwootQueues.get(conversationId) || Promise.resolve();
  const next = previous
    .then(() =>
      runTracked(db, {
        payload,
        work: () => processWhatsappRh(payload, config),
        notify: escalateToHuman,
        log: console.error,
      }),
    )
    .catch((e) => console.error(`WhatsApp RH conversa ${conversationId}:`, e.message))
    .finally(() => {
      release();
      if (chatwootQueues.get(conversationId) === next) chatwootQueues.delete(conversationId);
    });
  chatwootQueues.set(conversationId, next);
  return next;
}
const recoveryState = { enabled: false, lastRun: null, lastRecovered: 0, lastRescued: 0, lastError: null };
/** Busca no Chatwoot o que chegou enquanto a central estava fora (no início e a cada 5 min). */
/**
 * Conversa parada há 24 h sem chamado (no menu, no meio do assunto, no holerite...)
 * volta ao início e é resolvida no Chatwoot, para não acumular pendentes. Só mexe
 * em conversa que está com o bot ("pending"): se uma atendente assumiu, fica como está.
 * Pesquisa sem nota e confirmação de cancelamento sem resposta também expiram.
 */
async function closeIdleWhatsapp(now = Date.now()) {
  const limit = new Date(now - 24 * 3600000).toISOString();
  const rows = db
    .prepare(
      `SELECT w.conversation_id,w.stage,w.request_id,r.status request_status FROM whatsapp_rh w
       LEFT JOIN requests r ON r.id=w.request_id
       WHERE w.stage NOT IN ('chamado','encerrado') AND w.updated_at<?`,
    )
    .all(limit);
  let closed = 0;
  for (const row of rows) {
    const set = (stage) =>
      db.prepare("UPDATE whatsapp_rh SET stage=?,data='{}',updated_at=? WHERE conversation_id=? AND stage=?").run(
        stage,
        new Date(now).toISOString(),
        row.conversation_id,
        row.stage,
      );
    const ticketOpen = row.request_id && row.request_status && row.request_status !== "Concluída";
    // Saiu do chamado para outro assunto (ou pediu para cancelar) e parou: volta ao chamado, que segue com o RH.
    if (ticketOpen) {
      set("chamado");
      continue;
    }
    if (row.stage === "pesquisa") {
      set("encerrado");
      continue;
    }
    try {
      const status = await conversationStatus(row.conversation_id);
      if (status === "pending" && !openOnConversation(row.conversation_id)) await resolveConversation(row.conversation_id);
      if (status === "pending" || status === "resolved") {
        set("encerrado");
        closed++;
      }
    } catch (e) {
      if (e.chatwootStatus === 404) set("encerrado");
      else {
        console.error("Conversas paradas:", e.message);
        break; // Chatwoot fora: tenta na próxima volta
      }
    }
  }
  if (closed) console.log(`[whatsapp] ${closed} conversa(s) parada(s) há 24 h encerrada(s).`);
}

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
    // Primeiro: o que deu erro ou parou no meio (central caiu) vai para uma atendente.
    recoveryState.lastRescued = await rescueStuck(db, whatsappInFlight, {
      sinceIso: new Date(since * 1000).toISOString(),
      notify: escalateToHuman,
      log: console.log,
    });
    const recovered = await recoverMissed({
      inboxId: config.inboxId,
      since,
      seen: (id) => isSettled(db, whatsappInFlight, id),
      listConversations: (page) => listInboxConversations(config.inboxId, page),
      listMessages: (id) => listConversationMessages(id),
      log: console.log,
      process: async (payload) => {
        const phone = payload.sender?.phone_number || payload.conversation?.meta?.sender?.phone_number;
        if (!phoneAllowed(phone, config)) return ignoreMessage(db, payload);
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
 * Leva o chamado para a conversa do Chatwoot (número, assunto, status, prazo e
 * prioridade pela cor do prazo). Só envia o que mudou desde o último envio; se
 * o Chatwoot estiver fora, a próxima volta (5 min) tenta de novo.
 * Uma conversa pode ter vários chamados: mostra o aberto mais recente ou, se
 * todos estiverem concluídos, o último (enviado uma vez e sai da varredura).
 */
async function syncChatwootTickets(now = Date.now(), onlyId = null) {
  const { holidays } = whatsappConfig();
  const rows = db
    .prepare(
      `SELECT r.protocol,r.subject,r.status,r.created_at,r.due_at,r.chatwoot_conversation_id,s.signature
       FROM requests r LEFT JOIN chatwoot_ticket_sync s ON s.conversation_id=r.chatwoot_conversation_id
       WHERE r.chatwoot_conversation_id IS NOT NULL
         AND r.id=(SELECT r2.id FROM requests r2 WHERE r2.chatwoot_conversation_id=r.chatwoot_conversation_id
                   ORDER BY (r2.status<>'Concluída') DESC, r2.created_at DESC LIMIT 1)
         AND (r.status<>'Concluída' OR s.signature IS NULL OR s.signature NOT LIKE '%"chamado_status":"Concluída"%')
         AND (? IS NULL OR r.chatwoot_conversation_id=(SELECT chatwoot_conversation_id FROM requests WHERE id=?))`,
    )
    .all(onlyId, onlyId);
  const saved = db.prepare(
    "INSERT INTO chatwoot_ticket_sync (conversation_id,signature,synced_at) VALUES (?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET signature=excluded.signature,synced_at=excluded.synced_at",
  );
  let failures = 0;
  for (const request of rows) {
    const ticket = chatwootTicket(request, now, holidays);
    const signature = JSON.stringify(ticket);
    if (signature === request.signature) continue;
    const conversationId = String(request.chatwoot_conversation_id);
    try {
      await syncTicket(conversationId, ticket);
      saved.run(conversationId, signature, new Date().toISOString());
    } catch (e) {
      // Conversa apagada no Chatwoot: não adianta insistir.
      if (e.chatwootStatus === 404) saved.run(conversationId, signature, new Date().toISOString());
      else if (++failures === 1) console.error(`Chamado ${request.protocol} no Chatwoot:`, e.message);
      if (failures >= 3) break; // Chatwoot fora: tenta de novo na próxima volta.
    }
  }
}
const syncChatwootTicket = (id) =>
  void syncChatwootTickets(Date.now(), id).catch((e) => console.error("Chamado no Chatwoot:", e.message));
/**
 * Chamados que pedem atenção, para o resumo diário dos prazos. Quem está
 * "Aguardando colaborador" não entra: a vez é do colaborador, não do RH.
 */
function digestGroups(open, now, { holidays, officeHours, firstResponseHours }) {
  const groups = { vencidos: [], primeira: [], perto: [], semResponsavel: [] };
  for (const request of open) {
    if (request.status === "Aguardando colaborador") continue;
    const data = alertRequest(request.id);
    if (!data) continue;
    const sla = request.due_at ? slaStatus(request.created_at, request.due_at, now, holidays) : null;
    if (sla?.level === "vermelho") groups.vencidos.push(data);
    else if (sla?.level === "laranja") groups.perto.push(data);
    if (!request.first_response_at) {
      const first = firstResponseStatus(request.created_at, null, now, { hours: firstResponseHours, officeHours, holidays });
      if (first?.level === "atrasado") groups.primeira.push(data);
    }
    if (!request.assigned_to) groups.semResponsavel.push(data);
  }
  for (const list of Object.values(groups)) list.sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  return groups;
}

/**
 * Resumo diário dos prazos por e-mail: uma vez por dia útil, a partir da hora
 * configurada (ALERTA_RESUMO_HORA, padrão 8h). O dia fica gravado antes do
 * envio, para a central reiniciada não mandar o mesmo resumo duas vezes.
 */
function dailyDigest(open, now, config) {
  if (!emailAlerts.enabled) return;
  const lastDay = db.prepare("SELECT value FROM settings WHERE key='rh_digest_day'").get()?.value ?? null;
  const day = digestDay(now, { minute: emailAlerts.digestMinute, holidays: config.holidays, lastDay });
  if (!day) return;
  db.prepare("INSERT INTO settings (key,value) VALUES ('rh_digest_day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(day);
  void emailAlerts.digest(digestGroups(open, now, config), day);
}

/**
 * Relatório mensal para os gestores (GESTORES_EMAILS): no 1º dia útil do mês, o
 * PDF do mês anterior. O mês fica gravado antes do envio (não repete ao reiniciar).
 */
function monthlyManagerReport(now) {
  if (!managerMailer.enabled) return;
  const lastKey = db.prepare("SELECT value FROM settings WHERE key='gestor_report_month'").get()?.value ?? null;
  const due = monthlyReportDue(now, { holidays: managers.holidays, hour: managers.hour, lastKey });
  if (!due) return;
  db.prepare("INSERT INTO settings (key,value) VALUES ('gestor_report_month',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(due.key);
  const report = managementReport(db, { start: due.start, end: due.end, now });
  const label = monthLabel(due.start);
  const pdf = managementPdf(report, { title: `Relatório do atendimento RH · ${label}` });
  void managerMailer.send({ label, pdf, report });
}

/**
 * A cada 5 minutos: atualiza o nível do prazo de cada chamado (o painel e o
 * Chatwoot mostram em destaque), manda o resumo diário dos prazos por e-mail e
 * o lembrete no WhatsApp para quem não respondeu o RH em 2 dias úteis.
 * Prazo não gera e-mail nem aviso por chamado: só o resumo diário.
 */
async function automaticAlerts(now = Date.now()) {
  const config = whatsappConfig();
  const { holidays, officeHours, firstResponseHours } = config;
  const open = db
    .prepare(
      `SELECT r.id,r.protocol,r.created_at,r.due_at,r.alert_level,r.status,r.assigned_to,r.awaiting_since,r.reminder_sent_at,r.chatwoot_conversation_id,r.first_response_alerted,
         (SELECT MIN(m.created_at) FROM messages m JOIN users mu ON mu.id=m.user_id WHERE m.request_id=r.id AND m.internal=0 AND mu.role='rh') first_response_at
       FROM requests r WHERE r.status<>'Concluída'`,
    )
    .all();
  try {
    dailyDigest(open, now, config);
  } catch (e) {
    console.error("Resumo diário dos prazos:", e.message);
  }
  try {
    monthlyManagerReport(now);
  } catch (e) {
    console.error("Relatório mensal dos gestores:", e.message);
  }
  for (const request of open) {
    if (!request.first_response_alerted && !request.first_response_at) {
      const first = firstResponseStatus(request.created_at, null, now, { hours: firstResponseHours, officeHours, holidays });
      if (first?.level === "atrasado") db.prepare("UPDATE requests SET first_response_alerted=1 WHERE id=?").run(request.id);
    }
    const sla = request.due_at ? slaStatus(request.created_at, request.due_at, now, holidays) : null;
    const rank = sla ? LEVEL_RANK[sla.level] : -1;
    if (request.alert_level === null || rank > request.alert_level)
      db.prepare("UPDATE requests SET alert_level=? WHERE id=?").run(rank, request.id);
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

/**
 * Depois da nota ou do cancelamento: se a conversa ainda tem outro chamado aberto, o
 * colaborador volta para ele (a próxima mensagem complementa esse chamado); senão, encerra.
 */
function afterTicketClosed(conversationId, phone, closedState) {
  const other = db
    .prepare("SELECT id FROM requests WHERE chatwoot_conversation_id=? AND status<>'Concluída' ORDER BY created_at DESC LIMIT 1")
    .get(String(conversationId));
  if (other) saveWhatsappState(conversationId, { stage: "chamado", theme: null, invalid: 0, data: {} }, phone, other.id);
  else saveWhatsappState(conversationId, closedState, phone);
}

/** Chamados ainda abertos ligados à conversa do Chatwoot. */
const openOnConversation = (conversationId) =>
  db.prepare("SELECT COUNT(*) n FROM requests WHERE chatwoot_conversation_id=? AND status<>'Concluída'").get(String(conversationId)).n;
/**
 * A central só resolve a conversa no Chatwoot quando não sobra chamado aberto nela.
 * Resolver a conversa avisa a central (webhook) como se a atendente tivesse encerrado
 * tudo, o que concluiria os outros chamados da conversa.
 */
async function resolveWhenDone(conversationId) {
  if (!openOnConversation(conversationId)) await resolveConversation(conversationId);
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
    await resolveWhenDone(conversationId);
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
        !acceptedOrigins.has(req.headers.origin) &&
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
                .prepare("SELECT id,protocol,chatwoot_conversation_id FROM requests WHERE chatwoot_conversation_id=? AND status<>'Concluída'")
                .all(String(payload.id))
            : [];
          const waRow = db.prepare("SELECT request_id,stage FROM whatsapp_rh WHERE conversation_id=?").get(String(payload.id));
          transaction(() =>
            closeFromChatwoot(db, history, payload.id, payload.meta?.assignee?.name),
          );
          // Pede a nota do chamado em que o colaborador estava (como na conclusão pela central).
          const surveyId = ["chamado", "cancelar"].includes(waRow?.stage) ? waRow.request_id : null;
          if (whatsappOpen.length)
            db.prepare("UPDATE whatsapp_rh SET stage=?,updated_at=? WHERE conversation_id=?").run(
              whatsappOpen.some((r) => r.id === surveyId) ? "pesquisa" : "encerrado",
              new Date().toISOString(),
              String(payload.id),
            );
          // Uma mensagem só, mesmo com vários chamados na conversa.
          if (whatsappOpen.length)
            await sendChatwootMessage(
              payload.id,
              ticketsClosedText(
                whatsappOpen.map((r) => r.protocol),
                { survey: whatsappOpen.some((r) => r.id === surveyId) },
              ),
            ).catch((e) => console.error(`WhatsApp RH conversa ${payload.id}:`, e.message));
          for (const request of whatsappOpen) syncChatwootTicket(request.id);
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
            // Modo teste: contato fora da lista vai direto para as atendentes no Chatwoot. A mensagem
            // fica registrada como ignorada, para a recuperação não respondê-la se o número entrar na lista.
            ignoreMessage(db, payload);
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
          ["/api/management", "/api/management.csv", "/api/management.pdf", "/api/management/list"].includes(pathname) &&
          req.method === "GET"
        ) {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const manager = isManager(user, managerSettings());
          // Período: from/to (AAAA-MM-DD, fuso de MS, "to" inclusive) ou days (0, 7, 30, 90).
          const from = url.searchParams.get("from");
          const to = url.searchParams.get("to");
          const days = Number(url.searchParams.get("days") ?? 30);
          const includeDemo = url.searchParams.get("demo") === "true";
          const options = { days, includeDemo };
          if (from || to) {
            const day = /^\d{4}-\d{2}-\d{2}$/;
            if (!day.test(from || "") || !day.test(to || "")) fail(400, "Período inválido.");
            const start = localMidnight(from);
            const end = localMidnight(to) + 86400000;
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 400 * 86400000)
              fail(400, "Período inválido.");
            Object.assign(options, { start, end });
          } else if (![0, 7, 30, 90].includes(days)) fail(400, "Período inválido.");
          // Atendente que não é gestor vê só os próprios números.
          const scope = manager ? {} : { scopeUserId: user.id };
          if (pathname === "/api/management/list") {
            const metric = url.searchParams.get("metric") || "";
            const rows = indicatorRows(managementRows(db, scope), metric, {
              ...options,
              owner: url.searchParams.get("owner") || undefined,
              service: url.searchParams.get("service") || undefined,
            });
            if (!rows) fail(400, "Indicador inválido.");
            return json(res, 200, {
              total: rows.length,
              requests: rows.slice(0, 500).map((r) => ({
                id: r.id,
                protocol: r.protocol,
                subject: r.subject,
                status: r.status,
                service_id: r.service_id,
                assigned_name: r.assigned_name || null,
                created_at: r.created_at,
                due_at: r.due_at,
                closed_at: r.closed_at,
              })),
            });
          }
          const report = { ...managementReport(db, options, scope), scope: manager ? "equipe" : "pessoal" };
          // Sem ranking dos colegas: o atendente vê só a própria linha.
          if (!manager) report.owners = report.owners.filter((o) => o.id === user.id);
          if (pathname.endsWith(".csv")) {
            res.writeHead(200, {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="indicadores-rh.csv"',
            });
            return res.end(managementCsv(report, { days, includeDemo }));
          }
          if (pathname.endsWith(".pdf")) {
            if (!manager) fail(403, "O relatório em PDF é dos gestores.");
            res.writeHead(200, {
              "Content-Type": "application/pdf",
              "Content-Disposition": 'attachment; filename="relatorio-atendimento-rh.pdf"',
              "Cache-Control": "no-store",
            });
            return res.end(managementPdf(report));
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
          return json(res, 200, {
            ...wahaWatchdog.getHealth(),
            recovery: recoveryState,
            // Últimas 24 h: mensagens que o bot não tratou (passadas à atendente / ainda esperando).
            delivery: deliveryStats(db, new Date(Date.now() - 86400000).toISOString()),
          });
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
            team: db.prepare(`SELECT u.id,u.name FROM users u WHERE ${RH_TEAM} ORDER BY u.name`).all(),
          });
        }
        // --- Equipe do RH: quem atende na central e quem é gestor ---------------------
        if (pathname === "/api/rh-team" && req.method === "GET") {
          if (user.role !== "rh") fail(403, "Acesso exclusivo do RH.");
          const settings = managerSettings();
          const team = db
            .prepare(
              `SELECT u.id,u.identifier,u.name,u.role,u.unit,u.department,u.manager,u.password_hash,
                 (SELECT COUNT(*) FROM requests r WHERE r.assigned_to=u.id AND r.status<>'Concluída') open
               FROM users u WHERE ${RH_TEAM} ORDER BY u.name`,
            )
            .all()
            .map((t) => ({
              id: t.id,
              name: t.name,
              cpf_masked: maskCpf(t.identifier),
              unit: t.unit,
              department: t.department,
              manager: isManager(t, settings),
              manager_marked: t.manager === 1,
              // Gestor definido em CENTRAL_GESTORES: só muda no servidor.
              manager_fixed: managers.identifiers.includes(t.identifier),
              active: !t.password_hash.startsWith("!") && t.password_hash !== "bloqueado",
              open: t.open,
              self: t.id === user.id,
            }));
          return json(res, 200, {
            team,
            can_manage: isManager(user, settings),
            managers_defined: settings.identifiers.length > 0,
          });
        }
        if (pathname === "/api/rh-team" && req.method === "POST") {
          if (!isManager(user, managerSettings())) fail(403, "Só gestores do atendimento alteram a equipe do RH.");
          const input = await body(req);
          const target = db.prepare("SELECT * FROM users WHERE id=?").get(String(input.user_id || ""));
          if (!target) fail(404, "Colaborador não encontrado.");
          if (target.role === "rh") fail(409, `${target.name} já faz parte da equipe do RH.`);
          if (
            !/^\d{11}$/.test(target.identifier) ||
            !db.prepare("SELECT user_id FROM senior_accounts WHERE user_id=? AND active=1").get(target.id)
          )
            fail(400, "Só colaboradores ativos na Senior podem ser atendentes.");
          transaction(() => {
            db.prepare("UPDATE users SET role='rh',manager=0 WHERE id=?").run(target.id);
            // Entra de novo para ver a central do RH.
            db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
          });
          console.log(`[equipe] ${user.name} adicionou ${target.name} à equipe do RH`);
          return json(res, 200, { ok: true });
        }
        const teamMatch = pathname.match(/^\/api\/rh-team\/([a-zA-Z0-9-]+)(\/access-code)?$/);
        if (teamMatch) {
          if (!isManager(user, managerSettings())) fail(403, "Só gestores do atendimento alteram a equipe do RH.");
          const target = db.prepare(`SELECT u.* FROM users u WHERE u.id=? AND ${RH_TEAM}`).get(teamMatch[1]);
          if (!target) fail(404, "Atendente não encontrado.");
          if (teamMatch[2] && req.method === "POST")
            return json(res, 200, { code: issueCode(target.id), name: target.name });
          if (teamMatch[2]) fail(405, "Método não permitido.");
          if (target.id === user.id) fail(400, "Peça a outro gestor para alterar o seu próprio acesso.");
          const fixed = managers.identifiers.includes(target.identifier);
          if (req.method === "PATCH") {
            const input = await body(req);
            if (typeof input.manager !== "boolean") fail(400, "Informe se é gestor.");
            if (fixed) fail(409, "Este gestor está definido na configuração do servidor (CENTRAL_GESTORES).");
            db.prepare("UPDATE users SET manager=? WHERE id=?").run(input.manager ? 1 : 0, target.id);
            console.log(`[equipe] ${user.name} ${input.manager ? "marcou" : "desmarcou"} ${target.name} como gestor`);
            return json(res, 200, { ok: true });
          }
          if (req.method === "DELETE") {
            if (fixed) fail(409, "Este gestor está definido na configuração do servidor (CENTRAL_GESTORES).");
            const open = db
              .prepare("SELECT COUNT(*) n FROM requests WHERE assigned_to=? AND status<>'Concluída'")
              .get(target.id).n;
            if (open)
              fail(409, `${target.name} ainda é responsável por ${open} chamado(s) em aberto. Transfira antes de remover.`);
            transaction(() => {
              db.prepare("UPDATE users SET role='colaborador',manager=0 WHERE id=?").run(target.id);
              db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
            });
            console.log(`[equipe] ${user.name} removeu ${target.name} da equipe do RH`);
            return json(res, 200, { ok: true });
          }
          fail(405, "Método não permitido.");
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
            // Transferência: { to: id da atendente do RH ou null (volta para a fila), reason }.
            const transfer = input.transfer;
            if (transfer !== undefined) {
              if (!transfer || typeof transfer !== "object") fail(400, "Transferência inválida.");
              if (request.status === "Concluída") fail(400, "Reabra o chamado antes de transferir.");
              const to = transfer.to ?? null;
              if (to !== null && !db.prepare("SELECT id FROM users WHERE id=? AND role='rh'").get(to))
                fail(400, "Escolha para quem transferir.");
              if (to === (request.assigned_to ?? null)) fail(400, "O chamado já está com essa pessoa.");
              const reason = typeof transfer.reason === "string" ? transfer.reason.trim() : "";
              if (reason.length < 3 || reason.length > 500)
                fail(400, "Explique em poucas palavras o motivo da transferência.");
            }
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
              if (transfer !== undefined) {
                const to = transfer.to ?? null;
                const name = (userId) =>
                  userId ? db.prepare("SELECT name FROM users WHERE id=?").get(userId)?.name : "Sem responsável";
                const from = name(request.assigned_to);
                const target = to ? name(to) : "a fila do RH (sem responsável)";
                const reason = transfer.reason.trim();
                db.prepare("UPDATE requests SET assigned_to=? WHERE id=?").run(to, id);
                history(id, user, `Atendimento transferido para ${target}`, "transfer", { from, to: target, motivo: reason }, 1);
                // Nota interna na conversa: quem recebe vê o motivo junto com as mensagens.
                db.prepare(
                  "INSERT INTO messages (id,request_id,user_id,body,created_at,internal) VALUES (?,?,?,?,?,1)",
                ).run(
                  randomUUID(),
                  id,
                  user.id,
                  `${request.assigned_to ? `Atendimento transferido de ${from} para ${target}` : `Atendimento encaminhado para ${target}`}.\nMotivo: ${reason}`,
                  new Date().toISOString(),
                );
              }
              db.prepare("UPDATE requests SET updated_at=? WHERE id=?").run(
                new Date().toISOString(),
                id,
              );
            });
            syncChatwootTicket(id);
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
const managerMailer = createManagerMailer({ smtp: emailConfig(), config: managers });
// Alertas para a TI: WhatsApp fora por mais de 10 min, Senior com 3 falhas seguidas, backup atrasado ou com erro.
const tiAlerts = createTiAlerts();
console.log(tiAlerts.enabled ? "Alertas da TI por e-mail ligados." : "Alertas da TI por e-mail desligados (configure SMTP_HOST e ALERTA_TI_EMAILS).");
let whatsappBadSince = null;
const checkTi = async () => {
  const waha = wahaWatchdog.getHealth();
  if (waha.enabled) {
    if (waha.health === "ok") {
      whatsappBadSince = null;
      await tiAlerts.clear("whatsapp", "WhatsApp do RH");
    } else if (waha.health !== "verificando") {
      whatsappBadSince ??= Date.now();
      if (Date.now() - whatsappBadSince >= 10 * 60000)
        await tiAlerts.raise("whatsapp", "WhatsApp do RH fora do ar", `situação "${waha.health}"${waha.health === "qr" ? ": é preciso ler o QR code de novo" : ""}`);
    }
  }
  const senior = seniorHealth();
  if (senior.failures >= 3) await tiAlerts.raise("senior", "Senior falhando", `${senior.failures} consultas seguidas sem resposta: ${senior.lastError}`);
  else if (senior.failures === 0) await tiAlerts.clear("senior", "Conexão com a Senior");
  const backup = backupProblem(`${process.env.CENTRAL_DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url))}/backup-status.json`);
  if (backup) await tiAlerts.raise("backup", "Backup do atendimento do RH com problema", backup);
  else await tiAlerts.clear("backup", "Backup do atendimento do RH");
};
setInterval(() => void checkTi().catch((e) => console.error("Alertas da TI:", e.message)), 5 * 60000).unref?.();
console.log(emailAlerts.enabled ? "Avisos por e-mail ligados." : "Avisos por e-mail desligados (configure SMTP_HOST e ALERTA_EMAILS no .env.local).");
// Chamados nas conversas do Chatwoot (prioridade pelo prazo): não é aviso, roda sempre.
const runChatwootSync = () => void syncChatwootTickets().catch((e) => console.error("Chamados no Chatwoot:", e.message));
setInterval(runChatwootSync, 5 * 60000).unref?.();
setTimeout(runChatwootSync, 20000).unref?.();
// Senior "acordada" no horário em que o RH e os colaboradores usam (6h–22h): sem isso, a
// primeira consulta do ponto depois de alguns minutos parados leva ~30 s.
const warmSenior = () => {
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Campo_Grande", hour: "numeric", hourCycle: "h23" }));
  if (hour < 6 || hour >= 22 || !configuration().enabled) return;
  void warmUpSenior().catch(() => {});
};
setInterval(warmSenior, 4 * 60000).unref?.();
setTimeout(warmSenior, 30000).unref?.();
if (process.env.CENTRAL_AVISOS !== "off") {
  const alertTimer = setInterval(() => void automaticAlerts().catch((e) => console.error("Avisos automáticos:", e.message)), 5 * 60000);
  alertTimer.unref?.();
  setTimeout(() => void automaticAlerts().catch((e) => console.error("Avisos automáticos:", e.message)), 20000).unref?.();
  // Respostas do RH que não saíram no WhatsApp: tenta de novo a cada minuto.
  setInterval(() => void retryWhatsappDeliveries().catch((e) => console.error("Reenvio WhatsApp:", e.message)), 60000).unref?.();
  // Conversas paradas há 24 h sem chamado: encerra (de hora em hora).
  const runIdleClose = () => void closeIdleWhatsapp().catch((e) => console.error("Conversas paradas:", e.message));
  setInterval(runIdleClose, 3600000).unref?.();
  setTimeout(runIdleClose, 60000).unref?.();
  // Recupera mensagens do WhatsApp perdidas enquanto a central esteve fora.
  setTimeout(() => void recoverWhatsapp(), 8000).unref?.();
  setInterval(() => void recoverWhatsapp(), 5 * 60000).unref?.();
}
console.log(
  wahaWatchdog.getHealth().enabled
    ? "Vigia do WhatsApp (WAHA) ligado."
    : "Vigia do WhatsApp (WAHA) desligado: defina WAHA_API_KEY no .env.local.",
);
