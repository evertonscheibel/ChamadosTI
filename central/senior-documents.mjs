import { Pdf, A4 } from "./pdf.mjs";
import { money } from "./senior-reply.mjs";

// Documentos em PDF montados pela central com os dados consultados na Senior.
// São documentos de consulta: não substituem o holerite/espelho oficial da Senior.

const MARGIN = 40;
const RIGHT = A4.width - MARGIN;
const BOTTOM = A4.height - 70;
const stamp = (date = new Date()) =>
  date.toLocaleString("pt-BR", { timeZone: "America/Campo_Grande", dateStyle: "short", timeStyle: "short" });
const competence = (month) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

function header(pdf, title, month, person) {
  pdf.rect(MARGIN, 36, RIGHT - MARGIN, 54, { fill: 0.92 });
  pdf.text(MARGIN + 14, 58, "FRIZELO", { size: 16, bold: true });
  pdf.text(MARGIN + 14, 76, title, { size: 11 });
  pdf.text(RIGHT - 14, 58, `Competência ${competence(month)}`, { size: 11, bold: true, align: "right" });
  pdf.text(RIGHT - 14, 76, "Fonte: Senior HCM", { size: 9, align: "right", gray: 0.35 });
  pdf.text(MARGIN, 114, "Colaborador", { size: 8, gray: 0.4 });
  pdf.text(MARGIN, 128, person.NOMFUN, { size: 11, bold: true });
  pdf.text(RIGHT, 114, "Matrícula", { size: 8, gray: 0.4, align: "right" });
  pdf.text(RIGHT, 128, String(person.NUMCAD), { size: 11, bold: true, align: "right" });
  pdf.line(MARGIN, 140, RIGHT, 140);
  return 160;
}

function footer(pdf, page, pages) {
  const note =
    "Documento de consulta gerado pela Central de Relacionamento Frizelo com dados da Senior HCM. Não substitui o documento oficial. " +
    `Emitido em ${stamp()}.`;
  Pdf.wrap(note, RIGHT - MARGIN - 50, 7.5).forEach((line, i) =>
    pdf.text(MARGIN, A4.height - 40 + i * 10, line, { size: 7.5, gray: 0.45 }),
  );
  pdf.text(RIGHT, A4.height - 40, `${page}/${pages}`, { size: 7.5, gray: 0.45, align: "right" });
}

/** Distribui linhas em páginas, repetindo cabeçalho e títulos de coluna. */
function paginate(title, month, person, rows, drawColumns, drawRow, rowHeight, after) {
  const pdf = new Pdf();
  let y = header(pdf, title, month, person);
  y = drawColumns(pdf, y);
  for (const row of rows) {
    if (y + rowHeight(row) > BOTTOM) {
      pdf.addPage();
          y = drawColumns(pdf, header(pdf, title, month, person));
    }
    y = drawRow(pdf, y, row);
  }
  if (after) {
    if (y + 90 > BOTTOM) {
      pdf.addPage();
          y = header(pdf, title, month, person);
    }
    after(pdf, y);
  }
  pdf.pages.forEach((ops, i) => {
    pdf.ops = ops;
    footer(pdf, i + 1, pdf.pages.length);
  });
  return pdf;
}

/** result = retorno de consult(..., "holerite", ...) com eventos. */
export function holeritePdf(result, person, month) {
  const COL = { code: MARGIN, desc: MARGIN + 46, ref: 360, earn: 455, ded: RIGHT };
  const informative = result.events.filter((e) => Number(e.type) === 4);
  const rows = result.events.filter((e) => Number(e.type) !== 4);
  const columns = (pdf, y) => {
    pdf.rect(MARGIN, y - 12, RIGHT - MARGIN, 18, { fill: 0.95 });
    pdf.text(COL.code + 4, y, "Cód.", { size: 8, bold: true });
    pdf.text(COL.desc, y, "Descrição", { size: 8, bold: true });
    pdf.text(COL.ref, y, "Referência", { size: 8, bold: true, align: "right" });
    pdf.text(COL.earn, y, "Proventos", { size: 8, bold: true, align: "right" });
    pdf.text(COL.ded - 4, y, "Descontos", { size: 8, bold: true, align: "right" });
    return y + 20;
  };
  const row = (pdf, y, e) => {
    const earning = [1, 2, 5].includes(Number(e.type));
    pdf.text(COL.code + 4, y, String(e.code), { size: 9 });
    pdf.text(COL.desc, y, String(e.description).slice(0, 48), { size: 9 });
    pdf.text(COL.ref, y, String(e.reference ?? "").replace(".", ","), { size: 9, align: "right" });
    pdf.text(earning ? COL.earn : COL.ded - 4, y, money(e.cents), { size: 9, align: "right" });
    pdf.line(MARGIN, y + 5, RIGHT, y + 5, { gray: 0.88 });
    return y + 17;
  };
  const totals = (pdf, y) => {
    y += 8;
    pdf.text(COL.ref, y, "Total de proventos", { size: 9, align: "right" });
    pdf.text(COL.earn, y, money(result.totals.earnings), { size: 9, bold: true, align: "right" });
    y += 15;
    pdf.text(COL.ref, y, "Total de descontos", { size: 9, align: "right" });
    pdf.text(COL.ded - 4, y, money(result.totals.deductions), { size: 9, bold: true, align: "right" });
    y += 12;
    pdf.rect(300, y, RIGHT - 300, 24, { fill: 0.9 });
    pdf.text(312, y + 16, "Líquido a receber", { size: 10, bold: true });
    pdf.text(RIGHT - 10, y + 16, money(result.totals.net), { size: 12, bold: true, align: "right" });
    y += 42;
    if (result.paymentDate) pdf.text(MARGIN, y, `Data de pagamento: ${result.paymentDate}`, { size: 9 });
    if (informative.length) {
      y += 20;
      pdf.text(MARGIN, y, "Bases e informativos", { size: 9, bold: true });
      for (const e of informative.slice(0, 10)) {
        y += 14;
        pdf.text(MARGIN, y, String(e.description).slice(0, 60), { size: 8.5, gray: 0.3 });
        pdf.text(COL.earn, y, money(e.cents), { size: 8.5, gray: 0.3, align: "right" });
      }
    }
  };
  return paginate("Demonstrativo de pagamento", month, person, rows, columns, row, () => 17, totals).toBuffer({
    title: `Holerite ${competence(month)} - ${person.NOMFUN}`,
  });
}

/** Minutos (como a Senior guarda horas e marcações) -> "HH:MM". */
export function hhmm(value) {
  const text = String(value ?? "").trim();
  if (/^\d{1,2}:\d{2}$/.test(text)) return text.padStart(5, "0");
  const minutes = Number(text);
  if (!Number.isFinite(minutes)) return text;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
const dayKey = (ddmmyyyy) => String(ddmmyyyy).split("/").reverse().join("-");
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** result = retorno de consult(..., "ponto", ...); names = { CODSIT: descrição }. */
export function espelhoPdf(result, person, month, names = {}) {
  const days = new Map();
  const day = (date) => {
    if (!days.has(date)) days.set(date, { date, marks: [], situations: [] });
    return days.get(date);
  };
  for (const m of result.marks) day(m.DATAPU || m.DATACC).marks.push(hhmm(m.HORACC));
  for (const s of result.situations)
    day(s.DATAPU).situations.push(`${names[s.CODSIT] || `Situação ${s.CODSIT}`} ${hhmm(s.QTDHOR)}`);
  const rows = [...days.values()].sort((a, b) => dayKey(a.date).localeCompare(dayKey(b.date)));
  const COL = { date: MARGIN, marks: MARGIN + 92, sit: 300 };
  const SIT_WIDTH = RIGHT - COL.sit;
  const lines = (r) => Math.max(1, ...[Pdf.wrap(r.situations.join(" · "), SIT_WIDTH, 8.5).length]);
  const columns = (pdf, y) => {
    pdf.rect(MARGIN, y - 12, RIGHT - MARGIN, 18, { fill: 0.95 });
    pdf.text(COL.date + 4, y, "Dia", { size: 8, bold: true });
    pdf.text(COL.marks, y, "Marcações", { size: 8, bold: true });
    pdf.text(COL.sit, y, "Ocorrências apuradas", { size: 8, bold: true });
    return y + 20;
  };
  const row = (pdf, y, r) => {
    const [d, m, yyyy] = r.date.split("/");
    const weekday = WEEKDAYS[new Date(Number(yyyy), Number(m) - 1, Number(d)).getDay()] || "";
    pdf.text(COL.date + 4, y, `${d}/${m} ${weekday}`, { size: 9 });
    pdf.text(COL.marks, y, r.marks.sort().join("  ") || "—", { size: 9 });
    const wrapped = Pdf.wrap(r.situations.join(" · ") || "—", SIT_WIDTH, 8.5);
    wrapped.forEach((line, i) => pdf.text(COL.sit, y + i * 11, line, { size: 8.5 }));
    const height = 17 + (wrapped.length - 1) * 11;
    pdf.line(MARGIN, y + height - 12, RIGHT, y + height - 12, { gray: 0.88 });
    return y + height;
  };
  const after = rows.length
    ? null
    : (pdf, y) => pdf.text(MARGIN, y + 10, "Nenhuma marcação ou ocorrência encontrada nesta competência.", { size: 10 });
  return paginate("Espelho de ponto", month, person, rows, columns, row, (r) => 17 + (lines(r) - 1) * 11, after).toBuffer({
    title: `Espelho de ponto ${competence(month)} - ${person.NOMFUN}`,
  });
}
