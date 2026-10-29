# RAG de políticas internas (fase 1 — local)

O assistente de IA (simulador e atendimento real) agora pode consultar
trechos de documentos de políticas/RH antes de responder uma dúvida. A busca
é feita localmente, por contagem de termos em comum (sem embeddings, sem
custo de API extra) — ver `central/knowledge.mjs`.

## Como alimentar

1. Exporte o conteúdo da política/documento (SharePoint, Drive, intranet)
   como texto simples ou Markdown.
2. Salve o arquivo em `data/policies/` (criada automaticamente), com
   extensão `.txt` ou `.md`. Um arquivo por assunto facilita a citação da
   fonte na resposta.
3. Nada precisa ser reiniciado: o módulo detecta arquivos novos/alterados
   pela data de modificação a cada pergunta.

`data/` não entra no controle de versão (`.gitignore`), então os documentos
ficam só nesta máquina/ambiente — adequado para conteúdo interno sensível.

## Como funciona

- Cada arquivo é dividido em trechos (parágrafos, até ~900 caracteres).
- Para cada pergunta classificada como "dúvida" (ver `chatbot-router.mjs`),
  o servidor busca os até 3 trechos com mais termos em comum com a pergunta
  e os acrescenta ao prompt do modelo, pedindo explicitamente que ele não
  invente o que não estiver no contexto.
- Sem documentos, ou sem nenhum termo em comum com a pergunta, o prompt
  segue exatamente como antes — nada muda no comportamento atual.

## Limitações conhecidas (fase 1)

- Busca por palavra-chave, não por significado: sinônimos distantes do termo
  usado no documento podem não ser encontrados. Para o volume pequeno de
  políticas de RH, isso tende a ser suficiente.
- Só `.txt`/`.md`. PDF e Word exigiriam uma biblioteca de extração de texto
  (não incluída nesta fase).
- Sem sincronização automática com o SharePoint/Drive da empresa: a
  atualização é manual, exportando o arquivo de novo quando a política
  muda.
