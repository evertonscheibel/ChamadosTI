import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";

// Acesso da equipe do RH por e-mail corporativo. O gestor libera o e-mail; a pessoa
// recebe um link de uso único para criar a senha. "Esqueci a senha" só envia link
// para e-mail já liberado e responde sempre igual (não revela quem tem conta).
//   RH_EMAIL_DOMINIOS=frizelo.com.br (separados por vírgula)

export const LINK_HOURS = { invite: 72, reset: 1 };

export function staffDomains(env = process.env) {
  return String(env.RH_EMAIL_DOMINIOS || "frizelo.com.br")
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

/** E-mail válido e do domínio da empresa; devolve o motivo quando não é. */
export function emailProblem(email, domains) {
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || email.length > 120) return "Informe um e-mail válido.";
  const domain = email.split("@")[1];
  if (!domains.includes(domain)) return `Use um e-mail corporativo (${domains.map((d) => `@${d}`).join(", ")}).`;
  return null;
}

/** Regras da senha da equipe do RH. */
export function passwordProblem(password, email = "") {
  if (typeof password !== "string" || password.length < 10) return "A senha precisa ter pelo menos 10 caracteres.";
  if (password.length > 256) return "A senha pode ter no máximo 256 caracteres.";
  if (!/[a-zA-ZÀ-ÿ]/.test(password) || !/\d/.test(password)) return "Use letras e números na senha.";
  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return "A senha não pode conter o seu e-mail.";
  if (/^(.)\1+$/.test(password) || /frizelo|senha|123456/i.test(password)) return "Escolha uma senha mais difícil de adivinhar.";
  return null;
}

export const newLinkToken = () => randomBytes(32).toString("base64url");

/** Link no fragmento (#): o token não vai para o servidor nem para logs de acesso. */
export const linkUrl = (centralUrl, token) => `${centralUrl}/#senha=${token}`;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function linkMessage({ name, url, purpose }) {
  const invite = purpose === "invite";
  const hours = LINK_HOURS[purpose];
  const validity = hours === 1 ? "1 hora" : `${hours} horas`;
  const subject = invite ? "[Central RH] Crie a sua senha de acesso" : "[Central RH] Redefinir a sua senha";
  const intro = invite
    ? "Você foi incluído(a) na equipe de atendimento do RH na Central de Relacionamentos Frizelo."
    : "Recebemos um pedido para redefinir a sua senha na Central de Relacionamentos Frizelo.";
  const action = invite ? "Criar minha senha" : "Redefinir minha senha";
  const notice = invite
    ? "Se você não esperava este convite, ignore este e-mail e avise o seu gestor."
    : "Se não foi você que pediu, ignore este e-mail: a sua senha continua a mesma.";
  return {
    subject,
    text: [
      `Olá, ${name}.`,
      "",
      intro,
      `${action}: ${url}`,
      "",
      `O link vale por ${validity} e só pode ser usado uma vez. Não encaminhe este e-mail.`,
      notice,
      "",
      "Central de Relacionamentos Frizelo",
    ].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#282828;max-width:560px">
  <p>Olá, <strong>${escapeHtml(name)}</strong>.</p>
  <p>${escapeHtml(intro)}</p>
  <p style="margin:22px 0"><a href="${escapeHtml(url)}" style="background:#841c11;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${action}</a></p>
  <p style="color:#636363;font-size:12px">O link vale por ${validity} e só pode ser usado uma vez. Não encaminhe este e-mail.<br>${escapeHtml(notice)}</p>
  <p style="color:#636363;font-size:12px">Central de Relacionamentos Frizelo</p>
</div>`,
  };
}

/**
 * Envio dos links. Sem SMTP configurado, enabled=false (a central recusa convites).
 * CENTRAL_MAIL_ARQUIVO (testes): grava as mensagens em JSON Lines em vez de enviar.
 */
export function createAccessMailer({ smtp, log = console.log, transport, outbox = process.env.CENTRAL_MAIL_ARQUIVO } = {}) {
  if (outbox)
    return {
      enabled: true,
      send: async (to, message) => {
        appendFileSync(outbox, `${JSON.stringify({ to, ...message })}\n`);
        return true;
      },
    };
  if (!smtp?.host && !transport) return { enabled: false, send: async () => false };
  const mailer =
    transport ||
    nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  return {
    enabled: true,
    send: async (to, message) => {
      try {
        await mailer.sendMail({ from: smtp?.from, to, ...message });
        return true;
      } catch (e) {
        log(`[acesso] falha ao enviar e-mail: ${e.message}`);
        return false;
      }
    },
  };
}
