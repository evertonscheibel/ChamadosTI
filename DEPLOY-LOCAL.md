# Operação local — Central Frizelo

Pasta: C:\IA\ChamadosTI. Acesso: http://127.0.0.1:45873.

```powershell
Set-Location C:\IA\ChamadosTI
npm ci
npm run typecheck
npm test
npm run format:check
npm run build
.\manage.ps1 Stop
.\manage.ps1 Start
.\manage.ps1 Status
```

A gestão por PID encerra apenas o processo deste portal. A aplicação usa localhost e mantém a porta alta 45873. Nenhum serviço do conector Senior consolidado é reiniciado por esses comandos. O início após reiniciar o Windows continua manual.

Banco e anexos: data\central.sqlite. Logs: logs\server.log e logs\server-error.log. Faça backup do SQLite com o serviço parado ou usando a API própria de backup. Configuração Senior: .env.local, com referência ao arquivo privado do conector existente. Não copiar credenciais para o frontend.

A extração está em RH > Colaboradores. O resultado é exclusivo do usuário que iniciou a extração e expira em 15 minutos. A exportação não importa cadastros; a ação separada “Sincronizar ativos” cria e atualiza os acessos locais a partir da Senior, somente quando acionada pelo RH. Consultas pessoais exigem CPF e vínculo correspondente; a consulta salarial exige os cálculos explicitamente liberados em SENIOR_PAYROLL_RELEASED_CALCULATIONS.

## Diretórios

- `central/`: telas React, servidor HTTP, persistência, integrações e testes ativos.
- `scripts/serve.mjs`: entrada do servidor local; `index.tsx`: entrada da interface.
- `public/brand/`: imagens da marca utilizadas pela interface.
- `dist/`: interface gerada por `npm run build`, servida pelo servidor local.
- `data/`: banco SQLite e seus arquivos auxiliares; não remover nem versionar.
- `logs/`: saída do serviço gerenciado por `manage.ps1`.
- `work/`: arquivos de trabalho, evidências de testes, backups e cópia do código legado; não é código ativo.
- `.env.local`: configuração privada; fora do Git e da interface pública.

`manage.ps1` gerencia somente a Central. Portal do Líder, ATS e WordPress são serviços separados; seus endereços, regras de aprovação e estado de homologação estão em `INTEGRACAO-LOCAL.md`.

Para funcionamento, configuração, contas fictícias e pendências de homologação, consulte README.md. O ambiente permanece local e não foi publicado para os colaboradores.
