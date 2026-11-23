import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Atendente virtual do WhatsApp do RH (caixa do Chatwoot ligada ao WAHA).
// Fluxo: menu -> assunto -> o colaborador manda os dados -> chamado na central
// com prazo de 48 horas úteis. Daí em diante o atendimento é feito na central:
// mensagens do colaborador entram no chamado e as respostas do RH saem no WhatsApp.
//
// Aqui ficam só as regras (sem banco nem rede), para serem testadas isoladas.

/** Configuração: .env.local da central, sobrescrito por variáveis de ambiente. */
export function whatsappConfig(env) {
  let settings = env;
  if (!settings) {
    let local = {};
    try {
      local = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    settings = { ...local, ...process.env };
  }
  const list = (value) =>
    String(value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    inboxId: Number(settings.WHATSAPP_RH_INBOX_ID || 12),
    // Modo teste: só telefones que contêm um destes trechos. "todos" libera geral.
    testPhones: list(settings.WHATSAPP_RH_TELEFONES_TESTE ?? "98969836"),
    deadlineHours: Number(settings.WHATSAPP_RH_PRAZO_HORAS || 48),
    // Primeira resposta do RH: horas dentro do expediente (não corre à noite nem no fim de semana).
    firstResponseHours: Number(settings.PRIMEIRA_RESPOSTA_HORAS || 4),
    holidays: list(settings.WHATSAPP_RH_FERIADOS),
    // Expediente do RH (seg–sex), só para avisar quem escreve fora dele. Ex.: 07:00-17:00
    officeHours: parseOfficeHours(settings.WHATSAPP_RH_EXPEDIENTE),
  };
}

function parseOfficeHours(value) {
  const m = /^(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?$/.exec(String(value || "").trim());
  if (!m) return [7 * 60, 17 * 60];
  return [Number(m[1]) * 60 + Number(m[2] || 0), Number(m[3]) * 60 + Number(m[4] || 0)];
}

export function phoneAllowed(phone, config) {
  if (config.testPhones.some((p) => p.toLowerCase() === "todos")) return true;
  const digits = String(phone || "").replace(/\D/g, "");
  return Boolean(digits) && config.testPhones.some((p) => digits.includes(p.replace(/\D/g, "")));
}

// --- Prazo em horas úteis ----------------------------------------------------
// O relógio só corre em dias úteis (seg–sex, fora feriados), no fuso de MS (UTC-4).
const OFFSET = 4 * 3600000;
const DAY = 86400000;
const localDay = (ms) => Math.floor((ms - OFFSET) / DAY);
const dayEnd = (day) => (day + 1) * DAY + OFFSET;
function businessDay(day, holidays) {
  const date = new Date(day * DAY);
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.includes(date.toISOString().slice(0, 10));
}

/** Instante (ms) em que vencem `hours` horas úteis a partir de `startMs`. */
export function businessDeadline(startMs, hours, holidays = []) {
  let remaining = hours * 3600000;
  let t = startMs;
  for (;;) {
    const day = localDay(t);
    const end = dayEnd(day);
    if (businessDay(day, holidays)) {
      if (remaining <= end - t) return t + remaining;
      remaining -= end - t;
    }
    t = end;
  }
}

/** Milissegundos úteis entre dois instantes. */
export function businessElapsed(fromMs, toMs, holidays = []) {
  let total = 0;
  for (let t = fromMs; t < toMs; ) {
    const day = localDay(t);
    const end = Math.min(dayEnd(day), toMs);
    if (businessDay(day, holidays)) total += end - t;
    t = end;
  }
  return total;
}

// --- Primeira resposta: relógio só dentro do expediente ------------------------
const officeWindow = (day, officeHours) => [day * DAY + OFFSET + officeHours[0] * 60000, day * DAY + OFFSET + officeHours[1] * 60000];
/** Instante em que vencem `hours` horas de expediente a partir de `startMs`. */
export function officeDeadline(startMs, hours, { officeHours = [7 * 60, 17 * 60], holidays = [] } = {}) {
  let remaining = hours * 3600000;
  let t = startMs;
  for (let guard = 0; guard < 4000; guard++) {
    const day = localDay(t);
    if (businessDay(day, holidays)) {
      const [open, close] = officeWindow(day, officeHours);
      if (t < open) t = open;
      if (t < close) {
        if (remaining <= close - t) return t + remaining;
        remaining -= close - t;
      }
    }
    t = dayEnd(day);
  }
  return t;
}
/** Milissegundos de expediente entre dois instantes. */
export function officeElapsed(fromMs, toMs, { officeHours = [7 * 60, 17 * 60], holidays = [] } = {}) {
  let total = 0;
  for (let t = fromMs; t < toMs; ) {
    const day = localDay(t);
    if (businessDay(day, holidays)) {
      const [open, close] = officeWindow(day, officeHours);
      const start = Math.max(t, open);
      const end = Math.min(toMs, close);
      if (end > start) total += end - start;
    }
    t = dayEnd(day);
  }
  return total;
}
/**
 * Situação da primeira resposta do RH.
 * level: respondido | ok | perto (último quarto do prazo) | atrasado.
 */
export function firstResponseStatus(createdAt, answeredAt, now = Date.now(), { hours = 4, officeHours, holidays } = {}) {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return null;
  const office = { officeHours, holidays };
  const due = officeDeadline(created, hours, office);
  const answered = answeredAt ? Date.parse(answeredAt) : NaN;
  if (Number.isFinite(answered)) return { due_at: new Date(due).toISOString(), level: "respondido", late: answered > due };
  if (now >= due) return { due_at: new Date(due).toISOString(), level: "atrasado", late: true };
  const left = officeElapsed(now, due, office);
  return { due_at: new Date(due).toISOString(), level: left <= hours * 3600000 * 0.25 ? "perto" : "ok", late: false, left_ms: left };
}

/**
 * Criticidade de um chamado aberto pelo prazo útil consumido:
 * verde < 50%, amarelo < 75%, laranja < 100%, vermelho = vencido.
 */
export function slaStatus(createdAt, dueAt, now = Date.now(), holidays = []) {
  const created = Date.parse(createdAt);
  const due = Date.parse(dueAt);
  if (!Number.isFinite(created) || !Number.isFinite(due)) return null;
  const total = businessElapsed(created, due, holidays);
  const percent = total > 0 ? Math.floor((businessElapsed(created, now, holidays) / total) * 100) : 100;
  const level =
    now >= due ? "vermelho" : percent < 50 ? "verde" : percent < 75 ? "amarelo" : "laranja";
  return { percent: Math.min(percent, 100), level };
}

// Prioridade do Chatwoot pela cor do prazo: a atendente vê no próprio Chatwoot o que está atrasado.
const CHATWOOT_PRIORITY = { verde: "low", amarelo: "medium", laranja: "high", vermelho: "urgent" };

/**
 * O que a conversa do Chatwoot mostra do chamado: atributos (número, assunto,
 * status, prazo) e prioridade. Chamado concluído fica sem prioridade.
 */
export function chatwootTicket(request, now = Date.now(), holidays = []) {
  const open = request.status !== "Concluída";
  const sla = open && request.due_at ? slaStatus(request.created_at, request.due_at, now, holidays) : null;
  return {
    attributes: {
      chamado: request.protocol,
      chamado_assunto: request.subject,
      chamado_status: request.status,
      chamado_prazo: request.due_at ? formatLocal(Date.parse(request.due_at)) : "sem prazo",
    },
    priority: (sla && CHATWOOT_PRIORITY[sla.level]) || null,
  };
}

// --- Textos ------------------------------------------------------------------
// Negrito: **texto**. O WAHA converte o Markdown do Chatwoot (*texto* vira itálico no WhatsApp).
const SIGNATURE = "— RH Frizelo";

/**
 * número do menu -> opção. serviceId é o serviço do catálogo da central.
 * Opções com `document` entregam o PDF da Senior na hora; se a identidade não
 * for confirmada, viram chamado do assunto `fallback`.
 */
export const THEMES = {
  1: { serviceId: "holerite", title: "Holerite em PDF", document: "holerite", documentTitle: "holerite", fallback: 5,
       words: ["holerite", "contracheque", "contra-cheque", "contra cheque"] },
  2: { serviceId: "ponto", title: "Espelho de ponto em PDF", document: "ponto", documentTitle: "espelho de ponto", fallback: 3,
       words: ["espelho"] },
  3: { serviceId: "ponto", title: "Ponto: ajustes e dúvidas", words: ["ponto", "batida", "bater", "marcação", "marcacao"],
       ask: ["seu **nome completo** e **setor**", "a **data**", "se foi **entrada** ou **saída** e o **horário**"] },
  4: { serviceId: "atestado", title: "Atestado / afastamento", words: ["atestado", "afastamento", "licença médica", "licenca medica", "acidente", "internado", "inss", "perícia", "pericia"],
       ask: ["seu **nome completo** e **setor**", "a **data de início** e a **quantidade de dias**", "a **foto ou PDF** do atestado (pode ser na mensagem seguinte)"] },
  5: { serviceId: "holerite", title: "Salário e descontos", words: ["salário", "salario", "desconto", "adiantamento"],
       ask: ["seu **nome completo** e **setor**", "o **mês de referência**", "o que está diferente do esperado"] },
  6: { serviceId: "beneficios", title: "Plano de saúde / odontológico",
       words: ["plano de saúde", "plano de saude", "odonto", "dentista", "hapvida", "carteirinha", "carência", "carencia", "convênio", "convenio"],
       ask: ["seu **nome completo** e **setor**", "o que precisa: **incluir ou excluir dependente**, carteirinha, carência, cobrança…", "se for inclusão: **foto da certidão** ou documento do dependente (pode ser na mensagem seguinte)"] },
  7: { serviceId: "beneficios", title: "Vale-transporte, vale-alimentação e sacolão",
       words: ["vale transporte", "vale-transporte", "vale alimentação", "vale alimentacao", "vale-alimentação", "sacolão", "sacolao", "cesta básica", "cesta basica", "benefício", "beneficio"],
       ask: ["seu **nome completo** e **setor**", "**qual benefício** e a sua dúvida (adesão, cancelamento, cartão, retirada do sacolão…)"] },
  8: { serviceId: "ferias", title: "Férias", words: ["férias", "ferias"],
       ask: ["seu **nome completo** e **setor**", "o **período desejado** ou a sua dúvida"] },
  9: { serviceId: "atestado", title: "Licenças (maternidade, paternidade, casamento, luto)",
       words: ["licença", "licenca", "maternidade", "paternidade", "nasceu", "nascimento", "casamento", "luto", "falecimento"],
       ask: ["seu **nome completo** e **setor**", "**qual licença** e a **data** do evento", "o **documento** (certidão de nascimento, casamento ou óbito) em foto ou PDF (pode ser na mensagem seguinte)"] },
  10: { serviceId: "outros", title: "Agendar ou remarcar (exame, entrevista, entrega de documentos)",
       words: ["agendar", "agendamento", "remarcar", "reagendar", "horário marcado", "exame admissional", "exame periódico", "exame periodico", "entrevista"],
       ask: ["seu **nome completo** e **setor** (ou telefone, se ainda não trabalha aqui)", "**o que** precisa agendar ou remarcar", "os **dias e horários** em que você pode"] },
  11: { serviceId: "declaracoes", title: "Documentos e declarações", words: ["declaração", "declaracao", "documento", "comprovante"],
       ask: ["seu **nome completo** e **setor**", "**qual documento** você precisa", "**para quando** precisa"] },
  12: { serviceId: "cadastro", title: "Atualização de cadastro", words: ["pix", "conta bancária", "conta bancaria", "endereço", "endereco", "dependente"],
       ask: ["seu **nome completo** e **setor**", "o dado novo (Pix/conta, endereço, telefone ou dependente)"] },
  13: { serviceId: "outros", title: "Rescisão / desligamento", words: ["rescisão", "rescisao", "acerto", "fgts", "demissão", "demissao", "desligamento", "seguro-desemprego", "seguro desemprego"],
       ask: ["seu **nome completo** e **setor**", "a sua dúvida (acerto, FGTS, seguro-desemprego, documentos…)"] },
  14: { serviceId: "outros", title: "Vagas e currículo", words: ["vaga", "currículo", "curriculo", "emprego"],
       ask: ["seu **nome completo** e **telefone**", "a **vaga ou área** de interesse", "o **currículo** em PDF ou foto, se tiver (pode ser na mensagem seguinte)"] },
  15: { serviceId: "outros", title: "Empresa parceira / fornecedor", words: ["fornecedor", "parceira", "parceiro", "operadora", "corretora"],
       ask: ["o **nome da empresa** e o **seu nome**", "o **assunto** (plano de saúde, recrutamento, exames, cobrança…)", "se for sobre um colaborador, o **nome dele**"] },
  // Pedir uma pessoa vira chamado de "outros assuntos" (o RH responde por aqui).
  0: { serviceId: "outros", title: "Outros assuntos", words: ["atendente", "falar com alguém", "falar com alguem", "falar com uma pessoa", "humano"],
       ask: ["seu **nome completo** e **setor**", "a sua **dúvida ou solicitação**"] },
};
const keycap = (n) => (n === 10 ? "🔟" : [...String(n)].map((d) => `${d}️⃣`).join(""));
const capitalize = (s) => s[0].toUpperCase() + s.slice(1);
const menuLine = (n) => `${keycap(n)} ${THEMES[n].document ? capitalize(THEMES[n].documentTitle) : THEMES[n].title}`;

export function menuText() {
  return [
    "Olá! Aqui é o atendimento virtual do RH da Frizelo. 👋",
    "Responda com o **número** da opção:",
    "",
    "📄 **Receber agora, em PDF**",
    menuLine(1),
    menuLine(2),
    "",
    "💬 **Falar com o RH** (abre um chamado)",
    ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0].map(menuLine),
    "",
    "A qualquer momento: **menu** volta para cá, **status** mostra os seus chamados e **sair** encerra a conversa.",
  ].join("\n");
}
export const invalidOptionText = "Não entendi. 🙂 Responda só com o **número** da opção (de 0 a 15).";
export function askText(theme) {
  const t = THEMES[theme];
  return `Certo, **${t.title}**. Me envie:\n${t.ask.map((i) => `• ${i}`).join("\n")}\n\nMande tudo em **uma mensagem só**, que eu já registro o seu chamado.`;
}

// --- Horário de atendimento ---------------------------------------------------
/** O RH está atendendo agora? Dia útil e dentro do expediente (minutos do dia, fuso de MS). */
export function withinOfficeHours(ms, { officeHours = [7 * 60, 17 * 60], holidays = [] } = {}) {
  const day = localDay(ms);
  if (!businessDay(day, holidays)) return false;
  const minute = Math.floor((ms - OFFSET - day * DAY) / 60000);
  return minute >= officeHours[0] && minute < officeHours[1];
}
/**
 * Resumo diário: devolve o dia local ("AAAA-MM-DD") quando já passou da hora do
 * resumo num dia útil e o resumo desse dia ainda não saiu; senão, null.
 */
export function digestDay(ms, { minute = 8 * 60, holidays = [], lastDay = null } = {}) {
  const day = localDay(ms);
  if (!businessDay(day, holidays)) return null;
  if (Math.floor((ms - OFFSET - day * DAY) / 60000) < minute) return null;
  const label = new Date(day * DAY).toISOString().slice(0, 10);
  return label === lastDay ? null : label;
}
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n) => String(n).padStart(2, "0");
/** "seg, 17/11 às 15h" (ou "15h30") no fuso de MS. */
export function formatLocal(ms) {
  const d = new Date(ms - OFFSET);
  const minutes = d.getUTCMinutes();
  return `${WEEKDAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} às ${d.getUTCHours()}h${minutes ? pad(minutes) : ""}`;
}
const formatDay = (ms) => formatLocal(ms).split(" às")[0];
export const hhmm = (minute) => `${Math.floor(minute / 60)}h${minute % 60 ? pad(minute % 60) : ""}`;

export function ticketOpenedText(protocol, theme, { dueMs, offHours = false, officeHours = [7 * 60, 17 * 60] } = {}) {
  const lines = [
    "✅ Sua solicitação foi registrada!",
    "",
    `**Chamado nº ${protocol}**`,
    `Assunto: ${THEMES[theme].title}`,
    "",
    `O RH vai te responder **por este WhatsApp** até **${formatLocal(dueMs)}**. Se quiser complementar, é só mandar aqui.`,
  ];
  if (offHours)
    lines.push(
      "",
      `🌙 Agora o RH está fora do horário de atendimento (segunda a sexta, das ${hhmm(officeHours[0])} às ${hhmm(officeHours[1])}). Seu chamado será visto no próximo horário.`,
    );
  lines.push(SIGNATURE);
  return lines.join("\n");
}
export function ticketOpenReminderText(protocol) {
  return `Olá! Você tem o **chamado nº ${protocol}** em aberto com o RH, e a resposta virá por aqui. 🙂\n\n• Para complementar esse chamado, é só escrever a mensagem.\n• Para outro assunto (como holerite ou espelho de ponto), envie **menu**.\n• Para ver a situação dos seus chamados, envie **status**.`;
}
export function ticketClosedText(protocol, { survey = false } = {}) {
  const text = `Seu **chamado nº ${protocol}** foi atendido. ✅`;
  if (survey)
    return `${text}\n\nComo foi o atendimento? Responda com uma nota de **1** a **5**\n(1 = muito ruim · 5 = ótimo).\nSe não quiser avaliar, envie **sair**.\n${SIGNATURE}`;
  return `${text}\nSe precisar de algo mais, é só mandar uma nova mensagem por aqui.\n${SIGNATURE}`;
}
/** Vários chamados concluídos de uma vez (atendente resolveu a conversa): uma mensagem só. */
export function ticketsClosedText(protocols, { survey = false } = {}) {
  if (protocols.length === 1) return ticketClosedText(protocols[0], { survey });
  const list = protocols.map((p) => `**${p}**`);
  const text = `Seus chamados nº ${list.slice(0, -1).join(", ")} e ${list.at(-1)} foram atendidos. ✅`;
  if (survey)
    return `${text}\n\nComo foi o atendimento? Responda com uma nota de **1** a **5**\n(1 = muito ruim · 5 = ótimo).\nSe não quiser avaliar, envie **sair**.\n${SIGNATURE}`;
  return `${text}\nSe precisar de algo mais, é só mandar uma nova mensagem por aqui.\n${SIGNATURE}`;
}
export function awaitingEmployeeText(protocol) {
  return `📝 O RH precisa de uma informação sua para continuar o **chamado nº ${protocol}**.\nResponda por aqui para o atendimento seguir.\n${SIGNATURE}`;
}
export function awaitingReminderText(protocol) {
  return `⏰ Lembrete: o RH ainda aguarda a sua resposta no **chamado nº ${protocol}**.\nÉ só responder por aqui para o atendimento continuar.\n${SIGNATURE}`;
}
export function ratingThanksText(rating) {
  return `${rating >= 4 ? "Que bom! " : ""}Obrigado pela avaliação. 🙏\nSe precisar de algo mais, é só mandar uma nova mensagem por aqui.`;
}

const STATUS_LABEL = {
  Recebida: "recebido, aguardando o RH",
  "Em atendimento": "em atendimento",
  "Aguardando colaborador": "**aguardando a sua resposta**",
};
/** Situação dos chamados do colaborador (abertos primeiro). requests: { protocol, subject, status, due_at, closed_at }. */
export function statusText(requests) {
  if (!requests.length) return "Você não tem chamados com o RH por este WhatsApp. 🙂\nEnvie **menu** para ver as opções.";
  const items = requests.map((r) => {
    const detail =
      r.status === "Concluída"
        ? `concluído${r.closed_at ? ` (${formatDay(Date.parse(r.closed_at))})` : ""}`
        : `${STATUS_LABEL[r.status] || r.status}${r.due_at ? ` · resposta até ${formatLocal(Date.parse(r.due_at))}` : ""}`;
    return `• **${r.protocol}** · ${r.subject}\n   ${detail}`;
  });
  const waiting = requests.some((r) => r.status === "Aguardando colaborador");
  return [
    "📋 **Seus chamados com o RH**",
    "",
    ...items,
    "",
    waiting ? "O RH está esperando uma informação sua: é só responder aqui." : "A resposta do RH chega por aqui.",
    "Envie **menu** para outro assunto.",
  ].join("\n");
}

/** Áudio na hora de digitar CPF, matrícula, nome ou mês. */
export function audioNotHereText(stage) {
  const what = { doc_cpf: "o seu **CPF** (só os números)", doc_matricula: "a sua **matrícula**", doc_nome: "o seu **nome completo**", doc_mes: "o **mês** (ex.: 10/2026)" }[stage] || "a resposta";
  return `Recebi o áudio, mas nesta etapa preciso que você **digite** ${what}. 🙂
Se preferir falar com o RH, envie **menu** e escolha uma opção de **Falar com o RH** (lá pode mandar áudio).`;
}

// --- Encerramento ------------------------------------------------------------
export function ackText(protocol) {
  return `Combinado! 👍 Seu **chamado nº ${protocol}** continua com o RH, e a resposta vem por aqui.`;
}
export const goodbyeText = "Por nada! 🙂 Se precisar de algo, é só mandar uma mensagem por aqui.";
export const endedText = `Conversa encerrada. 👋 Quando precisar, é só mandar uma nova mensagem por aqui.\n${SIGNATURE}`;
export function cancelConfirmText(protocol) {
  return `Quer **cancelar** o chamado nº ${protocol}?\nResponda **sim** para cancelar, ou **não** para manter o chamado aberto com o RH.`;
}
export function keptText(protocol) {
  return `Certo, o **chamado nº ${protocol}** continua aberto com o RH. 👍`;
}
export function cancelledText(protocol) {
  return `Chamado nº ${protocol} **cancelado**. ✅\nSe precisar de algo, é só mandar uma nova mensagem por aqui.\n${SIGNATURE}`;
}
/** Lembrete completo do chamado: no máximo 1 por dia; confirmação curta: no máximo 1 por hora. */
export const REMIND_EVERY = 24 * 3600000;
export const ACK_EVERY = 3600000;

const GREETING = /^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|tudo bem\??)[!.,\s]*$/i;
// "ok", "obrigado", "valeu", 👍… (até três juntos: "ok, obrigado!"): fim de conversa, não é pedido novo.
const THANKS_TOKEN = "(?:ok(?:ay|ey)?|okk+|obrigad[oa]s?|muito obrigad[oa]|obg|brigad[oa]|valeu|vlw|certo|beleza|blz|show|combinado|perfeito|entendi|t[aá] bom|tudo certo|agrade[cç]o|grat[oa]|👍|🙏|👌|😊|🙂|😉|🤝)";
const THANKS = new RegExp(`^(?:${THANKS_TOKEN}[!.,\\s]*){1,3}$`, "iu");
const CANCEL_WORD = /^(cancelar|cancela|encerrar|encerra|finalizar)( (o |meu )?chamado)?[!.\s]*$/i;
const YES = /^(sim|s|pode|pode cancelar|confirmo|isso)[!.\s]*$/i;
const NO = /^(n[aã]o|nao|n)[!.\s]*$/i;
const STATUS_WORD = /^(status|situa[cç][aã]o|meus chamados|chamados?|consultar( meus)? chamados?|acompanhar( chamado)?)[!.?\s]*$/i;

/** "1", "2.", "10)", "opção 3" ou uma palavra do assunto -> número da opção (ou null). */
export function parseOption(text) {
  const t = String(text || "").toLowerCase().trim();
  const m = /^(?:op[cç][aã]o\s*)?(\d{1,2})\s*[.)-]?$/.exec(t);
  if (m) return THEMES[Number(m[1])] ? Number(m[1]) : null;
  // "Outros assuntos" (0) por último: "atendente sobre férias" é férias.
  const order = Object.keys(THEMES).map(Number).sort((a, b) => (a === 0) - (b === 0) || a - b);
  for (const n of order) if (THEMES[n].words.some((w) => t.includes(w))) return n;
  return null;
}

// --- Documentos da Senior (holerite / espelho de ponto em PDF) ----------------
export const cpfText = "Para proteger seus dados, preciso confirmar quem é você. 🔒\nQual é o seu **CPF**? (só os números)";
export const invalidCpfText = "Esse CPF não parece válido. Envie os **11 números** do seu CPF.";
export const matriculaText = "Agora a sua **matrícula** (número de cadastro na empresa).";
export const invalidMatriculaText = "Envie só os **números** da sua matrícula.";
export const nameText = "E o seu **nome completo**, como está no cadastro da empresa.";
export function verifiedText(firstName, theme) {
  return `✅ Dados confirmados, ${firstName}!\nDe qual **mês** você quer o ${THEMES[theme].documentTitle}? (ex.: 10/2026)`;
}
/** Identidade confirmada há pouco nesta conversa: pula CPF, matrícula e nome. */
export function rememberedText(firstName, theme) {
  return `${firstName}, seus dados já estão confirmados. 🔒\nDe qual **mês** você quer o ${THEMES[theme].documentTitle}? (ex.: 10/2026)`;
}
export const retryIdentityText =
  "Não consegui confirmar seus dados. Vamos tentar mais uma vez.\nQual é o seu **CPF**? (só os números)";
/** Assunto do chamado quando o documento não pode ser entregue. */
export const ticketTheme = (theme) => THEMES[theme]?.fallback ?? theme;
export function identityFailedText(theme) {
  return `Não consegui confirmar seus dados, então por segurança não posso enviar o documento por aqui.\n\n${askText(ticketTheme(theme))}`;
}
export const invalidMonthText = "Não entendi o mês. Envie no formato **10/2026**.";
export const anotherMonthText =
  "Quer de outro mês? Envie o mês (ex.: 09/2026).\nDúvida sobre o documento? Envie **menu** e escolha uma opção de **Falar com o RH**.";

const digitsOf = (text) => String(text || "").replace(/\D/g, "");
/** CPF com dígitos verificadores válidos. */
export function validCpf(text) {
  const d = digitsOf(text);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(d[i]) * (size + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[size])) return false;
  }
  return true;
}
/** Nome igual ao do cadastro, sem diferenciar acentos, maiúsculas e espaços. */
export function sameName(a, b) {
  const norm = (v) =>
    String(v || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return Boolean(norm(a)) && norm(a) === norm(b);
}
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "10/2026", "10-2026", "2026-10", "outubro/2026" -> "2026-10". */
export function parseCompetence(text) {
  const t = String(text || "").trim().toLowerCase();
  let m = /^(\d{1,2})\s*[/-]\s*(\d{4})$/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})$/.exec(t);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}`;
  m = /(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\D*(\d{4})/.exec(t);
  if (m) return `${m[2]}-${String(MONTHS.indexOf(m[1].replace("marco", "março")) + 1).padStart(2, "0")}`;
  return null;
}
const MENU_WORD = /^(menu|in[ií]cio|voltar)$/i;
// O colaborador encerra a conversa (fora de um chamado aberto, onde "encerrar" é cancelar o chamado).
const END_WORD = /^(sair|fim|tchau|xau|at[eé] (mais|logo)|encerrar( (a )?(conversa|atendimento))?|finalizar( (a )?(conversa|atendimento))?|(era )?s[oó] isso|n[aã]o,? obrigad[oa]|nada)[!.\s]*$/i;

/**
 * Próximo passo da conversa. state = { stage, theme, invalid, data }.
 * Retorna { state, reply } ou { state, open: true } quando é hora de abrir o chamado
 * (a resposta depende do protocolo, gerado no banco), ou { state, append: true }
 * quando já existe chamado e a mensagem só entra nele. Nos documentos da Senior:
 * { verify: { cpf, matricula, name } } e { deliver: { kind, month } } (consultas assíncronas no servidor);
 * `identity: true` deixa o servidor pular a identificação já confirmada. Também:
 * { status: true } (listar os chamados) e { rate: 1..5 } (pesquisa de satisfação).
 */
export function nextStep(state, text, { hasAttachment = false, hasAudio = false, now = Date.now() } = {}) {
  const stage = state?.stage || null;
  const data = state?.data || {};
  const trimmed = String(text || "").trim();
  const thanks = !hasAttachment && THANKS.test(trimmed);
  const closed = { stage: "encerrado", theme: null, invalid: 0, data: {} };
  // "obrigado" depois de encerrado (ou em vez da nota): despedida, sem mandar o menu de novo.
  if (thanks && (stage === "encerrado" || stage === "pesquisa" || stage === "menu")) return { state: closed, goodbye: true };
  // "sair", "tchau"...: encerra sem mandar o menu. Com chamado aberto não vale: a mensagem
  // entra no chamado e "encerrar" continua pedindo para cancelar.
  if (!hasAttachment && END_WORD.test(trimmed) && stage !== "chamado" && stage !== "cancelar")
    return { state: closed, goodbye: true, ended: true };
  const toMenu = () => ({ state: { stage: "menu", theme: null, invalid: 0, data: {} }, reply: menuText() });
  // "status" funciona em qualquer ponto da conversa (menos no meio dos dados pessoais).
  if (!hasAttachment && STATUS_WORD.test(trimmed) && !["doc_cpf", "doc_matricula", "doc_nome"].includes(stage))
    return { state: stage && stage !== "encerrado" && stage !== "pesquisa" ? state : { stage: "menu", theme: null, invalid: 0, data: {} }, status: true };
  if (stage === "pesquisa") {
    const rating = /^\s*([1-5])(?:\s*(?:estrelas?|\/\s*5))?[!.\s]*$/i.exec(trimmed)?.[1];
    if (rating) return { state: { stage: "encerrado", theme: null, invalid: 0, data: {} }, rate: Number(rating) };
    if (!hasAudio || trimmed) return toMenu();
  }
  // Áudio (sem texto) no começo, no menu ou depois de encerrado: a pessoa já está explicando
  // o pedido, então vira chamado de "outros assuntos" com o áudio, para o RH ouvir.
  if (hasAudio && !trimmed && (!stage || ["menu", "encerrado", "pesquisa", "doc_opcao"].includes(stage)))
    return { state: { stage: "chamado", theme: 0, invalid: 0, data: {} }, open: true };
  // Nos dados pessoais e no mês, o bot precisa de texto.
  if (hasAudio && !trimmed && stage?.startsWith("doc_")) return { state, reply: audioNotHereText(stage) };
  if (!stage || stage === "encerrado" || stage === "doc_opcao" || (stage.startsWith("doc_") && MENU_WORD.test(trimmed))) return toMenu();
  if (stage === "menu") {
    let theme = parseOption(text);
    if (theme === null) {
      const invalid = (state.invalid || 0) + 1;
      // Depois de duas respostas fora do menu, segue como "outros assuntos".
      if (invalid < 2) return { state: { ...state, invalid, data: {} }, reply: invalidOptionText };
      theme = 0;
    }
    // PDF na hora: o servidor pula a identificação se ela foi confirmada há pouco.
    if (THEMES[theme].document)
      return { state: { stage: "doc_cpf", theme, invalid: 0, data: { attempts: 0 } }, reply: cpfText, identity: true };
    return { state: { stage: "tema", theme, invalid: 0, data: {} }, reply: askText(theme) };
  }
  if (stage === "doc_cpf") {
    if (!validCpf(text)) return { state, reply: invalidCpfText };
    return { state: { ...state, stage: "doc_matricula", data: { ...data, cpf: digitsOf(text) } }, reply: matriculaText };
  }
  if (stage === "doc_matricula") {
    const digits = digitsOf(text);
    if (!digits || digits.length > 9) return { state, reply: invalidMatriculaText };
    return { state: { ...state, stage: "doc_nome", data: { ...data, matricula: digits } }, reply: nameText };
  }
  if (stage === "doc_nome") {
    if (!trimmed) return { state };
    return { state, verify: { cpf: data.cpf, matricula: data.matricula, name: trimmed } };
  }
  if (stage === "doc_mes") {
    const month = parseCompetence(text);
    if (!month) return { state, reply: invalidMonthText };
    return { state, deliver: { kind: THEMES[state.theme].document, month } };
  }
  if (stage === "tema") {
    if (!trimmed && !hasAttachment) return { state };
    // Um cumprimento solto não são os dados do chamado: repete o pedido.
    if (!hasAttachment && (GREETING.test(trimmed) || thanks))
      return { state, reply: `Para eu registrar o seu chamado, ${askText(state.theme ?? 0).replace(/^Certo, /, "sobre ")}` };
    return { state: { ...state, stage: "chamado", data: {} }, open: true };
  }
  // Confirmação do cancelamento pedido pelo colaborador.
  if (stage === "cancelar") {
    const back = { ...state, stage: "chamado" };
    if (!hasAttachment && YES.test(trimmed)) return { state: closed, cancel: true };
    if (!hasAttachment && NO.test(trimmed)) return { state: back, kept: true };
    return { state: back, append: true }; // escreveu outra coisa: entra no chamado
  }
  // Chamado em andamento: "menu" abre outro assunto (o chamado continua aberto com o RH);
  // "cancelar" pede confirmação; cumprimento e "ok/obrigado" não entram no chamado.
  if (!hasAttachment && MENU_WORD.test(trimmed)) return toMenu();
  if (!hasAttachment && CANCEL_WORD.test(trimmed)) return { state: { ...state, stage: "cancelar" }, confirmCancel: true };
  if (!hasAttachment && (GREETING.test(trimmed) || thanks)) {
    const at = new Date(now).toISOString();
    const since = (key) => now - (Date.parse(data[key] || "") || 0);
    // Cumprimento: lembrete completo no máximo 1 vez por dia; senão, confirmação curta (no máximo 1 por hora).
    if (!thanks && since("remindedAt") >= REMIND_EVERY) return { state: { ...state, data: { ...data, remindedAt: at } }, remind: true };
    if (since("ackedAt") >= ACK_EVERY) return { state: { ...state, data: { ...data, ackedAt: at } }, ack: true };
    return { state, silent: true };
  }
  return { state, append: true };
}
