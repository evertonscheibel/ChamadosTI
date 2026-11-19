import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import nodemailer from "nodemailer";

// Avisos por e-mail para a equipe do RH: chamado novo (na hora) e um resumo
// diário dos prazos (vencidos, perto do fim, 1ª resposta atrasada, sem responsável).
// Fica desligado até o .env.local ter SMTP_HOST e ALERTA_EMAILS.
// O e-mail leva só protocolo, assunto, nome, canal e prazo: nunca o texto do
// chamado (pode ter dado de saúde, salário etc.). O conteúdo fica na central.

function readSecret(file) {
  try {
    return readFileSync(file, "utf8").replace(/\r?\n$/, "");
  } catch {
    return "";
  }
}

export function emailConfig(env) {
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
  const port = Number(settings.SMTP_PORT || 587);
  const recipients = String(settings.ALERTA_EMAILS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  return {
    enabled: Boolean(settings.SMTP_HOST) && recipients.length > 0 && settings.ALERTA_EMAIL !== "off",
    host: settings.SMTP_HOST || "",
    port,
    secure: settings.SMTP_SECURE ? settings.SMTP_SECURE === "true" : port === 465,
    user: settings.SMTP_USER || "",
    // SMTP_PASS_FILE: senha num arquivo à parte (o Docker não mexe em "$" e outros caracteres).
    pass: settings.SMTP_PASS_FILE ? readSecret(settings.SMTP_PASS_FILE) : settings.SMTP_PASS || "",
    from: settings.SMTP_FROM || settings.SMTP_USER || "",
    recipients,
    centralUrl: String(settings.CENTRAL_URL || "http://127.0.0.1:45873").replace(/\/+$/, ""),
    // "novo,resumo" (padrão) — dá para desligar um dos dois. "critico" é o nome antigo de "resumo".
    events: String(settings.ALERTA_EMAIL_EVENTOS || "novo,resumo")
      .split(",")
      .map((s) => (s.trim() === "critico" ? "resumo" : s.trim())),
    // Hora do resumo diário dos prazos (dias úteis, fuso de MS): "8" ou "8:30".
    digestMinute: digestMinute(settings.ALERTA_RESUMO_HORA),
  };
}

function digestMinute(value) {
  const m = String(value || "8").match(/^(\d{1,2})(?::(\d{2}))?$/);
  const minute = m ? Number(m[1]) * 60 + Number(m[2] || 0) : 8 * 60;
  return minute < 24 * 60 ? minute : 8 * 60;
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Campo_Grande", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "sem prazo";
const clean = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();

/**
 * request: { protocol, subject, requester_name, channel, due_at }
 * kind: "novo" | "primeira" | "laranja" | "vermelho"
 */
export function alertMessage(request, kind, centralUrl) {
  const heading = {
    novo: "Novo chamado na central",
    primeira: "1ª resposta atrasada",
    laranja: "Prazo perto do fim",
    vermelho: "Prazo estourado",
  }[kind];
  const subject = `[Central RH] ${heading}: ${clean(request.protocol)} · ${clean(request.subject)}`.slice(0, 200);
  const rows = [
    ["Chamado", request.protocol],
    ["Assunto", request.subject],
    ["Colaborador", request.requester_name],
    ["Canal", request.channel],
    ["Prazo de resposta", when(request.due_at)],
  ];
  const text = [
    heading,
    "",
    ...rows.map(([k, v]) => `${k}: ${clean(v)}`),
    "",
    `Abrir a central: ${centralUrl}`,
    "",
    "Aviso automático da Central de Relacionamentos Frizelo. O conteúdo do chamado fica só na central.",
  ].join("\n");
  const color = { novo: "#841c11", primeira: "#b3261e", laranja: "#c96a12", vermelho: "#b3261e" }[kind];
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;color:#2b211e">
  <div style="border-left:4px solid ${color};padding:4px 0 4px 14px;margin-bottom:16px">
    <div style="font-size:12px;color:#7a6a64;text-transform:uppercase;letter-spacing:.5px">Central de Relacionamentos Frizelo</div>
    <div style="font-size:20px;font-weight:bold;color:${color}">${escapeHtml(heading)}</div>
  </div>
  <table style="border-collapse:collapse;font-size:14px;width:100%">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#7a6a64;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:bold">${escapeHtml(clean(v))}</td></tr>`,
      )
      .join("")}
  </table>
  <p style="margin:20px 0"><a href="${escapeHtml(centralUrl)}" style="background:#841c11;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Abrir a central</a></p>
  <p style="font-size:12px;color:#7a6a64">Aviso automático. O conteúdo do chamado fica só na central.</p>
</div>`;
  return { subject, text, html };
}

export const DIGEST_GROUPS = [
  ["vencidos", "Prazo estourado", "#b3261e"],
  ["primeira", "1ª resposta atrasada", "#b3261e"],
  ["perto", "Prazo perto do fim", "#c96a12"],
  ["semResponsavel", "Sem responsável", "#841c11"],
];

/**
 * Resumo diário dos prazos: um e-mail só, com os chamados que pedem atenção.
 * groups: { vencidos, primeira, perto, semResponsavel } — listas de chamados
 * { protocol, subject, requester_name, channel, due_at }. Um chamado pode
 * aparecer em mais de um grupo. Devolve null quando não há nada a avisar.
 */
export function digestMessage(groups, centralUrl, dayLabel) {
  const sections = DIGEST_GROUPS.map(([key, title, color]) => ({ title, color, items: groups[key] || [] })).filter(
    (s) => s.items.length,
  );
  if (!sections.length) return null;
  const protocols = new Set(sections.flatMap((s) => s.items.map((r) => r.protocol)));
  const [y, mo, d] = String(dayLabel).split("-");
  const day = d ? `${d}/${mo}/${y}` : "";
  const count = protocols.size === 1 ? "1 chamado pede atenção" : `${protocols.size} chamados pedem atenção`;
  const subject = `[Central RH] Resumo dos prazos${day ? ` de ${day}` : ""}: ${count}`;
  const line = (r) => `${clean(r.protocol)} · ${clean(r.subject)} · ${clean(r.requester_name)} · prazo ${when(r.due_at)}`;
  const text = [
    `Resumo dos prazos${day ? ` · ${day}` : ""}`,
    "",
    ...sections.flatMap((s) => [`${s.title} (${s.items.length})`, ...s.items.map((r) => `- ${line(r)}`), ""]),
    `Abrir a central: ${centralUrl}`,
    "",
    "Resumo automático da Central de Relacionamentos Frizelo, uma vez por dia útil. O conteúdo dos chamados fica só na central.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;color:#2b211e">
  <div style="border-left:4px solid #841c11;padding:4px 0 4px 14px;margin-bottom:16px">
    <div style="font-size:12px;color:#7a6a64;text-transform:uppercase;letter-spacing:.5px">Central de Relacionamentos Frizelo</div>
    <div style="font-size:20px;font-weight:bold;color:#841c11">Resumo dos prazos${day ? ` · ${escapeHtml(day)}` : ""}</div>
    <div style="font-size:14px;color:#7a6a64">${escapeHtml(count)}</div>
  </div>
  ${sections
    .map(
      (s) => `<div style="font-size:15px;font-weight:bold;color:${s.color};margin:18px 0 6px">${escapeHtml(s.title)} (${s.items.length})</div>
  <table style="border-collapse:collapse;font-size:13px;width:100%">
    ${s.items
      .map(
        (r) =>
          `<tr><td style="padding:5px 10px 5px 0;font-weight:bold;white-space:nowrap">${escapeHtml(clean(r.protocol))}</td><td style="padding:5px 10px 5px 0">${escapeHtml(clean(r.subject))}<br><span style="color:#7a6a64">${escapeHtml(clean(r.requester_name))} · ${escapeHtml(clean(r.channel))}</span></td><td style="padding:5px 0;white-space:nowrap;color:#7a6a64">${escapeHtml(when(r.due_at))}</td></tr>`,
      )
      .join("")}
  </table>`,
    )
    .join("\n  ")}
  <p style="margin:22px 0"><a href="${escapeHtml(centralUrl)}" style="background:#841c11;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Abrir a central</a></p>
  <p style="font-size:12px;color:#7a6a64">Resumo automático, uma vez por dia útil. O conteúdo dos chamados fica só na central.</p>
</div>`;
  return { subject: subject.slice(0, 200), text, html };
}

/** Envio com fila simples: um e-mail por vez, erro só vai para o log. */
export function createEmailAlerts({ config = emailConfig(), log = console.log, transport } = {}) {
  if (!config.enabled)
    return { enabled: false, digestMinute: config.digestMinute, notify: async () => false, digest: async () => false, verify: async () => false };
  const mailer =
    transport ||
    nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  let queue = Promise.resolve();
  function send(message, what) {
    const job = queue.then(async () => {
      try {
        await mailer.sendMail({ from: config.from, to: config.recipients, ...message });
        return true;
      } catch (e) {
        log(`[email] falha ao enviar ${what}: ${e.message}`);
        return false;
      }
    });
    queue = job;
    return job;
  }
  /** Aviso na hora: só chamado novo. Prazos vão no resumo diário (digest). */
  async function notify(request, kind) {
    if (kind !== "novo" || !config.events.includes("novo")) return false;
    return send(alertMessage(request, kind, config.centralUrl), `aviso de ${request.protocol} (${kind})`);
  }
  async function digest(groups, dayLabel) {
    if (!config.events.includes("resumo")) return false;
    const message = digestMessage(groups, config.centralUrl, dayLabel);
    return message ? send(message, `resumo dos prazos de ${dayLabel}`) : false;
  }
  return { enabled: true, digestMinute: config.digestMinute, notify, digest, verify: () => mailer.verify() };
}
