# Central de Relacionamentos Frizelo

Portal de solicitações do RH, com autenticação por CPF e senha. Homologação local: http://127.0.0.1:45873. Base do projeto: C:\IA\ChamadosTI.

## Navegação

- Colaborador: Início, Minhas solicitações e Consultas.
- RH: Visão geral, Atendimentos e Colaboradores.
- Ajuda disponível no rodapé; visitantes também têm acesso pelo menu.

Os oito serviços de RH foram mantidos. Cada pedido tem protocolo, anexos, respostas e histórico. O RH atribui responsável, prioridade e prazo, usa notas internas e conclui após responder ao colaborador. O cadastro de colaboradores vem dos ativos da Senior, identificados por CPF; o cadastro manual foi retirado. O primeiro acesso usa um código pessoal de uso único, válido por 24 horas.

Na visão geral do RH também ficam as solicitações de vaga recebidas do Portal do Líder. O líder solicita e acompanha o andamento no Portal do Líder; o RH aprova ou recusa pela Central, e a decisão retorna ao Portal do Líder com histórico. Após a aprovação, o RH cria a vaga no ATS pela Central e autoriza sua divulgação no site em uma ação separada. O candidato se inscreve no próprio site e recebe protocolo; a candidatura fica no ATS. A Central consulta os totais por etapa, mas a movimentação dos candidatos ainda acontece no ATS. A identidade única entre sistemas permanece pendente. Consulte [INTEGRACAO-LOCAL.md](INTEGRACAO-LOCAL.md) para o estado verificado da integração local.

## Executar e verificar

Requer Node.js 24 ou superior. Execute na pasta do projeto:

```powershell
npm ci
npm run typecheck
npm test
npm run format:check
npm run build
.\manage.ps1 Start
.\manage.ps1 Status
```

`manage.ps1 Stop` encerra apenas este portal. A porta 45873 fica restrita a localhost. O desenvolvimento usa 45875 com proxy para a API. O início após reiniciar o Windows é manual.

Os testes utilizam banco e porta isolados. `CENTRAL_TEST_ROOT` permite definir a pasta temporária. Dados persistentes ficam em `data/central.sqlite`; faça backup com o serviço parado ou pela API de backup SQLite. Logs ficam em `logs/`. Configurações e dados não entram no Git.

## Senior HCM

A integração é somente leitura. Configure no arquivo privado `.env.local`:

```dotenv
SENIOR_ENABLED=true
SENIOR_ENV_FILE=C:\IA\senior-hcm-connector\.env
SENIOR_BENEFIT_EVENTS=
SENIOR_PAYROLL_RELEASED_CALCULATIONS=
```

O arquivo referenciado fornece a conexão consolidada. Credenciais ficam no servidor. `SENIOR_BENEFIT_EVENTS` recebe os códigos de eventos homologados pelo RH. `SENIOR_PAYROLL_RELEASED_CALCULATIONS` recebe os CODCAL que o RH autorizou publicar, separados por vírgula. O valor `*` autoriza todas as folhas mensais encerradas, inclusive futuros encerramentos; folhas em processamento continuam bloqueadas. Sem códigos ou `*`, nenhuma folha é publicada. Reinicie o portal depois de alterar a configuração.

Consultas pessoais validam o CPF e os vínculos NUMEMP/TIPCOL/NUMCAD. Folha usa R044CAL/R046VER/R008EVC; férias usam R040PER/R040FEM; ponto usa R070ACC/R066SIT. Benefícios são identificados somente por códigos configurados. As consultas são sequenciais, limitadas a 30 segundos por chamada e 8 MB por resposta, com HTTPS e certificado validado.

### Exportar colaboradores

RH > Colaboradores > Extrair base completa. A leitura de R034FUN inclui todos os tipos e situações da empresa configurada, inclusive desligados, com subdivisão automática das faixas de matrícula. Campos: NUMEMP, TIPCOL, NUMCAD, NOMFUN, NUMCPF, CODFIL, DATADM e SITAFA. Salários, folha e ponto não fazem parte desse CSV cadastral.

O resultado só fica disponível após a conclusão. É mantido em memória durante 15 minutos, acessível ao RH que iniciou a extração. Há uma extração global por vez; erros não liberam arquivo parcial. O CSV usa UTF-8 com BOM, ponto e vírgula, aspas e proteção contra fórmulas. No Excel, importe a coluna CPF como Texto para preservar zeros à esquerda. A exportação não modifica a Senior e não cria contas no portal. A sincronização de ativos, descrita abaixo, cadastra os colaboradores localmente.

## Homologação

Contas fictícias: colaborador `000.000.001-91` e RH `000.000.002-72`, senha `FrizeloDemo!2026`. Consultas pessoais reais estão bloqueadas nessas contas; a conta RH de homologação pode executar a exportação autorizada neste ambiente local. As contas de demonstração precisam ser substituídas antes de expor o portal a colaboradores.

Pendentes: modelos e homologação dos PDFs oficiais, definição dos códigos de benefícios, validação da conexão de ponto e liberação dos cálculos pelo RH. Também é necessário definir hospedagem com HTTPS, contas reais de atendimento, rotina de backup, marca oficial e política operacional. A versão atual é local; não houve push nem publicação externa.

## Manutenção

O código ativo está em `central/`, com entrada `index.tsx` e servidor `scripts/serve.mjs`. O código herdado sem uso foi retirado da árvore ativa; a cópia reversível fica em `work/legacy-before-audit/`, ignorada pelo Git e pelo TypeScript. Foram removidas as dependências antigas de IA, PDF, gráficos e roteamento. `npm audit` deve ser executado periodicamente; seu resultado é um retrato das versões e dos avisos do momento.

A proposta funcional usa solicitações, filas e notas internas como no Jira Service Management para RH. Os prazos atuais são definidos por protocolo, sem SLA automático por calendário útil.

### Sincronizar colaboradores ativos

RH > Colaboradores > Sincronizar ativos. A primeira importação real de 08/10/2026 trouxe 779 empregados ativos com 779 CPFs válidos. Foram criados 779 cadastros locais; não houve CPF inválido ou conflito de perfil. A lista é paginada em 50 colaboradores e permite busca.

O quadro usa TIPCOL=1 e SITAFA diferente de 7 na R034FUN da empresa configurada, abrangendo suas filiais. Férias e afastamentos continuam no quadro; esta seleção não herda exclusões de setor/filial do Portal do Líder. A leitura é sequencial, com subdivisão por limite. Toda a leitura termina antes de aplicar a transação local.

CPF com dígitos válidos identifica um acesso; múltiplos vínculos do mesmo CPF são registrados em senior_accounts. Nome e filial são atualizados; senha e setor já validado localmente são preservados. A Senior não é alterada e perfis RH não são transformados em colaboradores. Novos usuários ficam com acesso pendente, sem senha padrão. O RH gera o código e o colaborador define a própria senha.

Em sincronizações completas sem pendências cadastrais, contas anteriormente gerenciadas pela Senior e ausentes do quadro ativo são desativadas, com sessões e códigos revogados. Protocolos e histórico permanecem. CPF inválido ou nome ausente é sinalizado e impede desativações automáticas nessa rodada. Snapshot vazio, falha de consulta ou nomes divergentes para um CPF não aplica mudanças parciais. A sincronização é manual, não uma atualização contínua de desligamentos.

A exportação do cadastro completo, inclusive desligados, permanece separada em “Exportação do histórico cadastral”. O botão de cadastro manual foi removido e a API recusa esse cadastro. A lista operacional mostra somente cadastros ativos sincronizados; contas fictícias não aparecem nela. Backup anterior à importação: work/backups/before-active-import-20261008.sqlite.

## Gestão, indicadores e histórico

RH > Visão geral contém os indicadores, com períodos móveis de 7, 30 e 90 dias ou todo o histórico. Solicitações das contas demo ficam excluídas por padrão; o RH pode incluí-las para testar. O painel é exclusivo do RH. “Atualizar indicadores” obtém um novo cálculo; não há monitoramento contínuo nem avisos externos automáticos.

Recebidas usam a data de abertura no período. Concluídas contam os pedidos atualmente encerrados cuja data de conclusão cai no período, mesmo que tenham sido abertos antes. Fila, atrasos, responsáveis, ausência de primeira resposta e envelhecimento consideram todos os pedidos em aberto agora. A primeira resposta média usa a primeira mensagem pública do RH nos pedidos recebidos no período; notas internas não entram. O tempo médio até conclusão usa data de abertura até o encerramento, em horas corridas, sem descontar a espera pelo colaborador. As amostras ficam visíveis; ausência de amostra não vira zero.

Cumprimento de prazo usa o prazo salvo no encerramento, para não mudar quando o prazo atual é editado depois. Pedidos antigos sem prazo comprovado no encerramento não entram nessa amostra. Datas antigas de conclusão são recuperadas somente quando existe o evento correspondente no histórico; não são inventadas a partir de updated_at. Ao reabrir, a conclusão atual e seu prazo são limpos; os eventos históricos continuam registrados.

A distribuição mostra serviço, responsável, idade da fila e entradas/conclusões por dia no fuso de Cuiabá. O histórico por protocolo passa a registrar mensagens, notas internas, anexos por quantidade, alterações de status, prioridade, responsável e prazo, com autor/data e valores anterior/novo. O nome do autor é preservado nos novos eventos, mesmo após atualização cadastral. Eventos internos ficam ocultos do colaborador. O histórico anterior foi preservado.

Backup anterior à migração gerencial: work/backups/before-management-20261008.sqlite.
