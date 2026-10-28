# Avaliação PHP e integração Frizelo — 22/10/2026

## Correção executada em 23/10/2026

A homologação foi corrigida após autorização do usuário. O diagnóstico abaixo desta seção descreve o estado anterior.

- WordPress de homologação agora executa **PHP 8.2.35**, confirmado por uma requisição HTTP ao Apache (`sapi=apache2handler`), além da leitura CLI. O endpoint temporário de verificação foi removido em seguida.
- `session.upload_progress.enabled=0` configurado em arquivo INI montado somente leitura e confirmado no runtime web. Isso atende também à [orientação adicional do PHP de 23/10](https://www.php.net/archive/2026.php#2026-10-23-1).
- Docker publica somente `127.0.0.1:8080:80`. A página responde em loopback, e a tentativa ao IP da rede `10.1.1.231:8080` deixou de obter resposta HTTP.
- Imagem oficial fixada por digest: `wordpress@sha256:7b713d74182855022c853fa70c1101cddf1a13d0f891233871294d8a5ce9aa44`. Runtime verificado antes da troca, sem rede.
- Volumes e versão dos arquivos WordPress existentes foram preservados. Os hashes de `index.php`, `wp-includes/version.php` e do plugin de integração permaneceram iguais antes/depois. A troca foi de runtime, sem atualização do core do WordPress nesta etapa.
- Backup com aplicação parada: banco por dump transacional e arquivos do volume por TAR, cuja leitura foi verificada. Arquivos locais em `C:\IA\ChamadosTI\work\php-security-20261023\`; imagem anterior preservada em `frizelo-wordpress:pre-php-security-20261023` e compose anterior salvo. Não foram excluídos volumes.
- Raiz, Trabalhe Conosco e página de login responderam HTTP 200. Fluxo local completo revalidado: abertura do líder, aprovação na Central, criação idempotente ATS, publicação WordPress, candidatura com protocolo, total na Central e retirada. Registros sintéticos foram removidos.
- O container MariaDB permaneceu saudável. O site público da hospedagem terceirizada não foi alterado e sua correção continua sem comprovação por falta de acesso atual.

## Conclusão

Não é possível atestar ausência de exposição. A homologação WordPress apresenta PHP anterior à correção emergencial e publicação de porta além de localhost. A versão e a aplicação dos patches no site público ainda não foram confirmadas. Vulnerabilidade não é prova de invasão; esta avaliação não analisou integralmente logs ou indicadores de comprometimento.

## Avisos oficiais consultados

Em 21/10, o PHP publicou correções para CVE-2026-109618 e CVE-2026-109619, que podem permitir execução remota sem autenticação. As versões corrigidas indicadas são 8.2.35, 8.3.36, 8.4.27 e 8.5.12. O aviso abrange os principais modos de execução web e destaca mod_php. A atualização é a solução completa; controles de aplicação e firewall não substituem o patch.

- [PHP — aviso oficial](https://www.php.net/archive/2026.php#2026-10-21-5)
- [PHP — detalhes da CVE-2026-109618](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w)
- [PHP — detalhes da CVE-2026-109619](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp)

## Evidência local, somente leitura

| Componente | Evidência | Avaliação |
|---|---|---|
| WordPress de homologação | Container `frizelo-homolog-wp`; WordPress 6.8.1; PHP CLI 8.2.29, compilado em julho/2025 | Runtime anterior às correções; não foi encontrada evidência de backport |
| PHP web | `apache2ctl -M` mostra `php_module` e `mpm_prefork`; biblioteca `libphp.so` com data de julho/2025 | mod_php habilitado; a leitura CLI sozinha não substitui comprovação do runtime web corrigido |
| Publicação de rede | Docker publica 8080 sem HostIp restrito; conexão local ao IP `10.1.1.231:8080` retornou HTTP 301 | Não limitado a localhost. Resposta pelo próprio IP não comprova alcance a partir de outra máquina ou da internet |
| Configuração CLI | `memory_limit=128M`, `post_max_size=8M`, `session.upload_progress.enabled=On` | Snapshot CLI, não comprovação das diretivas efetivas do Apache |
| Central, Portal do Líder e ATS | Implementações Node.js/TypeScript | As falhas específicas do runtime PHP não se aplicam diretamente a esses processos; permanecem riscos de integração |
| Conector PHP local | Feed público e candidatura via HTTP; escapes de saída, nonce, redirecionamentos HTTP desabilitados; sem token privilegiado do ATS no arquivo revisado | Não permite concluir segurança do runtime PHP nem de todo o WordPress |

## Produção: não confirmado

As requisições HTTPS normais ao domínio e à página de login encontraram desafio Cloudflare, incluindo HTTP 403 com `cf-mitigated: challenge`. Não houve tentativa de contornar a proteção nem envio de credenciais após esse bloqueio. Não foi possível confirmar PHP web, build/backport, plugins, patch aplicado, reinício de workers ou estado de comprometimento no servidor real. Não confundir o container local com a hospedagem do site público.

## Integração e limites de confiança

O código revisado do WordPress consulta o feed público e envia candidaturas; ele não deve receber o token de serviço usado pela Central para aprovar, criar ou publicar vagas. Preservar essa separação e restringir o acesso do servidor WordPress às APIs privilegiadas reduz o impacto de eventual comprometimento do site. Não elimina o risco aos dados e às credenciais existentes no próprio WordPress.

No handler local de candidatura ATS e no conector PHP revisados não foi identificado rate limit ou CAPTCHA no próprio handler. Proteções eventualmente existentes em middleware, proxy ou hospedagem não foram comprovadas nesta rodada. Nonce de visitante não deve ser considerado proteção contra robôs. Este é um ponto adicional de endurecimento, separado das CVEs do runtime.

## Próximas ações concretas

1. Homologação: restringir a publicação ao loopback ou interromper temporariamente o WordPress enquanto a imagem PHP corrigida é preparada. Antes de recriar containers, preservar volumes e realizar backup consistente de banco e arquivos. Atualizar a imagem, validar o PHP web e refazer o percurso de candidatura e publicação. Não executar `docker compose down -v`.
2. Produção: identificar painel e responsável pela hospedagem; obter versão/build PHP efetivamente usada pelo site e comprovação das duas correções, incluindo backport quando aplicável. Confirmar reinício dos processos web após o patch. Atualizar só o plugin ou WordPress não é evidência de correção do runtime.
3. Sem comprovação rápida do patch de produção, tratar o site como potencialmente afetado e combinar correção ou contenção urgente com quem administra a hospedagem. WAF/Cloudflare não é comprovação suficiente de remediação.
4. Após correção, verificar páginas públicas, administração, formulários, candidatura, feed e logs. Investigar comprometimento separadamente caso os logs ou arquivos indiquem atividade suspeita.

Nenhuma imagem, serviço, arquivo de produção, configuração de rede ou conta foi alterada nesta avaliação. O diagnóstico e as ações propostas estão preparados para execução controlada.
