# O que exportar do SharePoint/Drive para o RAG

Este é o pedido exato do que falta para o assistente responder dúvidas reais
com base em política escrita, em vez de arriscar uma resposta genérica.
Contexto: holerite, ponto, férias e benefícios **já respondem com dado real
da Senior** (não precisam de política escrita — só de dados). O que falta
aqui é a **regra/norma por trás** desses temas e os assuntos que a Senior não
cobre.

## Prioridade 1 — onde a IA hoje arrisca mais (sem nenhuma fonte)

| Arquivo sugerido | Conteúdo exato a exportar |
|---|---|
| `atestados-afastamentos.md` | Prazo para envio do atestado, documentos aceitos (médico, odontológico, acompanhamento), como declarar ausência, o que acontece se o prazo não for cumprido. |
| `declaracoes.md` | Quais declarações existem (vínculo, renda, tempo de serviço, outras), prazo de entrega, se precisa de justificativa. |
| `atualizacao-cadastral.md` | Quais dados o colaborador pode pedir para alterar (endereço, dependente, dados bancários, estado civil), quais exigem documento comprobatório, prazo médio. |
| `outros-assuntos.md` | O que o RH trata fora dos temas acima (se houver uma lista oficial) e para onde direcionar o que não é RH (TI, jurídico, etc. — se já existir uma orientação escrita). |

## Prioridade 2 — regras que a Senior não explica (só mostra o dado)

| Arquivo sugerido | Conteúdo exato a exportar |
|---|---|
| `ferias-regras.md` | Pode vender dias? Quantos? Como parcelar? Prazo para solicitar programação; o que acontece se vencer sem agendar. |
| `ponto-regras.md` | Como funciona banco de horas (se houver), quais justificativas de falta são aceitas, prazo para contestar uma marcação. |
| `beneficios-regras.md` | Regras de vale-transporte/refeição (data de corte, como funciona desconto), inclusão/exclusão de dependente no plano de saúde, carência. |

## Prioridade 3 — se existir

| Arquivo sugerido | Conteúdo exato a exportar |
|---|---|
| `normas-gerais-rh.md` | Código de conduta, política de home office/híbrido, horário de expediente, se forem perguntas recorrentes dos colaboradores. |

## Formato que funciona melhor com a busca atual

A busca (`central/knowledge.mjs`) divide cada arquivo em um trecho por seção
"## " — então **cada pergunta/regra deve ter seu próprio "## " no arquivo**,
não um texto corrido. Exemplo de `atestados-afastamentos.md`:

```markdown
# Atestados e afastamentos

## Qual o prazo para enviar o atestado?
O atestado deve ser enviado em até 48 horas a partir da data da ausência,
pelo campo de anexo na solicitação "Atestados e afastamentos" da Central.

## Quais documentos são aceitos?
Atestado médico ou odontológico com CRM/CRO legível, período de afastamento
e CID (quando exigido por lei). Atestados de acompanhante também são
aceitos, com o nome do colaborador e do dependente acompanhado.
```

- Um arquivo por assunto (igual à tabela acima) facilita saber de onde veio
  a resposta.
- Salve em `.md` ou `.txt`, direto em `data/policies/` (a pasta já existe).
- Não precisa reiniciar nada: a cada pergunta, o sistema relê o que tiver
  de novo ou alterado.

## O que eu preciso de você

Só o conteúdo de texto mesmo — pode ser um "copiar e colar" do documento
oficial, não precisa reescrever. Se vier em PDF/Word e for mais fácil para
você, me envie assim mesmo (nesta conversa) e eu converto para o formato
acima antes de salvar em `data/policies/`.
