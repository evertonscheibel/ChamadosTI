import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

function portalSettings() {
  let local = {};
  try {
    local = parseEnv(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { ...local, ...process.env };
}

async function portalRequest(path) {
  const settings = portalSettings();
  if (
    !settings.PORTAL_INTEGRATION_URL ||
    !settings.FRIZELO_PORTAL_INTEGRATION_TOKEN
  )
    return { state: "unconfigured" };
  const response = await fetch(
    `${settings.PORTAL_INTEGRATION_URL.replace(/\/$/, "")}/integrations/v1/vagas${path}`,
    {
      headers: {
        Authorization: `Bearer ${settings.FRIZELO_PORTAL_INTEGRATION_TOKEN}`,
      },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok)
    return {
      state: response.status === 404 ? "missing" : "error",
      status: response.status,
    };
  return { state: "ok", result: await response.json() };
}

export async function portalVacancies() {
  const response = await portalRequest("");
  return {
    state: response.state,
    ...(response.status ? { status: response.status } : {}),
    solicitacoes: Array.isArray(response.result?.solicitacoes)
      ? response.result.solicitacoes
      : [],
  };
}

export async function portalVacancyById(id) {
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)
    throw new Error("ID de solicitacao invalido.");
  const response = await portalRequest(`/${id}`);
  return {
    state: response.state,
    ...(response.status ? { status: response.status } : {}),
    solicitacao: response.result?.solicitacao ?? null,
  };
}

export async function decidePortalVacancy(id, decision, centralRhId) {
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)
    throw Object.assign(new Error("Solicitação inválida."), { status: 400 });
  if (!["APROVADA", "REPROVADA"].includes(decision))
    throw Object.assign(new Error("Decisão inválida."), { status: 400 });
  const settings = portalSettings();
  if (
    !settings.PORTAL_INTEGRATION_URL ||
    !settings.FRIZELO_PORTAL_INTEGRATION_TOKEN
  )
    throw Object.assign(new Error("Portal do Líder não configurado."), {
      status: 503,
    });
  const response = await fetch(
    `${settings.PORTAL_INTEGRATION_URL.replace(/\/$/, "")}/integrations/v1/vagas/${id}/decision`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.FRIZELO_PORTAL_INTEGRATION_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ decision, centralRhId }),
      signal: AbortSignal.timeout(8000),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(result.error || "Falha ao decidir solicitação."),
      { status: response.status },
    );
  return result;
}
