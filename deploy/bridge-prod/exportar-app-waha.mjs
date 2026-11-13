// Salva (sem imprimir) a configuração do app Chatwoot do WAHA local, já com o endereço do servidor.
// Rode com o WAHA local LIGADO, antes de pará-lo. Uso: node exportar-app-waha.mjs <pasta>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
const env = Object.fromEntries(
  readFileSync("C:/IA/ChamadosTI/.env.local", "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const res = await fetch(`${env.WAHA_URL}/api/apps?session=default`, { headers: { "X-Api-Key": env.WAHA_API_KEY } });
if (!res.ok) throw new Error(`WAHA respondeu ${res.status}`);
const app = (await res.json()).find((a) => a.app === "chatwoot");
if (!app) throw new Error("App chatwoot não encontrado no WAHA local.");
app.config.url = "http://chatwoot:3000";
writeFileSync(join(out, "waha-app.json"), JSON.stringify(app), { mode: 0o600 });
console.log(`App "${app.id}" salvo (caixa ${app.config.inboxId}, endereço ${app.config.url}).`);
