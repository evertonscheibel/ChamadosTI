import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export async function vacancyStatus(link) {
  let local = {};
  try {
    local = parseEnv(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const settings = { ...local, ...process.env };
  if (
    !settings.ATS_INTEGRATION_URL ||
    !settings.FRIZELO_INTEGRATION_TOKEN ||
    link.ats_instance !== "ats-recrutamento-local"
  )
    return { state: "unconfigured" };
  const endpoint = `${settings.ATS_INTEGRATION_URL.replace(/\/$/, "")}/api/integrations/vagas/${encodeURIComponent(link.ats_vacancy_id)}`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${settings.FRIZELO_INTEGRATION_TOKEN}` },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) return { state: "error", status: response.status };
  const vacancy = await response.json();
  return {
    state: "ok",
    vacancy: {
      id: vacancy.id,
      codigo: vacancy.codigo,
      cargo: vacancy.cargo,
      status: vacancy.status,
      publicarCarreiras: vacancy.publicarCarreiras,
      atualizadoEm: vacancy.atualizadoEm,
    },
  };
}

export async function vacancyApplications(link) {
  let local = {};
  try {
    local = parseEnv(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const settings = { ...local, ...process.env };
  if (
    !settings.ATS_INTEGRATION_URL ||
    !settings.FRIZELO_INTEGRATION_TOKEN ||
    link.source_system !== "portal-lider-isolado" ||
    link.ats_instance !== "ats-recrutamento-local" ||
    !/^\d+$/.test(link.source_id) ||
    !/^\d+$/.test(link.ats_vacancy_id)
  )
    throw Object.assign(
      new Error("Vínculo ATS não configurado para consulta."),
      { status: 409 },
    );
  const response = await fetch(
    `${settings.ATS_INTEGRATION_URL.replace(/\/$/, "")}/api/integrations/vagas/${link.ats_vacancy_id}/candidaturas`,
    {
      headers: {
        Authorization: `Bearer ${settings.FRIZELO_INTEGRATION_TOKEN}`,
      },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok)
    throw Object.assign(new Error("Falha ao consultar candidaturas no ATS."), {
      status: response.status,
    });
  const result = await response.json();
  if (
    result.portalSolicitacaoId !== link.source_id ||
    result.vagaId !== Number(link.ats_vacancy_id)
  )
    throw Object.assign(new Error("Vínculo entre Portal e ATS divergente."), {
      status: 409,
    });
  return {
    total: result.total,
    etapas: result.etapas,
    ultimaInscricaoEm: result.ultimaInscricaoEm,
  };
}

export async function createVacancy(request) {
  let local = {};
  try {
    local = parseEnv(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const settings = { ...local, ...process.env };
  if (!settings.ATS_INTEGRATION_URL || !settings.FRIZELO_INTEGRATION_TOKEN)
    throw Object.assign(new Error("Integração ATS não configurada."), {
      status: 503,
    });
  const response = await fetch(
    `${settings.ATS_INTEGRATION_URL.replace(/\/$/, "")}/api/integrations/vagas`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.FRIZELO_INTEGRATION_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceSystem: "portal-lider-isolado",
        sourceId: request.id,
        protocolo: request.codigo,
        cargo: request.vaga.cargo,
        setor: request.vaga.setor,
        quantidade: request.vaga.quantidade,
        motivoAbertura: request.vaga.motivoAbertura,
        admissaoDesejada: request.vaga.admissaoDesejada,
        portalLiderId: request.encarregadoId,
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "ATS indisponível."), {
      status: response.status,
    });
  return result;
}

export async function setVacancyPublication(link, publish, centralRhId) {
  let local = {};
  try {
    local = parseEnv(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const settings = { ...local, ...process.env };
  if (!settings.ATS_INTEGRATION_URL || !settings.FRIZELO_INTEGRATION_TOKEN)
    throw Object.assign(new Error("Integração ATS não configurada."), {
      status: 503,
    });
  if (
    link.source_system !== "portal-lider-isolado" ||
    link.ats_instance !== "ats-recrutamento-local" ||
    !/^\d+$/.test(link.source_id) ||
    !/^\d+$/.test(link.ats_vacancy_id)
  )
    throw Object.assign(
      new Error("Este vínculo não permite divulgação pela Central."),
      { status: 409 },
    );
  const response = await fetch(
    `${settings.ATS_INTEGRATION_URL.replace(/\/$/, "")}/api/integrations/vagas/${link.ats_vacancy_id}/publication`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${settings.FRIZELO_INTEGRATION_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        publish,
        portalSolicitacaoId: link.source_id,
        centralRhId,
      }),
      signal: AbortSignal.timeout(5000),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(result.error || "ATS indisponível."), {
      status: response.status,
    });
  return result;
}
