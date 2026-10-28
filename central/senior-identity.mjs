import { query, configuration } from "./senior.mjs";
import { normalizedCpf } from "./identity.mjs";

const error = (message, status = 502) =>
  Object.assign(new Error(message), { status });

const fields = ["NUMEMP", "TIPCOL", "NUMCAD", "NOMFUN", "NUMCPF", "DATADM"];

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Segundo "nome" do nome completo cadastrado (em geral o sobrenome). */
export function secondName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[1] || null;
}

export function lastTwoCpfDigits(cpf) {
  const cleaned = normalizedCpf(cpf);
  return cleaned ? cleaned.slice(-2) : null;
}

export function admissionYear(datadm) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(datadm || "").trim());
  return match ? Number(match[3]) : null;
}

/**
 * Localiza, ao vivo na Senior, um único vínculo ativo que bata com o CPF
 * e/ou a matrícula informados (os dois juntos, quando dados, já validam
 * titularidade). Nunca usa dado em cache: cada verificação é uma consulta
 * nova. Retorna null quando não encontra exatamente um vínculo.
 */
export async function lookupCandidate({ cpf, matricula } = {}) {
  if (!cpf && !matricula) return null;
  const company = configuration().company;
  const filters = [
    ["NUMEMP", "=", company],
    ["TIPCOL", "=", "1"],
    ["SITAFA", "<>", "7"],
  ];
  if (cpf) {
    const normalized = normalizedCpf(cpf);
    if (!normalized) return null;
    filters.push(["NUMCPF", "=", String(Number(normalized))]);
  }
  if (matricula) {
    const digits = String(matricula).replace(/\D/g, "");
    if (!digits) return null;
    filters.push(["NUMCAD", "=", String(Number(digits))]);
  }
  let rows;
  try {
    rows = await query("R034FUN", fields, filters);
  } catch (e) {
    if (e.status) throw e;
    throw error("Não foi possível verificar sua identidade agora.", 503);
  }
  if (rows.length !== 1) return null;
  const candidate = rows[0];
  if (Number(candidate.NUMEMP) !== Number(company)) return null;
  if (cpf && !normalizedCpf(candidate.NUMCPF)) return null;
  if (cpf && normalizedCpf(candidate.NUMCPF) !== normalizedCpf(cpf))
    return null;
  if (
    matricula &&
    Number(candidate.NUMCAD) !== Number(String(matricula).replace(/\D/g, ""))
  )
    return null;
  return candidate;
}

function admissaoQuestion(candidate) {
  const year = admissionYear(candidate.DATADM);
  if (year == null) return null;
  if (Math.random() < 0.5)
    return {
      key: "admissao",
      prompt: "Em que ano você entrou na empresa?",
      check: (answer) => {
        const n = parseInt(String(answer).replace(/\D/g, ""), 10);
        return n === year;
      },
    };
  const years = new Date().getFullYear() - year;
  return {
    key: "admissao",
    prompt: "Há quantos anos, aproximadamente, você está na empresa?",
    check: (answer) => {
      const n = parseInt(String(answer).replace(/\D/g, ""), 10);
      return Number.isFinite(n) && Math.abs(n - years) <= 1;
    },
  };
}

function segundoNomeQuestion(candidate) {
  const expected = secondName(candidate.NOMFUN);
  if (!expected) return null;
  return {
    key: "segundo_nome",
    prompt: "Qual é o seu segundo nome (ou sobrenome)?",
    check: (answer) => normalize(answer) === normalize(expected),
  };
}

function cpfUltimos2Question(candidate) {
  const expected = lastTwoCpfDigits(candidate.NUMCPF);
  if (!expected) return null;
  return {
    key: "cpf_ultimos_2",
    prompt: "Quais são os 2 últimos dígitos do seu CPF?",
    check: (answer) => {
      const digits = String(answer || "").replace(/\D/g, "");
      return digits.length >= 2 && digits.slice(-2) === expected;
    },
  };
}

/**
 * Monta, embaralhado, o que falta confirmar além do que já foi informado
 * (CPF e/ou matrícula). cpfKnown/matriculaKnown dizem o que o colaborador
 * já digitou (e portanto não deve ser perguntado de novo).
 */
export function buildChallenge(candidate, { cpfKnown, matriculaKnown } = {}) {
  const pool = [];
  if (!cpfKnown) {
    const q = cpfUltimos2Question(candidate);
    if (q) pool.push(q);
  }
  const seg = segundoNomeQuestion(candidate);
  if (seg) pool.push(seg);
  const adm = admissaoQuestion(candidate);
  if (adm) pool.push(adm);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

const UNKNOWN =
  /^(n[ãa]o sei|nao sei|n[ãa]o tenho|nao tenho|n[ãa]o lembro|nao lembro|n\/?a)\b/i;
export function looksUnknown(text) {
  return UNKNOWN.test(String(text || "").trim());
}
