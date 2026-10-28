# Node.js — avaliação de 23/10/2026

## Correção complementar no servidor 10.1.1.53

Após autorização, o Node padrão do servidor foi ajustado para **22.23.4**. O binário da distribuição 20.19.2 foi preservado por desvio local registrado no `dpkg-divert`, e `/usr/bin/node` passou a apontar para `/opt/node-v22.23.4-linux-x64/bin/node`. O desvio evita que uma atualização comum do pacote sobrescreva silenciosamente esse caminho. `npm`, `npx` e `corepack` disponíveis na instalação corrigida foram vinculados em `/usr/local/bin`.

Verificados `node --version`, `/usr/bin/node --version` e ambiente reduzido com PATH `/usr/bin:/bin`: todos retornaram 22.23.4; npm/npx retornaram 10.9.9. Backup anterior em `/opt/backups/node-default-20261023/` e binário original da distribuição preservado em `/usr/bin/node.distrib` para retorno controlado.

Os serviços `bridge-industrial-backend`, `bridge-sistec-api` e `senior-hcm-connector` permaneceram ativos, com os mesmos MainPIDs antes/depois. Healths locais nas portas 5052, 3005 e 3333 retornaram HTTP 200. Nenhum desses serviços foi reiniciado nesta correção do comando padrão. Não houve migração de banco nem alteração de integrações Senior/Sistec.

## Estado após a atualização autorizada

- Windows atualizado para **Node 24.22.1** pelo MSI oficial. SHA-256 conferido com o manifesto do fornecedor; assinatura Authenticode válida da OpenJS Foundation. Instalador finalizou com código 0. Evidências em `work/node-security-20261023/`.
- A conferência inicial desta execução encontrou os cinco containers de produção já em **22.23.4**, diferentes do diagnóstico anterior. Essa troca não foi refeita nem atribuída a esta execução. Confirmados dentro dos containers: `bridge-ats`, `senior-hcm`, `portal-encarregado`, `bridge-industrial` e `painel-financeiro`.
- ATS de staging atualizado nesta execução para **22.23.4**, preservando aplicação, dados, usuário sem root, filesystem somente leitura, capacidades removidas, limites e publicação em loopback. Imagem: `bridge-ats:integration-staging-20261020-node22.23.4`.
- O staging foi preparado com cópia consistente SQLite, integridade verificada, configuração anterior privada e Dockerfile em `/opt/staging/node-security-20261023/`. A imagem anterior foi preservada como base da imagem corrigida. Um container antigo foi mantido no momento da troca, mas a conferência posterior já não o encontrou; o retorno deve usar imagem/configuração/banco preservados, sem presumir a existência desse container.
- Testes isolados da imagem: versão Node, compressão/descompressão Brotli de dados benignos e carregamento Prisma. Staging ativo: feed 200, rota privilegiada sem token 401.
- Produção: health interno 200 em Senior, Portal do Encarregado, Bridge e Financeiro; ATS login 200 e API RH sem sessão 401. Todos mantêm usuário `node`, filesystem somente leitura, `cap_drop=ALL` e `no-new-privileges`.
- Acesso público: ATS login e sessão 200; Financeiro interface 200 e API sem sessão 401. **Portal público retornou Cloudflare 525**, apesar do health interno 200. Falha de TLS/ligação com origem permanece fora da correção do runtime; não foi alterado DNS, certificado ou roteamento nesta execução.
- Local: Central, Portal e ATS reiniciados após o instalador encerrar os processos antigos. Central health 200 e ATS feed 200. Portal health continua 503 por importação antiga, já documentada antes da troca.
- Central: 18 testes, typecheck e build passaram com o novo Node. Fluxo completo local revalidado com conta temporária: abertura pelo líder, aprovação Central, criação idempotente ATS, publicação WordPress, candidatura com protocolo, contagem na Central e retirada. Fixtures e notificações removidas pelo teste.
- Aplicativos com Node próprio, como runtimes empacotados de IDEs/Codex, não foram atualizados por substituição manual. Outros terminais/ferramentas encerrados pelo instalador podem precisar ser reabertos pelo usuário.

O diagnóstico a seguir é histórico, anterior à atualização. A correção destas versões não substitui investigação de comprometimento nem resolve a pendência PHP do WordPress.

## Resultado

Os runtimes consultados estão anteriores às correções da CVE-2026-111497. A constatação é de versão afetada; não demonstra exploração nem ausência de comprometimento. Nenhum serviço foi atualizado ou reiniciado nesta avaliação.

| Ambiente consultado | Node observado | Correção mínima da mesma linha |
|---|---|---|
| Windows, executável `C:\Program Files\nodejs\node.exe` | 24.18.0 | 24.22.1 |
| VPS, container `bridge-ats` | 22.23.3 | 22.23.4 |
| VPS, container `senior-hcm` | 22.23.3 | 22.23.4 |
| VPS, container `bridge-industrial` | 22.23.3 | 22.23.4 |
| VPS, container `painel-financeiro` | 22.23.3 | 22.23.4 |
| VPS, container `portal-encarregado` | 22.23.3 | 22.23.4 |
| VPS, container `bridge-ats-integration-stage` | 22.23.3 | 22.23.4 |

As versões foram lidas executando o binário local e `docker exec ... node -p` por SSH autenticado, sem alterar dados ou configurações. Existem outros runtimes empacotados com aplicativos no Windows; não foram inventariados por versão nesta rodada. A instalação em disco não prova a versão carregada de todos os processos já iniciados.

## Aplicabilidade

O aviso oficial de 21/10 confirma a falha no decodificador Brotli e correções nas linhas 22, 24 e 26. A condição relevante é descomprimir dados Brotli controlados por atacante. Isso inclui respostas HTTP buscadas pelo servidor, e não somente o corpo de uma requisição recebida.

Não foram encontradas chamadas explícitas a Brotli no código próprio pesquisado da Central, Portal do Líder e ATS. Entretanto, a Central faz chamadas `fetch()` nas integrações, e o Portal usa Express com parser JSON. Essa inspeção parcial não exclui caminhos por bibliotecas ou pelo framework. O risco de resposta maliciosa depende dos destinos acessados e da possibilidade de um atacante controlá-los. Ausência da palavra “brotli” no código não é comprovação de segurança.

O fato de esses sistemas usarem Node.js os separa das CVEs específicas de PHP discutidas anteriormente; não os protege desta vulnerabilidade independente do Node.js. `npm audit` sem achados também não atesta atualização do executável Node ou das imagens em execução.

## Ação proposta

Atualizar Windows para Node 24.22.1 ou posterior corrigido da linha 24 e reiniciar controladamente os processos afetados. Para a VPS, preparar imagens com Node 22.23.4 ou posterior corrigido da linha 22, preservando aplicação, dados, configuração e controles existentes. A imagem precisa ser reconstruída e o container recriado; alterar apenas o Dockerfile não corrige processos existentes.

Antes da troca em produção, preparar backup consistente e imagem de retorno, testar as novas imagens isoladamente sem jobs externos, e validar serviço por serviço. Depois da troca, confirmar versão dentro de cada container, health, autenticação, autorização e funções relevantes. Não basta verificar a versão do host Docker. Firewall, TLS e execução sem root reduzem determinados riscos, mas não substituem a correção do runtime.

## Fontes primárias

- [Node.js — correções de outubro de 2026](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Vercel — aplicabilidade a respostas HTTP e Next.js](https://vercel.com/kb/bulletin/node-js-security-advisory)

O relatório cobre os alvos consultados, não todo o parque nem uma investigação forense.
