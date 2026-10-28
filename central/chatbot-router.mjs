import { classifyWithAI } from "./hermes-chat.mjs";

// Categorias que uma mensagem pode receber. "duvida" é o caminho seguro: vai
// sempre para a IA completa (com todo o contexto e as regras de escopo).
const CATEGORIES = new Set([
  "saudacao",
  "confirmacao",
  "negacao",
  "holerite",
  "ponto",
  "ferias",
  "beneficios",
  "duvida",
]);

const GREETING = /^(oi+|ol[áa]|bom dia|boa tarde|boa noite|menu|in[íi]cio)\b/i;
// "pode" sozinho é ambíguo ("pode confirmar" vs. "pode me mostrar...?"), por
// isso só conta como confirmação em frases específicas, nunca isolado.
const YES =
  /^(sim|claro|confirmo|confirmar|concordo|autorizo|ok|certo|t[áa] bom|isso mesmo|beleza|pode (confirmar|registrar|prosseguir|seguir))\b/i;
const NO = /^(n[ãa]o|cancela|cancelar|deixa pra l[áa]|esquece)\b/i;
const TOPIC_PATTERNS = [
  [/holerite|contracheque|sal[áa]rio l[íi]quido/i, "holerite"],
  [/esp[ée]lho de ponto|marca[çc][ãa]o de ponto|\bponto\b/i, "ponto"],
  [/f[ée]rias/i, "ferias"],
  [
    /benef[íi]cio|vale.?refei[çc][ãa]o|vale.?transporte|plano de sa[úu]de/i,
    "beneficios",
  ],
];
// Qualquer sinal de problema/reclamação/dúvida real empurra para a IA, mesmo
// que a mensagem também cite um dos tópicos do catálogo — um pedido de
// exemplo e uma contestação não podem receber a mesma resposta automática.
const PROBLEM_SIGNAL =
  /errad|contest|problema|d[úu]vida|reclama|pend[êe]nc|diverg|\bfalta\b|n[ãa]o\s+(bate|confere|consigo)/i;

/**
 * Regra local (sem custo de IA) para os casos óbvios: saudação, sim/não, e
 * pedido direto de um dos 4 tópicos do catálogo. Retorna null quando a
 * mensagem é ambígua ou tem sinal de problema — aí sim vale a pena perguntar
 * ao modelo (que decide, inclusive, se é mesmo uma "duvida").
 */
export function localGuess(text) {
  const value = text.trim();
  if (!value) return null;
  if (GREETING.test(value)) return "saudacao";
  if (YES.test(value)) return "confirmacao";
  if (NO.test(value)) return "negacao";
  if (PROBLEM_SIGNAL.test(value)) return null;
  for (const [pattern, topic] of TOPIC_PATTERNS)
    if (pattern.test(value)) return topic;
  return null;
}

/**
 * Decide se uma mensagem pode ser resolvida por automação (zero custo de IA)
 * ou precisa da IA completa. Tenta a regra local primeiro; só chama o Hermes
 * (com um prompt mínimo, sem histórico) quando o texto é ambíguo. Em caso de
 * falha do classificador, o caminho seguro é "duvida" (IA completa).
 */
export async function classify(text) {
  // Sinal de problema/reclamação: nunca delega essa decisão ao classificador
  // barato (um modelo pequeno, sem contexto, tende a prender-se à palavra do
  // catálogo — "ponto" — e perder a nuance de que é uma contestação). Manda
  // direto para a IA completa, sem gastar nem a chamada de classificação.
  if (PROBLEM_SIGNAL.test(text.trim())) return "duvida";
  const guess = localGuess(text);
  if (guess) return guess;
  const fromModel = await classifyWithAI(text);
  return fromModel && CATEGORIES.has(fromModel) ? fromModel : "duvida";
}
