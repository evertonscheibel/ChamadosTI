import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const error = (message, status = 502) =>
  Object.assign(new Error(message), { status });

export function configuration() {
  let local = {};
  try {
    local = parseEnv(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const settings = { ...local, ...process.env };
  const models = (
    settings.HERMES_API_MODELS ||
    settings.HERMES_API_MODEL ||
    "frizelo-rh"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    enabled: Boolean(settings.HERMES_API_URL && settings.HERMES_API_KEY),
    url: settings.HERMES_API_URL,
    key: settings.HERMES_API_KEY,
    // Redundância: cada entrada é uma rota com sua própria conta/chave da
    // Groq (platforms.api_server.extra.model_routes no Hermes). reply()
    // tenta em ordem e só passa para a próxima se a atual falhar.
    models,
  };
}

// =============================================================================
// Limites técnicos (plano gratuito da Groq, 8.000 tokens/minuto por conta)
// =============================================================================
export const limits = {
  temperature: 0.3,
  maxOutputTokens: 400, // resposta curta: reduz tokens/minuto e custo
  maxSessionMessages: 40, // ver server.mjs: encerra a simulação ao atingir o limite
  // Só as últimas N mensagens vão para o modelo a cada turno (a sessão guarda
  // tudo, mas reenviar o histórico inteiro é o que mais pesa no consumo —
  // ver medição em CHATBOT-SIMULADOR.md). 10 = 5 trocas recentes.
  maxHistoryMessages: 10,
  requestTimeoutMs: 30000,
  classifyTimeoutMs: 10000,
  classifyMaxTokens: 6,
};

// Assuntos que o assistente pode tratar nesta etapa de teste. Mantido como
// lista explícita para refletir no prompt e, no futuro, para validar/rotear
// o escopo antes mesmo de chamar o modelo.
export const scope = [
  "holerite",
  "espelho de ponto",
  "férias",
  "benefícios",
  "dúvidas gerais sobre rotinas de RH",
];

// Onde um colaborador logado abre e acompanha um chamado real na Central.
export const ticketArea = "Minhas solicitações";

// Marcador que o modelo usa para sinalizar abertura de protocolo fictício
// (só para esta simulação). O número do protocolo é sempre gerado pelo
// servidor, nunca pelo modelo.
const protocolTag =
  /<<PROTOCOLO\s+assunto="([^"]{0,120})"\s+descricao="([^"]{0,600})"\s*>>\s*$/u;

export const systemPrompt = [
  "Você é o assistente de RH da Central de Relacionamentos Frizelo, em um ambiente de TESTE interno (não é o atendimento real pelo WhatsApp ainda).",
  "Nunca peça nem aceite CPF, senha, matrícula ou qualquer dado real de colaborador; toda informação pessoal nesta conversa é fictícia, inclusive a identidade de quem fala com você.",
  `Seu escopo é apenas: ${scope.join(", ")}. Para qualquer outro assunto (TI, financeiro, jurídico, reclamações fora de RH, etc.), explique que foge do escopo deste teste e oriente a procurar o canal correto pelos meios oficiais da empresa — não tente resolver.`,
  "Antes de mostrar qualquer exemplo de holerite, espelho de ponto ou férias (dados que seriam pessoais em um atendimento real), peça para o colaborador confirmar que está usando uma identificação fictícia (ex.: 'colaboradora Ana Exemplo') e só mostre o exemplo depois dessa confirmação explícita. Essa confirmação vale para o resto da conversa: não peça de novo depois da primeira vez.",
  "Os exemplos que você mostrar são sempre FICTÍCIOS, deixando claro que não é um documento oficial. Nunca invente portais, e-mails, telefones ou processos que não foram informados a você; se não souber o canal exato, oriente a procurar o RH.",
  `Se o colaborador trouxer uma dúvida ou problema específico que precise de acompanhamento humano, explique que o canal oficial é abrir um chamado em "${ticketArea}" na Central de Relacionamentos Frizelo (é preciso estar logado) e resuma o assunto e a descrição, pedindo confirmação explícita antes de registrar o protocolo de teste.`,
  'Só depois que o colaborador confirmar, termine sua resposta — e apenas nesse caso — com uma última linha isolada no formato exato <<PROTOCOLO assunto="..." descricao="...">>, sem nada depois dela. Nunca invente um número de protocolo: quem gera o número é o sistema, não você. Nunca mostre esse marcador em outra situação.',
  "Seja breve: respostas curtas e diretas, em português do Brasil, sem repetir o aviso de simulação em toda mensagem (uma vez já basta).",
].join(" ");

// Usado no atendimento real (colaborador já identificado por fora desta
// conversa — ver senior-identity.mjs). Nunca diz "é fictício": aqui seria
// mentira. Holerite/ponto/férias/benefícios já são respondidos com dado real
// por fora da IA (central/senior-reply.mjs); este prompt só cobre dúvidas.
export const realSystemPrompt = [
  "Você é o assistente de RH da Central de Relacionamentos Frizelo, atendendo um colaborador JÁ IDENTIFICADO — a identidade foi verificada antes desta conversa, por outro mecanismo.",
  "Nunca peça CPF, senha ou qualquer dado de verificação: isso já foi confirmado antes de você entrar na conversa.",
  "Holerite, espelho de ponto, férias e benefícios já são respondidos com dados reais por outra parte do sistema, não por você. Se o colaborador perguntar sobre esses temas aqui, é porque quer algo além do que já foi mostrado — nunca invente números, valores ou datas.",
  `Para dúvidas e problemas que precisem de acompanhamento humano, explique que o canal é abrir um chamado em "${ticketArea}" e resuma o assunto e a descrição, pedindo confirmação explícita antes de registrar.`,
  'Só depois da confirmação, termine a resposta — e apenas nesse caso — com uma última linha isolada no formato exato <<PROTOCOLO assunto="..." descricao="...">>, sem nada depois dela. O número do protocolo é gerado pelo sistema, nunca por você.',
  "Seja breve e direto, em português do Brasil.",
].join(" ");

/** Remove o marcador de protocolo do texto e devolve o pedido, se houver. */
export function extractProtocolRequest(text) {
  const match = protocolTag.exec(text);
  if (!match) return { text, request: null };
  return {
    text: text.slice(0, match.index).trim(),
    request: { subject: match[1].trim(), description: match[2].trim() },
  };
}

async function callModel(settings, model, messages, options = {}) {
  const response = await fetch(
    `${settings.url.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: limits.temperature,
        max_tokens: options.maxTokens ?? limits.maxOutputTokens,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? limits.requestTimeoutMs),
    },
  );
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw Object.assign(
      new Error(`Rota ${model} recusou (${response.status}).`),
      {
        retryable,
      },
    );
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw Object.assign(new Error(`Rota ${model} não respondeu.`), {
      retryable: true,
    });
  return content.trim();
}

export async function reply(history, options = {}) {
  const settings = configuration();
  if (!settings.enabled)
    throw error("O assistente de IA não está configurado neste ambiente.", 503);
  const trimmed = history.slice(-limits.maxHistoryMessages);
  const messages = [
    { role: "system", content: options.systemPrompt || systemPrompt },
    ...trimmed,
  ];
  let lastError;
  for (const model of settings.models) {
    try {
      const content = await callModel(settings, model, messages);
      return extractProtocolRequest(content);
    } catch (e) {
      lastError = e;
      if (e.retryable === false) break;
      // senão, tenta a próxima rota/chave (redundância)
    }
  }
  console.error("Todas as rotas do assistente de IA falharam:", lastError);
  throw error("O assistente de IA está indisponível no momento.", 503);
}

// =============================================================================
// Triagem: IA só para o que for ambíguo (ver chatbot-router.mjs)
// =============================================================================
// Prompt mínimo, sem histórico — bem mais barato que uma resposta completa.
// Usado apenas quando a regra local (chatbot-router.mjs) não reconhece a
// mensagem com confiança.
const classifyPrompt = [
  "Classifique a MENSAGEM do colaborador de RH em exatamente UMA categoria. Responda só com a palavra da categoria, em minúsculas, sem pontuação e sem explicação.",
  "Categorias: saudacao (cumprimento, sem pedido), confirmacao (concorda/autoriza algo, ex. 'sim', 'pode'), negacao (recusa/cancela algo), holerite (pede exemplo de holerite/contracheque), ponto (pede exemplo de espelho de ponto/marcação/falta), ferias (pede exemplo de férias), beneficios (pergunta genérica sobre benefícios), duvida (qualquer outra dúvida, problema ou pedido, mesmo sobre os mesmos temas, que não seja um simples pedido de exemplo).",
].join(" ");

/** Pergunta ao modelo (rota primária, sem histórico) qual categoria a mensagem é. null se indisponível/erro — o chamador deve tratar como "duvida" (caminho seguro). */
export async function classifyWithAI(text) {
  const settings = configuration();
  if (!settings.enabled) return null;
  const messages = [
    { role: "system", content: classifyPrompt },
    { role: "user", content: text.slice(0, 500) },
  ];
  try {
    const content = await callModel(settings, settings.models[0], messages, {
      maxTokens: limits.classifyMaxTokens,
      timeoutMs: limits.classifyTimeoutMs,
    });
    return content
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z]/g, "");
  } catch {
    return null;
  }
}
