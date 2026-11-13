// Gera os arquivos de configuração do servidor a partir da homologação local, sem imprimir segredos.
// Uso: node deploy/bridge-prod/gerar-env.mjs <pasta-de-saída>
// Saída: .env (compose), central.env, chatwoot.env, waha.env — copie para /opt/apps/frizelo-rh (modo 600)
// e APAGUE a pasta local depois.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("Informe a pasta de saída.");
mkdirSync(out, { recursive: true });

const parse = (file) => {
  const env = new Map();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env.set(m[1], m[2].replace(/^["']|["']$/g, ""));
  }
  return env;
};
const secret = (n = 24) => randomBytes(n).toString("hex");
const write = (name, entries) =>
  writeFileSync(join(out, name), entries.map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });

const central = parse("C:/IA/ChamadosTI/.env.local");
const chatwoot = parse("C:/IA/chatwoot-src/.env");
const pgPassword = secret();
const redisPassword = secret();
const wahaKey = secret(20);
const HOST = "10.1.1.53";

write(".env", [
  ["CHATWOOT_IMAGE", "chatwoot/chatwoot:v4.19.1"],
  ["POSTGRES_IMAGE", "pgvector/pgvector@sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f"],
  ["REDIS_IMAGE", "redis:7.4-alpine"],
  ["WAHA_IMAGE", "devlikeapro/waha@sha256:2fc1787ddbd343ed2e7d59482846d1b22aa5ca134e29aa8d42d0e88c54e24779"],
  ["CENTRAL_TAG", new Date().toISOString().slice(0, 10).replace(/-/g, "")],
  ["POSTGRES_PASSWORD", pgPassword],
  ["REDIS_PASSWORD", redisPassword],
]);

write("chatwoot.env", [
  ["SECRET_KEY_BASE", chatwoot.get("SECRET_KEY_BASE")], // o mesmo da homologação: dados migrados continuam legíveis
  ["FRONTEND_URL", `http://${HOST}:3100`],
  ["FORCE_SSL", "false"],
  ["ENABLE_ACCOUNT_SIGNUP", "false"],
  ["RAILS_ENV", "production"],
  ["NODE_ENV", "production"],
  ["INSTALLATION_ENV", "docker"],
  ["RAILS_LOG_TO_STDOUT", "true"],
  ["LOG_LEVEL", "info"],
  ["DEFAULT_LOCALE", "pt_BR"],
  ["INSTALLATION_NAME", chatwoot.get("INSTALLATION_NAME") || "Frizelo"],
  ["ACTIVE_STORAGE_SERVICE", "local"],
  ["SAFE_FETCH_ALLOW_PRIVATE_NETWORK", "true"], // webhooks para a central e o WAHA na rede interna
  ["POSTGRES_HOST", "postgres"],
  ["POSTGRES_PORT", "5432"],
  ["POSTGRES_USERNAME", "chatwoot"],
  ["POSTGRES_PASSWORD", pgPassword],
  ["POSTGRES_DATABASE", "chatwoot"],
  ["REDIS_URL", `redis://:${redisPassword}@redis:6379/0`],
  ["REDIS_PASSWORD", redisPassword],
  ["MAILER_SENDER_EMAIL", "RH Frizelo <nao-responder@frizelo.local>"],
]);

write("waha.env", [
  ["WAHA_API_KEY", wahaKey],
  ["WAHA_API_KEY_PLAIN", wahaKey], // exigido pelo WAHA quando os apps (Chatwoot) estão ligados
  ["WHATSAPP_DEFAULT_ENGINE", "NOWEB"],
  ["WAHA_APPS_ENABLED", "True"],
  ["WAHA_BASE_URL", "http://waha:3000"],
  ["REDIS_URL", `redis://:${redisPassword}@redis:6379/5`],
  ["WAHA_PRINT_QR", "false"],
  ["WAHA_DASHBOARD_ENABLED", "false"],
  ["WHATSAPP_SWAGGER_ENABLED", "false"],
  ["TZ", "America/Campo_Grande"],
]);

// Central: tudo da homologação, trocando só endereços e chaves que mudam no servidor.
const override = {
  CHATWOOT_BASE_URL: "http://chatwoot:3000",
  WAHA_URL: "http://waha:3000",
  WAHA_API_KEY: wahaKey,
  SENIOR_ENV_FILE: "/run/senior/senior.env",
  CENTRAL_URL: `http://${HOST}:45873`,
};
const drop = new Set(["ATS_INTEGRATION_URL", "PORTAL_INTEGRATION_URL", "HERMES_API_URL", "HERMES_API_KEY", "HERMES_API_MODEL", "HERMES_API_MODELS"]);
const entries = [];
for (const [k, v] of central) if (!drop.has(k) && !(k in override)) entries.push([k, v]);
for (const [k, v] of Object.entries(override)) entries.push([k, v]);
write("central.env", entries);

console.log(`Configuração gerada em ${out}: .env, central.env, chatwoot.env, waha.env (${entries.length} chaves na central).`);
