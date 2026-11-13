import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Origens aceitas nos envios (POST/PATCH/DELETE) do navegador — proteção contra CSRF.
 * Sempre 127.0.0.1 e localhost na porta da central; mais o endereço público da central
 * (CENTRAL_URL, ex.: http://10.1.1.53:45873) e outros em CENTRAL_ORIGINS (separados por vírgula).
 */
export function allowedOrigins(port, env) {
  let settings = env;
  if (!settings) {
    let local = {};
    try {
      local = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    settings = { ...local, ...process.env };
  }
  const list = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  for (const value of [settings.CENTRAL_URL, ...String(settings.CENTRAL_ORIGINS || "").split(",")]) {
    try {
      if (value && value.trim()) list.push(new URL(value.trim()).origin);
    } catch {
      // endereço inválido na configuração: ignorado
    }
  }
  return new Set(list);
}
