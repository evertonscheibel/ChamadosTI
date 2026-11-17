import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";
import { emailConfig } from "./email-alerts.mjs";

// Alertas técnicos para a TI (WhatsApp fora, Senior falhando, backup atrasado), por e-mail.
// Usa o mesmo SMTP dos avisos do RH; destinatários em ALERTA_TI_EMAILS.
// Sem dados pessoais: só o nome do problema e o motivo técnico.

export function tiConfig(env) {
  const base = emailConfig(env);
  const recipients = String((env || process.env).ALERTA_TI_EMAILS || "")
    .split(/[,;\s]+/)
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  return { ...base, recipients, enabled: Boolean(base.host) && recipients.length > 0 };
}

const REPEAT_MS = 6 * 3600000; // problema que continua: lembra a cada 6 h

/**
 * raise(key, título, detalhe): avisa uma vez (e de novo a cada 6 h enquanto durar).
 * clear(key, título): se havia aviso aberto, manda "normalizado".
 */
export function createTiAlerts({ config = tiConfig(), log = console.log, transport, now = Date.now } = {}) {
  const open = new Map(); // key -> { since, sentAt }
  const mailer = config.enabled
    ? transport ||
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.pass } : undefined,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    : null;
  let queue = Promise.resolve();
  const send = (subject, text) => {
    log(`[alerta-ti] ${subject}`);
    if (!mailer) return Promise.resolve(false);
    const job = queue.then(() =>
      mailer
        .sendMail({ from: config.from, to: config.recipients, subject: `[Central RH · TI] ${subject}`, text: `${text}\n\nAviso automático da Central de Relacionamentos Frizelo.` })
        .then(() => true)
        .catch((e) => (log(`[alerta-ti] falha ao enviar e-mail: ${e.message}`), false)),
    );
    queue = job;
    return job;
  };
  async function raise(key, title, detail) {
    const current = open.get(key);
    const t = now();
    if (current && t - current.sentAt < REPEAT_MS) return false;
    open.set(key, { since: current?.since ?? t, sentAt: t });
    const since = new Date(current?.since ?? t).toLocaleString("pt-BR", { timeZone: "America/Campo_Grande" });
    return send(current ? `Continua: ${title}` : title, `${title}\n\nMotivo: ${detail}\nDesde: ${since}`);
  }
  async function clear(key, title) {
    if (!open.has(key)) return false;
    open.delete(key);
    return send(`Normalizado: ${title}`, `${title}: voltou ao normal.`);
  }
  return { enabled: config.enabled, raise, clear, isOpen: (key) => open.has(key) };
}

/**
 * Situação do backup lida do arquivo que o backup.sh grava em /app/data.
 * Problema se a última execução falhou ou se o último sucesso tem mais de 26 h.
 */
export function backupProblem(file, nowMs = Date.now()) {
  let status;
  try {
    status = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return e.code === "ENOENT" ? null : "arquivo de situação do backup ilegível";
  }
  if (status.result === "erro") return `a última execução falhou (${String(status.at || "").slice(0, 16)})`;
  const ok = Date.parse(status.lastOk || "");
  if (!Number.isFinite(ok)) return "nenhum backup concluído registrado";
  if (nowMs - ok > 26 * 3600000) return `último backup concluído em ${status.lastOk.slice(0, 16)}`;
  return null;
}
