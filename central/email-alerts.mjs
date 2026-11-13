import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import nodemailer from "nodemailer";

// Avisos por e-mail para a equipe do RH: chamado novo e prazo crítico.
// Fica desligado até o .env.local ter SMTP_HOST e ALERTA_EMAILS.
// O e-mail leva só protocolo, assunto, nome, canal e prazo: nunca o texto do
// chamado (pode ter dado de saúde, salário etc.). O conteúdo fica na central.

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
    pass: settings.SMTP_PASS || "",
    from: settings.SMTP_FROM || settings.SMTP_USER || "",
    recipients,
    centralUrl: String(settings.CENTRAL_URL || "http://127.0.0.1:45873").replace(/\/+$/, ""),
    // "novo,critico" (padrão) — dá para desligar um dos dois.
    events: String(settings.ALERTA_EMAIL_EVENTOS || "novo,critico")
      .split(",")
      .map((s) => s.trim()),
  };
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

/** Envio com fila simples: um e-mail por vez, erro só vai para o log. */
export function createEmailAlerts({ config = emailConfig(), log = console.log, transport } = {}) {
  if (!config.enabled) return { enabled: false, notify: async () => false, verify: async () => false };
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
  async function notify(request, kind) {
    const event = kind === "novo" ? "novo" : "critico";
    if (!config.events.includes(event)) return false;
    const message = alertMessage(request, kind, config.centralUrl);
    const job = queue.then(async () => {
      try {
        await mailer.sendMail({ from: config.from, to: config.recipients, ...message });
        return true;
      } catch (e) {
        log(`[email] falha ao avisar ${request.protocol} (${kind}): ${e.message}`);
        return false;
      }
    });
    queue = job;
    return job;
  }
  return { enabled: true, notify, verify: () => mailer.verify() };
}
