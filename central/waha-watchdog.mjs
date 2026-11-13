import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Vigia da sessão do WhatsApp no WAHA. Corrige sozinho o que já aconteceu na
// prática: depois de um reboot a sessão aparece WORKING mas não recebe nada,
// e só volta com um restart. Também cobre sessão parada/falha e conexão morta.
// A decisão (decide) é pura, para ser testada sem rede.

export const COOLDOWN_MS = 10 * 60 * 1000;
const BOOT_WINDOW_MS = 15 * 60 * 1000; // WAHA com menos que isso de vida = acabou de subir
const BOOT_GRACE_MS = 60 * 1000; // dá um tempo para o WAHA terminar de subir

export function wahaConfig(env) {
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
  return {
    enabled: Boolean(settings.WAHA_API_KEY) && settings.WAHA_WATCHDOG !== "off",
    url: String(settings.WAHA_URL || "http://127.0.0.1:3001").replace(/\/+$/, ""),
    apiKey: settings.WAHA_API_KEY || "",
    session: settings.WAHA_SESSION || "default",
    intervalMs: Number(settings.WAHA_WATCHDOG_SEGUNDOS || 120) * 1000,
  };
}

export const initialState = () => ({
  uptimeMs: null,
  pendingBootRestart: false,
  probeFails: 0,
  startingTicks: 0,
  lastRestart: 0,
});

/**
 * obs: { reachable, status, uptimeMs, probeOk (true/false/null), chatwootUp }
 * Retorna { state, action: null | "start" | "restart", reason, health }.
 * health: ok | reconectando | waha_offline | qr | sem_conexao
 */
export function decide(previous, obs, now) {
  const state = { ...previous };
  if (!obs.reachable) return { state, action: null, reason: "WAHA não responde", health: "waha_offline" };
  // Reboot do WAHA = o tempo de vida dele voltou para trás (ou a central subiu junto com ele).
  // Não usar startTimestamp: ele escorrega quando o relógio da VM do Docker é ajustado.
  if (Number.isFinite(obs.uptimeMs) && obs.uptimeMs > 0) {
    const rebooted = state.uptimeMs === null ? obs.uptimeMs < BOOT_WINDOW_MS : obs.uptimeMs + 5000 < state.uptimeMs;
    if (rebooted) state.pendingBootRestart = true;
    state.uptimeMs = obs.uptimeMs;
  }
  let action = null;
  let reason = "";
  let health = "ok";
  if (obs.status === "SCAN_QR_CODE")
    return { state, action: null, reason: "WhatsApp desconectado: precisa ler o QR code no WAHA", health: "qr" };
  if (obs.status === "STOPPED") {
    action = "start";
    reason = "sessão parada";
  } else if (obs.status === "FAILED") {
    action = "restart";
    reason = "sessão com falha";
  } else if (obs.status === "STARTING") {
    state.startingTicks += 1;
    health = "reconectando";
    if (state.startingTicks >= 3) {
      action = "restart";
      reason = "sessão presa iniciando";
    }
  } else if (obs.status === "WORKING") {
    state.startingTicks = 0;
    if (state.pendingBootRestart) {
      if (obs.uptimeMs >= BOOT_GRACE_MS && obs.chatwootUp) {
        action = "restart";
        reason = "WAHA acabou de subir (reboot): reconectando a sessão ao Chatwoot";
      } else health = "reconectando";
    } else if (obs.probeOk === false) {
      state.probeFails += 1;
      health = "sem_conexao";
      if (state.probeFails >= 2) {
        action = "restart";
        reason = "sessão WORKING mas sem conexão com o WhatsApp";
      }
    } else if (obs.probeOk === true) state.probeFails = 0;
  } else health = "reconectando";
  if (action) {
    if (now - state.lastRestart < COOLDOWN_MS) return { state, action: null, reason: `${reason} (aguardando intervalo entre reinícios)`, health: "reconectando" };
    state.lastRestart = now;
    state.probeFails = 0;
    state.startingTicks = 0;
    state.pendingBootRestart = false;
    health = "reconectando";
  }
  return { state, action, reason, health };
}

/** Liga o vigia. Devolve getHealth() para a API do painel. */
export function startWahaWatchdog({ config = wahaConfig(), chatwootBase, log = console.log, fetchImpl = fetch } = {}) {
  const health = { enabled: config.enabled, health: config.enabled ? "verificando" : "desligado", status: null, checkedAt: null, lastRestart: null, lastReason: null };
  if (!config.enabled) return { getHealth: () => health, stop() {} };
  let state = initialState();
  const call = async (path, init = {}, timeout = 15000) => {
    const response = await fetchImpl(`${config.url}${path}`, {
      ...init,
      headers: { "X-Api-Key": config.apiKey, Accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw Object.assign(new Error(`WAHA ${path}: HTTP ${response.status}`), { status: response.status });
    return response.json().catch(() => ({}));
  };
  const session = encodeURIComponent(config.session);
  async function observe() {
    let session_, server;
    try {
      [session_, server] = await Promise.all([call(`/api/sessions/${session}`), call("/api/server/status")]);
    } catch {
      return { reachable: false };
    }
    let probeOk = null;
    const me = String(session_.me?.id || "").replace(/\D/g, "");
    if (session_.status === "WORKING" && me) {
      try {
        const r = await call(`/api/contacts/check-exists?phone=${me}&session=${session}`, {}, 20000);
        probeOk = r.numberExists === true;
      } catch {
        probeOk = false;
      }
    }
    let chatwootUp = !chatwootBase;
    if (chatwootBase)
      chatwootUp = await fetchImpl(`${String(chatwootBase).replace(/\/+$/, "")}/api`, { signal: AbortSignal.timeout(10000) })
        .then((r) => r.ok)
        .catch(() => false);
    return {
      reachable: true,
      status: session_.status,
      uptimeMs: Number(server.uptime) || 0,
      probeOk,
      chatwootUp,
    };
  }
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const obs = await observe();
      const result = decide(state, obs, Date.now());
      state = result.state;
      Object.assign(health, { health: result.health, status: obs.status || null, checkedAt: new Date().toISOString() });
      if (result.action) {
        log(`[waha] ${result.action} da sessão ${config.session}: ${result.reason}`);
        try {
          await call(`/api/sessions/${session}/${result.action}`, { method: "POST" }, 30000);
          Object.assign(health, { lastRestart: new Date().toISOString(), lastReason: result.reason });
        } catch (e) {
          log(`[waha] falha ao executar ${result.action}: ${e.message}`);
        }
      } else if (result.health !== "ok" && result.reason) log(`[waha] ${result.reason}`);
    } catch (e) {
      log(`[waha] erro no vigia: ${e.message}`);
    } finally {
      running = false;
    }
  }
  const first = setTimeout(() => void tick(), 15000);
  const timer = setInterval(() => void tick(), config.intervalMs);
  timer.unref?.();
  first.unref?.();
  return {
    getHealth: () => health,
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
