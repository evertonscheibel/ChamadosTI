// Respostas automáticas (sem IA) para os pedidos mais comuns e previsíveis do
// catálogo de RH. Mantém o mesmo tom e o mesmo aviso de "exemplo fictício"
// usados pelo assistente de IA, para a conversa não parecer dois produtos
// diferentes dependendo de quem respondeu.
export const CATALOG_TOPICS = ["holerite", "ponto", "ferias", "beneficios"];

export const welcomeMessage =
  "Olá! Posso te mostrar um exemplo de holerite, espelho de ponto, férias ou benefícios — ou você pode me contar uma dúvida.";

export const identityPrompt =
  "Para continuar, confirme que está usando uma identificação fictícia (ex.: colaboradora Ana Exemplo) — não informe CPF, senha ou dado real. Pode confirmar?";

export const identityDeclinedMessage =
  "Sem problema. Me diga como posso ajudar quando quiser.";

const examples = {
  holerite:
    "EXEMPLO FICTÍCIO — Ana Exemplo\n\nPeríodo: Setembro/2026\nProventos: R$ 3.000,00\nDescontos: R$ 300,00\nLíquido: R$ 2.700,00\n\nResumo demonstrativo; não é um documento oficial.",
  ponto:
    "EXEMPLO FICTÍCIO — Ana Exemplo\n\nPeríodo: Setembro/2026\nJornada prevista: 176h\nHoras registradas: 176h\nOcorrências: 1 marcação pendente de análise\n\nResumo demonstrativo; não é um documento oficial.",
  ferias:
    "EXEMPLO FICTÍCIO — Ana Exemplo\n\nSaldo de férias: 20 dias.\nPeríodo aquisitivo: 01/03/2025 a 28/02/2026.\nProgramação: nenhuma neste exemplo.\n\nNão representa informação da Senior.",
  beneficios:
    "EXEMPLO FICTÍCIO — Ana Exemplo\n\nVale-refeição, vale-transporte e plano de saúde (participação) são os benefícios deste exemplo.\n\nOs valores e a elegibilidade reais dependem do seu cadastro; fale com o RH para confirmar.",
};

/** Texto do exemplo fictício para um tópico do catálogo, ou undefined se não for um dos 4. */
export function exampleFor(topic) {
  return examples[topic];
}
