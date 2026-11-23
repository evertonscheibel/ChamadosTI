import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import nodemailer from "nodemailer";
import { Pdf, A4, textWidth } from "./pdf.mjs";

// Gestores do atendimento: veem os indicadores de toda a equipe e recebem o
// relatório mensal em PDF. Configuração (.env.local / central.env):
//   CENTRAL_GESTORES=CPF ou identificador das contas do RH que são gestoras
//   GESTORES_EMAILS=e-mails que recebem o PDF no 1º dia útil do mês
// Sem CENTRAL_GESTORES, todo o RH continua vendo tudo (como antes).

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const OFFSET = 4 * 3600000; // America/Campo_Grande (UTC-4, sem horário de verão)
const list = (value) =>
  String(value || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function managerConfig(env) {
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
  return {
    identifiers: list(settings.CENTRAL_GESTORES).map((s) => s.replace(/\D/g, "") || s),
    emails: list(settings.GESTORES_EMAILS).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)),
    holidays: list(settings.WHATSAPP_RH_FERIADOS),
    hour: Number(String(settings.GESTORES_RELATORIO_HORA || "8").split(":")[0]) || 8,
  };
}

/** Gestor = conta do RH listada em CENTRAL_GESTORES (lista vazia: todo o RH). */
export function isManager(user, config) {
  if (!user || user.role !== "rh") return false;
  if (!config.identifiers.length) return true;
  const id = String(user.identifier || "");
  return config.identifiers.includes(id) || config.identifiers.includes(id.replace(/\D/g, ""));
}

// --- Datas no fuso de MS -------------------------------------------------------
const localDate = (ms) => new Date(ms - OFFSET);
/** "AAAA-MM-DD" do dia local -> instante (ms) da meia-noite local. */
export const localMidnight = (day) => Date.parse(`${day}T00:00:00-04:00`);
export function monthRange(year, month) {
  return { start: Date.UTC(year, month, 1) + OFFSET, end: Date.UTC(year, month + 1, 1) + OFFSET };
}
export const monthLabel = (ms) => {
  const d = localDate(ms);
  return `${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
};
const isBusinessDay = (d, holidays) =>
  d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.includes(d.toISOString().slice(0, 10));

/**
 * Relatório mensal: no 1º dia útil do mês, a partir da hora configurada, devolve o
 * mês anterior a enviar ({ key: "AAAA-MM", start, end }) se ainda não foi enviado.
 */
export function monthlyReportDue(now, { holidays = [], hour = 8, lastKey = null } = {}) {
  const today = localDate(now);
  if (!isBusinessDay(today, holidays) || today.getUTCHours() < hour) return null;
  for (let day = 1; day < today.getUTCDate(); day++) {
    if (isBusinessDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day)), holidays)) return null;
  }
  const year = today.getUTCMonth() === 0 ? today.getUTCFullYear() - 1 : today.getUTCFullYear();
  const month = (today.getUTCMonth() + 11) % 12;
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  if (key === lastKey) return null;
  return { key, ...monthRange(year, month) };
}

// --- PDF -----------------------------------------------------------------------
const duration = (ms) =>
  ms === null || ms === undefined
    ? "—"
    : ms < 3600000
      ? `${Math.round(ms / 60000)} min`
      : `${(ms / 3600000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
const percent = (part, total) => (total ? `${Math.round((part / total) * 100)}%` : "—");
const dayText = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Campo_Grande" }) : "início");
// Fim do período é exclusivo (meia-noite do dia seguinte): mostra o último dia incluído.
const lastDayText = (iso) => (iso ? dayText(new Date(Date.parse(iso) - 1).toISOString()) : "");
const rating = (value) => (value === null || value === undefined ? "—" : value.toLocaleString("pt-BR"));
function variation(now, before, { lowerIsBetter = false, unit = "" } = {}) {
  if (now === null || now === undefined || before === null || before === undefined) return "";
  if (before === 0) return now === 0 ? "=" : "novo";
  const change = Math.round(((now - before) / before) * 100);
  if (!change) return "=";
  const better = lowerIsBetter ? change < 0 : change > 0;
  return `${change > 0 ? "+" : ""}${change}%${unit}${better ? " (melhor)" : " (pior)"}`;
}
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Horários de pico em texto: dias da semana e faixas de hora com mais chegadas. */
export function peakSummary(heatmap) {
  const byDay = heatmap.map((hours, day) => ({ day, total: hours.reduce((a, b) => a + b, 0) }));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, total: heatmap.reduce((a, row) => a + row[hour], 0) }));
  const total = byDay.reduce((a, b) => a + b.total, 0);
  return {
    total,
    days: byDay.filter((d) => d.total).sort((a, b) => b.total - a.total).slice(0, 3).map((d) => ({ label: WEEKDAYS[d.day], total: d.total })),
    hours: byHour.filter((h) => h.total).sort((a, b) => b.total - a.total).slice(0, 3).map((h) => ({ label: `${h.hour}h–${h.hour + 1}h`, total: h.total })),
  };
}

export function managementPdf(report, { title = "Relatório do atendimento RH", generatedAt = new Date() } = {}) {
  const pdf = new Pdf();
  const left = 48;
  const right = A4.width - 48;
  let y = 56;
  const ensure = (space) => {
    if (y + space > A4.height - 56) {
      pdf.addPage();
      y = 56;
    }
  };
  const heading = (text) => {
    ensure(40);
    y += 14;
    pdf.text(left, y, text, { size: 12, bold: true });
    y += 8;
    pdf.line(left, y, right, y);
    y += 16;
  };
  const table = (columns, rows) => {
    const widths = columns.map((c) => c.width);
    const xs = widths.reduce((acc, w) => [...acc, acc[acc.length - 1] + w], [left]);
    ensure(36);
    pdf.rect(left, y - 11, right - left, 16, { fill: 0.93 });
    columns.forEach((c, i) => pdf.text(c.align === "right" ? xs[i + 1] - 4 : xs[i] + 4, y, c.label, { size: 8.5, bold: true, align: c.align || "left" }));
    y += 16;
    for (const row of rows) {
      ensure(16);
      row.forEach((value, i) => {
        let text = String(value ?? "");
        const max = widths[i] - 8;
        while (text.length > 1 && textWidth(text, 9) > max) text = text.slice(0, -2) + "…";
        pdf.text(columns[i].align === "right" ? xs[i + 1] - 4 : xs[i] + 4, y, text, { size: 9, align: columns[i].align || "left" });
      });
      y += 4;
      pdf.line(left, y, right, y, { width: 0.3, gray: 0.85 });
      y += 12;
    }
  };

  pdf.text(left, y, "Central de Relacionamentos Frizelo", { size: 9, gray: 0.4 });
  y += 22;
  pdf.text(left, y, title, { size: 18, bold: true });
  y += 18;
  const prev = report.previous;
  pdf.text(left, y, `Período: ${dayText(report.period?.start)} a ${lastDayText(report.period?.end)}${prev ? `  ·  comparado com ${dayText(prev.start)} a ${lastDayText(prev.end)}` : ""}`, { size: 9, gray: 0.35 });
  y += 8;

  heading("Resumo do período");
  table(
    [
      { label: "Indicador", width: 230 },
      { label: "No período", width: 90, align: "right" },
      { label: "Anterior", width: 80, align: "right" },
      { label: "Variação", width: right - left - 400, align: "right" },
    ],
    [
      ["Pedidos recebidos", report.received, prev?.received ?? "—", prev ? variation(report.received, prev.received).replace(/ \((melhor|pior)\)/, "") : ""],
      ["Chamados concluídos", report.closed, prev?.closed ?? "—", prev ? variation(report.closed, prev.closed) : ""],
      ["1ª resposta média", duration(report.firstReplyMs), duration(prev?.firstReplyMs), prev ? variation(report.firstReplyMs, prev.firstReplyMs, { lowerIsBetter: true }) : ""],
      ["Tempo médio até concluir", duration(report.resolutionMs), duration(prev?.resolutionMs), prev ? variation(report.resolutionMs, prev.resolutionMs, { lowerIsBetter: true }) : ""],
      [
        "Concluídos dentro do prazo",
        percent(report.withinDeadline, report.deadlineSample),
        prev ? percent(prev.withinDeadline, prev.deadlineSample) : "—",
        "",
      ],
      ["Satisfação (WhatsApp, 1 a 5)", rating(report.ratingAverage), rating(prev?.ratingAverage), prev ? variation(report.ratingAverage, prev.ratingAverage) : ""],
    ],
  );
  y += 4;
  pdf.text(left, y, `Fila no momento do relatório: ${report.backlog} em aberto, ${report.overdue} com prazo ultrapassado, ${report.unassigned} sem responsável.`, { size: 9 });
  y += 8;

  heading("Desempenho por atendente");
  if (report.owners.length)
    table(
      [
        { label: "Atendente", width: 140 },
        { label: "Em aberto", width: 55, align: "right" },
        { label: "Atrasados", width: 55, align: "right" },
        { label: "Concluídos", width: 60, align: "right" },
        { label: "1ª resposta", width: 65, align: "right" },
        { label: "Até concluir", width: 75, align: "right" },
        { label: "Nota", width: right - left - 450, align: "right" },
      ],
      report.owners.map((o) => [o.name, o.open, o.overdue, o.closed, o.firstReplySample ? duration(o.firstReplyMs) : "—", o.closed ? duration(o.resolutionMs) : "—", rating(o.rating)]),
    );
  else pdf.text(left, y, "Nenhum chamado no período.", { size: 9 }), (y += 16);

  heading("Por serviço");
  const services = report.services.filter((s) => s.received || s.open || s.closed);
  if (services.length)
    table(
      [
        { label: "Serviço", width: 260 },
        { label: "Recebidos", width: 80, align: "right" },
        { label: "Fila atual", width: 80, align: "right" },
        { label: "Concluídos", width: right - left - 420, align: "right" },
      ],
      services.map((s) => [s.name, s.received, s.open, s.closed]),
    );
  else pdf.text(left, y, "Sem movimentação no período.", { size: 9 }), (y += 16);

  heading("Horários de pico (chegada dos pedidos)");
  const peak = peakSummary(report.heatmap || []);
  if (peak.total) {
    pdf.text(left, y, `Dias com mais pedidos: ${peak.days.map((d) => `${d.label} (${d.total})`).join(", ")}`, { size: 9 });
    y += 14;
    pdf.text(left, y, `Horários com mais pedidos: ${peak.hours.map((h) => `${h.label} (${h.total})`).join(", ")}`, { size: 9 });
    y += 14;
  } else {
    pdf.text(left, y, "Sem pedidos no período.", { size: 9 });
    y += 14;
  }

  ensure(30);
  y += 18;
  pdf.text(
    left,
    y,
    `Gerado em ${generatedAt.toLocaleString("pt-BR", { timeZone: "America/Campo_Grande" })}. Tempos em horas corridas; notas internas não contam como resposta. Detalhes na tela Indicadores da Central.`,
    { size: 7.5, gray: 0.45 },
  );
  return pdf.toBuffer({ title });
}

// --- Envio mensal ----------------------------------------------------------------
export function createManagerMailer({ smtp, config, log = console.log, transport } = {}) {
  const enabled = Boolean(smtp?.host) && config.emails.length > 0;
  if (!enabled) return { enabled: false, send: async () => false };
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
  async function send({ label, pdf, report }) {
    try {
      await mailer.sendMail({
        from: smtp.from,
        to: config.emails,
        subject: `[Central RH] Relatório do atendimento · ${label}`,
        text: [
          `Relatório do atendimento do RH · ${label}`,
          "",
          `Pedidos recebidos: ${report.received}`,
          `Chamados concluídos: ${report.closed}`,
          `1ª resposta média: ${duration(report.firstReplyMs)}`,
          `Concluídos dentro do prazo: ${percent(report.withinDeadline, report.deadlineSample)}`,
          "",
          "O relatório completo, com a comparação com o mês anterior, está no PDF anexo.",
          `Detalhes e listas na Central: ${smtp.centralUrl}`,
          "",
          "Envio automático da Central de Relacionamentos Frizelo, no 1º dia útil de cada mês.",
        ].join("\n"),
        attachments: [{ filename: `relatorio-atendimento-rh-${label.replace(/\s+de\s+/, "-").replace(/\s+/g, "-")}.pdf`, content: pdf, contentType: "application/pdf" }],
      });
      return true;
    } catch (e) {
      log(`[gestores] falha ao enviar o relatório de ${label}: ${e.message}`);
      return false;
    }
  }
  return { enabled: true, send };
}
