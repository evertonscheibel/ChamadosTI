# Simulador do chatbot Frizelo

Acesso local: http://127.0.0.1:45873/?chatbot=1 ou menu "Simulador do chatbot" na Central.

Esta entrega conversa com um agente de IA real (Hermes, modelo `openai/gpt-oss-20b`
via Groq) por texto livre, simulando o atendimento de RH antes de conectar o
WhatsApp de verdade:

- A conversa é em texto livre; não há mais um fluxo fixo de opções.
- O assistente responde sobre holerite, espelho de ponto, férias e benefícios,
  sempre lembrando que é uma simulação e que não deve receber dados reais.
- Não há protocolo, fila do RH ou gravação: cada sessão existe só em memória,
  tanto no navegador quanto no servidor da Central, e é descartada ao reiniciar
  a simulação, recarregar ou após 2 horas de inatividade.
- Nenhuma chamada à Senior, Evolution ou WAHA acontece neste fluxo, nem
  documentos oficiais ou envio de áudio. Não utilizar informações reais.

## Como funciona

```
Navegador (ChatbotSimulator.tsx)
  -> POST /api/chatbot/message { sessionId, text }    (rota pública, sem login)
  -> Central (server.mjs)
       -> chatbot-router.mjs: triagem (ver abaixo)
       -> chatbot-templates.mjs: resposta automática (sem IA)
       -> hermes-chat.mjs: resposta completa (com IA)
            -> Hermes API server local (http://127.0.0.1:8642/v1, chave bearer)
            -> Groq (modelo openai/gpt-oss-20b, com redundância — ver abaixo)
```

A chave do Hermes nunca chega ao navegador: a Central guarda `HERMES_API_URL`,
`HERMES_API_KEY` e `HERMES_API_MODELS` em `.env.local` e faz a chamada pelo
próprio backend. O histórico de cada conversa de teste fica em memória no
processo da Central, por `sessionId` (gerado no navegador), com limite de 40
mensagens e expurgo após 2 horas.

Pré-requisito: o gateway do Hermes (`D:\IA\Hermes-Frizelo`) precisa estar
rodando com `API_SERVER_ENABLED=true` no seu `data/.env`. A rota
`platform_toolsets.api_server` está configurada sem ferramentas (`[todo]`)
para caber no limite gratuito de 8.000 tokens/minuto da Groq; o mesmo ajuste
foi replicado em `platform_toolsets.whatsapp`, que herdará esta configuração
quando a integração real do WhatsApp for ligada.

### Redundância (não ficar offline)

`platforms.providers` no `config.yaml` do Hermes define três contas Groq
(`groq`, `groq2`, `groq3`, cada uma com sua própria `key_env`), expostas como
rotas `frizelo-rh`, `frizelo-rh-2`, `frizelo-rh-3` em
`platforms.api_server.extra.model_routes`. `hermes-chat.mjs` tenta em ordem
(`HERMES_API_MODELS`) e só passa para a próxima se a atual falhar com
429/5xx/timeout — isso soma o limite de tokens/minuto das três contas.

### Reduzir consumo: triagem antes da IA

Medimos uma conversa real de 10 mensagens: o custo cresce a cada turno porque
o histórico inteiro é reenviado (de ~3.400 a ~4.500 tokens por turno). Duas
mudanças atacam isso:

1. **Histórico limitado** (`hermes-chat.mjs`, `limits.maxHistoryMessages`):
   só as últimas 10 mensagens vão para o modelo a cada turno, não a conversa
   inteira.
2. **Triagem antes de chamar a IA** (`chatbot-router.mjs`): pedidos simples e
   previsíveis — saudação, confirmar/recusar, e pedir um exemplo de holerite,
   ponto, férias ou benefícios — são reconhecidos por regra local (regex, sem
   custo de IA) e respondidos com um exemplo fixo (`chatbot-templates.mjs`),
   incluindo a confirmação de identidade fictícia. Só o que sobra (dúvidas de
   verdade, contestações, qualquer coisa fora do catálogo) vai para a IA
   completa. Quando a mensagem é ambígua — não bate com a regra local nem com
   nenhum sinal de problema —, uma chamada bem mais barata à IA (sem
   histórico, poucos tokens) decide a categoria antes de, se for o caso,
   acionar a resposta completa.

   Qualquer sinal de problema/reclamação/dúvida (ex.: "errado", "não bate",
   "falta", "dúvida") nunca é resolvido por automação, mesmo citando um dos
   temas do catálogo — vai direto para a IA completa. Essa regra existe por
   causa de um caso real encontrado em teste: "tenho uma dúvida, aparece uma
   falta no meu ponto mas eu trabalhei" foi classificado como pedido de
   exemplo de ponto por um classificador de IA mais barato (sem contexto
   suficiente); por isso uma mensagem com sinal de problema nunca é
   delegada a esse classificador.

   Na conversa medida, isso elimina a chamada de IA em metade dos turnos
   (saudação, os 3 exemplos do catálogo e a confirmação de identidade), sem
   mudar o resultado percebido pelo colaborador.

Integração de produção ainda exige sessão persistente, identificação segura,
autenticação dos webhooks do WhatsApp, idempotência, fila/retry, auditoria e
ligação aos atendimentos reais da Central. Esta entrega é local e não publica
o frontend na Hostinger.

Validação: testes do backend (`npm test`), suíte da Central, TypeScript,
build e fluxo manual de conversa no navegador com o Hermes rodando.
