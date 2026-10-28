# Atendimento real (dados da Senior) — em teste

Acesso local: http://127.0.0.1:45873/?atendimento=1 ou menu "Atendimento
(dados reais)" na Central.

Evolução do [simulador do chatbot](CHATBOT-SIMULADOR.md): em vez de exemplos
fictícios, este chat verifica a identidade do colaborador pelo próprio texto
— sem precisar logar na Central — e devolve holerite, espelho de ponto,
férias e benefícios reais, consultados ao vivo na Senior.

## Verificação de identidade

Não existe atendimento sem alguma verificação quando o dado é real — isso é
exigência da Senior, não escolha do produto. O desenho:

1. **CPF e matrícula são a chave de busca.** Pelo menos um dos dois precisa
   ser informado (o colaborador pode responder "não sei" para o que não
   lembrar). Se os dois forem dados e baterem no mesmo cadastro, a
   identidade é confirmada na hora.
2. **Se faltar um dos dois**, o que sobrou do seguinte trio é perguntado, em
   ordem embaralhada, sem repetir o que já foi informado:
   - Últimos 2 dígitos do CPF (pulado se o CPF completo já foi dado)
   - Segundo nome (ou sobrenome) cadastrado
   - Ano de admissão — ou "há quantos anos" (sorteado qual das duas formas,
     com 1 ano de tolerância na segunda)
   Esses 3 campos foram auditados contra os 783 colaboradores ativos: 100%
   preenchidos e válidos. Filial (`CODFIL`) ficou de fora por ter só 2
   valores possíveis na empresa — poder discriminatório baixo demais para
   servir de prova de identidade.
3. **Sem CPF nem matrícula**, não há como localizar o cadastro com
   segurança: a conversa é encerrada e o colaborador é direcionado ao RH.
4. Uma resposta errada em qualquer pergunta permite uma segunda tentativa;
   errando de novo, ou falhando a localização do cadastro 3 vezes, a sessão
   é bloqueada e também direciona ao RH. Digitar "reiniciar" começa de novo.

Cada verificação consulta a Senior ao vivo (nunca usa cache) e nunca grava
nada — a identidade confirmada só existe na sessão em memória.

## Depois de identificado

- Holerite, espelho de ponto, férias e benefícios: resolvidos por consulta
  direta à Senior (`central/senior.mjs#consult`, a mesma função que a Central
  logada já usa), formatada em texto — a IA nunca inventa esses números. Para
  holerite/ponto/benefícios é pedido o mês (texto livre: "09/2026",
  "setembro/2026", "setembro de 2026"); férias não depende de mês.
- Qualquer outra coisa (dúvida, problema, fora do catálogo) vai para o
  assistente de IA (Hermes/Groq), com um prompt diferente do simulador
  fictício: aqui a identidade já está confirmada, então a IA nunca pede CPF
  de novo nem finge que é tudo fictício. Dúvidas confirmadas abrem um
  protocolo de teste (`AT-0001`, …), mostrado no painel lateral — o canal
  oficial continua sendo "Minhas solicitações" para quem está logado.

## Limitações conhecidas (fase de teste)

- Latência: uma consulta à Senior já levou mais de 30s em teste. A fila de
  consultas (`central/senior.mjs`) é serializada — uma de cada vez.
- O mês informado fica em cache por sessão; pedir outro mês sem repetir o
  pedido de consulta não é reconhecido ainda.
- Sem auditoria/log de quem verificou o quê — adequado para teste, não para
  produção.
