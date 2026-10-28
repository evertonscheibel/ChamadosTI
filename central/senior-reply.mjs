import { consult } from "./senior.mjs";

const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });

export function money(cents) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Tenta entender um mês/ano em texto livre ("setembro/2026", "09/2026", "2026-09", "setembro de 2026"). */
export function parseMonth(text) {
  const value = String(text || "")
    .trim()
    .toLowerCase();
  let match = /^(\d{4})-(\d{2})$/.exec(value);
  if (match) return `${match[1]}-${match[2]}`;
  match = /^(\d{1,2})[\/\-](\d{4})$/.exec(value);
  if (match) return `${match[2]}-${match[1].padStart(2, "0")}`;
  match = new RegExp(`(${MONTH_NAMES.join("|")})[^\\d]*(\\d{4})`).exec(value);
  if (match) {
    const index = MONTH_NAMES.indexOf(match[1]) + 1;
    return `${match[2]}-${String(index).padStart(2, "0")}`;
  }
  return null;
}

/** Mês atual no formato que consult() exige; usado quando o mês não importa para a consulta (férias). */
export function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function candidateUser(candidate) {
  return { id: `chat:${candidate.NUMCAD}`, identifier: candidate.NUMCPF };
}

function formatHolerite(result, month) {
  if (!result.events.length) return result.notice;
  const lines = result.events.map((e) => `${e.description}: ${money(e.cents)}`);
  return [
    `Holerite — ${month} (${result.link.name})`,
    ...lines,
    "",
    `Proventos: ${money(result.totals.earnings)}`,
    `Descontos: ${money(result.totals.deductions)}`,
    `Líquido: ${money(result.totals.net)}`,
    "",
    result.notice,
  ].join("\n");
}

function formatPonto(result, month) {
  if (!result.marks.length && !result.situations.length) return result.notice;
  const marks = result.marks
    .slice(0, 31)
    .map((m) => `${m.DATAPU} ${m.DATACC || ""} ${m.HORACC || ""}`.trim());
  const situations = result.situations
    .slice(0, 31)
    .map((s) => `${s.DATAPU}: situação ${s.CODSIT} (${s.QTDHOR || "0"}h)`);
  return [
    `Espelho de ponto — ${month} (${result.link.name})`,
    marks.length ? "Marcações:" : null,
    ...marks,
    situations.length ? "Ocorrências:" : null,
    ...situations,
    "",
    result.notice,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function formatFerias(result) {
  const periods = result.periods.map(
    (p) => `${p.INIPER} a ${p.FIMPER} — situação ${p.SITPER}`,
  );
  const history = result.history.map(
    (h) => `Gozo de ${h.INIFER} (${h.DIAFER} dias), período ${h.INIPER}`,
  );
  return [
    `Férias (${result.link.name})`,
    periods.length
      ? "Períodos aquisitivos:"
      : "Nenhum período aquisitivo encontrado.",
    ...periods,
    history.length ? "Histórico de gozo:" : null,
    ...history,
    "",
    result.notice,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function formatBeneficios(result) {
  if (!result.events.length) return result.notice;
  const lines = result.events.map((e) => `${e.description}: ${money(e.cents)}`);
  return [`Benefícios (${result.link.name})`, ...lines, "", result.notice].join(
    "\n",
  );
}

/**
 * Consulta a Senior ao vivo para o candidato já verificado e devolve texto
 * pronto para o chat. "ferias" ignora o mês internamente (consult() só
 * exige o formato), as demais usam o mês informado.
 */
export async function realReply(candidate, kind, month) {
  if (!["holerite", "ponto", "ferias", "beneficios"].includes(kind))
    throw error("Consulta inválida.");
  const user = candidateUser(candidate);
  const effectiveMonth = kind === "ferias" ? currentMonth() : month;
  if (!effectiveMonth) throw error("Informe o mês (ex.: 09/2026).");
  const result = await consult(user, kind, effectiveMonth);
  if (kind === "holerite") return formatHolerite(result, effectiveMonth);
  if (kind === "ponto") return formatPonto(result, effectiveMonth);
  if (kind === "ferias") return formatFerias(result);
  return formatBeneficios(result);
}
