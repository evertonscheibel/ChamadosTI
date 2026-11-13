import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { parseStringPromise, processors } from "xml2js";

const error = (message, status = 502) =>
  Object.assign(new Error(message), { status });
const escape = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const array = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const scalar = (value) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
export function configuration() {
  let local = {};
  try {
    local = parseEnv(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8"),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const settings = { ...local, ...process.env };
  let source = {};
  if (settings.SENIOR_ENV_FILE)
    source = parseEnv(readFileSync(settings.SENIOR_ENV_FILE, "utf8"));
  const env = source.SENIOR_HCM_ENV || "homolog";
  return {
    enabled: settings.SENIOR_ENABLED === "true",
    base: source[`SENIOR_HCM_${env.toUpperCase()}_BASE_URL`],
    user: source.SENIOR_HCM_USER,
    password: source.SENIOR_HCM_PASSWORD,
    encryption: source.SENIOR_HCM_ENCRYPTION || "0",
    company: source.SENIOR_HCM_EMPRESA || "7",
    eventTable: source.SENIOR_HCM_EVENT_TABLE || "1",
    benefits: (settings.SENIOR_BENEFIT_EVENTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    releasedCalculations: (settings.SENIOR_PAYROLL_RELEASED_CALCULATIONS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
export async function parseRows(xml) {
  let parsed;
  try {
    parsed = await parseStringPromise(xml, {
      explicitArray: false,
      trim: true,
      tagNameProcessors: [processors.stripPrefix],
    });
  } catch {
    throw error("A Senior retornou uma resposta inválida.");
  }
  const body = parsed.Envelope?.Body;
  const result = body?.ConsultarTabelasResponse?.result;
  if (body?.Fault || !result || scalar(result.erroExecucao))
    throw error("A Senior não conseguiu executar a consulta.");
  const occurrences = array(result.ocorrencia);
  if (occurrences.length !== 1)
    throw error("A Senior retornou uma consulta incompleta.");
  const item = occurrences[0];
  if (
    /excedeu|limite.*(registro|resultado)|quantidade.*m[aá]xima/i.test(
      scalar(item.mensagem),
    )
  )
    throw Object.assign(error("A consulta excedeu o limite de registros."), {
      code: "SENIOR_LIMIT",
    });
  if (
    scalar(item.mensagem) &&
    !/n[aã]o houve resultados/i.test(scalar(item.mensagem))
  )
    throw error(
      "Consulta indisponível na Senior. Verifique a autorização da tabela com o RH/TI.",
    );
  return array(item.resultado)
    .filter((row) => row.campo)
    .map((row) =>
      Object.fromEntries(
        array(row.campo).map((field) => [
          scalar(field.nome).toUpperCase(),
          scalar(field.valor),
        ]),
      ),
    );
}
let queue = Promise.resolve();
export async function query(table, fields, filters = [], product = "rubi") {
  const config = configuration();
  if (!config.enabled || !config.base || !config.user || !config.password)
    throw error("Integração Senior não configurada.", 503);
  const run = async () => {
    const service = product === "rubi" ? "fp" : "hr";
    const endpoint = new URL(
      `${config.base.replace(/\/+$/, "")}/g5-senior-services/${product}_Synccom_senior_g5_rh_${service}_integracoes`,
    );
    if (endpoint.protocol !== "https:")
      throw error("A integração exige conexão HTTPS.", 503);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://services.senior.com.br"><soapenv:Header/><soapenv:Body><ser:ConsultarTabelas><user>${escape(config.user)}</user><password>${escape(config.password)}</password><encryption>${escape(config.encryption)}</encryption><parameters><consulta><id>central</id><tabela>${table}</tabela><campos>${fields.join(",")}</campos>${filters.map(([campo, condicao, valor]) => `<filtro><campo>${campo}</campo><condicao>${escape(condicao)}</condicao><valor>${escape(valor)}</valor></filtro>`).join("")}</consulta></parameters></ser:ConsultarTabelas></soapenv:Body></soapenv:Envelope>`;
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
        body: xml,
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw error(
        "Não foi possível conectar à Senior. Tente novamente mais tarde.",
        503,
      );
    }
    if (!response.ok) throw error("A Senior recusou a consulta.", 502);
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024)
          throw error("Resposta da Senior acima do limite.");
        chunks.push(chunk);
      }
    } catch (e) {
      if (e.status) throw e;
      throw error("A conexão com a Senior foi interrompida.", 503);
    }
    const bytes = Buffer.concat(chunks);
    const declared = /encoding=["']([^"']+)/i.exec(
      bytes.subarray(0, 150).toString("ascii"),
    )?.[1];
    const encoding =
      /charset=["']?([^;"' ]+)/i.exec(
        response.headers.get("content-type") || "",
      )?.[1] ||
      declared ||
      "iso-8859-1";
    return parseRows(new TextDecoder(encoding).decode(bytes));
  };
  const task = queue.then(run);
  queue = task.catch(() => {});
  return task;
}
export function cents(value) {
  let text = String(value).trim();
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text))
    throw error("Valor monetário inválido na Senior.");
  const amount = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(amount))
    throw error("Valor monetário fora do limite.");
  return amount;
}
export function totals(events) {
  let earnings = 0,
    deductions = 0;
  for (const item of events) {
    if (!Number.isSafeInteger(item.cents))
      throw error("Valor monetário inválido no demonstrativo.");
    if ([1, 2, 5].includes(Number(item.type))) earnings += item.cents;
    else if ([3, 6].includes(Number(item.type))) deductions += item.cents;
    else if (Number(item.type) !== 4)
      throw error(
        "Tipo de evento não reconhecido. Demonstrativo não disponível.",
      );
  }
  if (
    ![earnings, deductions, earnings - deductions].every(Number.isSafeInteger)
  )
    throw error("Totais monetários fora do limite.");
  return { earnings, deductions, net: earnings - deductions };
}
// Catálogo de eventos de folha (código -> descrição/tipo): referência
// praticamente estática por tabela, reconsultada hoje uma vez por código
// distinto em CADA holerite/benefícios. Guardar em memória evita repetir a
// mesma consulta — a fila de query() é única para toda a aplicação, então
// cada ida à Senior evitada aqui libera a fila mais rápido para todo mundo.
// Esvazia ao reiniciar o processo; se o RH cadastrar um evento novo, a
// primeira consulta que usá-lo busca de novo e passa a cachear.
// Compartilhado entre chamadas reais (module-level query/configuration);
// testes que injetam um "source" próprio para consult() devem usar códigos
// de evento distintos dos já exercitados, já que o cache não os isola.
const eventCatalogCache = new Map();
async function eventCatalogEntry(code, { query, configuration }) {
  const table = configuration().eventTable;
  const cacheKey = `${table}:${code}`;
  if (eventCatalogCache.has(cacheKey)) return eventCatalogCache.get(cacheKey);
  const catalog = await query(
    "R008EVC",
    ["CODTAB", "CODEVE", "DESEVE", "TIPEVE"],
    [
      ["CODTAB", "=", table],
      ["CODEVE", "=", code],
    ],
  );
  if (
    catalog.length !== 1 ||
    Number(catalog[0].CODEVE) !== Number(code) ||
    Number(catalog[0].CODTAB) !== Number(table)
  )
    throw error("Evento de folha não identificado com segurança.");
  eventCatalogCache.set(cacheKey, catalog[0]);
  return catalog[0];
}
// Descrição das situações do ponto (R010SIT, módulo Ronda), em cache como o catálogo de eventos.
const situationCache = new Map();
export async function situationNames(codes, source = { query }) {
  const names = {};
  for (const code of [...new Set(codes.map(String))]) {
    if (!situationCache.has(code)) {
      const rows = await source.query("R010SIT", ["CODSIT", "DESSIT"], [["CODSIT", "=", code]], "ronda");
      situationCache.set(code, rows.length === 1 && String(rows[0].CODSIT) === code ? rows[0].DESSIT : null);
    }
    if (situationCache.get(code)) names[code] = situationCache.get(code);
  }
  return names;
}
const keys = ["NUMEMP", "TIPCOL", "NUMCAD"];
export function assertScope(rows, link) {
  if (
    rows.some((row) =>
      keys.some((key) => Number(row[key]) !== Number(link[key])),
    )
  )
    throw error("A Senior retornou dados fora do vínculo solicitado.");
  return rows;
}
export async function links(user) {
  if (user.id.startsWith("demo-"))
    throw error(
      "Conta de demonstração: consultas a dados reais da Senior estão desabilitadas.",
      403,
    );
  const cpf = user.identifier.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cpf)) throw error("CPF inválido para consulta.", 400);
  const rows = await query(
    "R034FUN",
    [...keys, "NOMFUN", "NUMCPF"],
    [
      ["NUMEMP", "=", configuration().company],
      ["NUMCPF", "=", String(Number(cpf))],
    ],
  );
  if (
    rows.some(
      (row) =>
        String(row.NUMCPF).replace(/\D/g, "").padStart(11, "0") !== cpf ||
        Number(row.NUMEMP) !== Number(configuration().company),
    )
  )
    throw error("Não foi possível validar a titularidade do vínculo.");
  return rows.map(({ NUMEMP, TIPCOL, NUMCAD, NOMFUN }) => ({
    NUMEMP,
    TIPCOL,
    NUMCAD,
    name: NOMFUN,
    id: `${NUMEMP}:${TIPCOL}:${NUMCAD}`,
  }));
}
export async function consult(
  user,
  kind,
  month,
  linkId,
  source = { query, configuration, links },
) {
  const { query, configuration, links } = source;
  if (!["holerite", "ponto", "ferias", "beneficios"].includes(kind))
    throw error("Consulta inválida.", 400);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month || ""))
    throw error("Informe uma competência válida.", 400);
  const owned = await links(user);
  const link =
    owned.find((item) => item.id === linkId) ||
    (owned.length === 1 && !linkId ? owned[0] : null);
  if (!link)
    throw error(
      owned.length
        ? "Selecione seu vínculo."
        : "Não foi encontrado um vínculo para seu CPF.",
      400,
    );
  const scoped = keys.map((key) => [key, "=", link[key]]);
  const [year, m] = month.split("-");
  const end = new Date(Number(year), Number(m), 0).getDate();
  const dates = [
    ["DATAPU", ">=", `01/${m}/${year}`],
    ["DATAPU", "<=", `${end}/${m}/${year}`],
  ];
  const base = {
    kind,
    month,
    link: { id: link.id, name: link.name },
    source: "Senior HCM",
    generatedAt: new Date().toISOString(),
  };
  if (kind === "beneficios" && !configuration().benefits.length)
    return {
      ...base,
      events: [],
      notice:
        "A consulta de benefícios aguarda a configuração do RH. Você pode abrir uma solicitação pelo portal.",
    };
  if (kind === "ferias") {
    const periods = assertScope(
      await query("R040PER", [...keys, "INIPER", "FIMPER", "SITPER"], scoped),
      link,
    );
    const history = assertScope(
      await query("R040FEM", [...keys, "INIPER", "INIFER", "DIAFER"], scoped),
      link,
    );
    return {
      ...base,
      periods,
      history,
      notice:
        "Consulta dos períodos aquisitivos e do histórico de gozo. Saldo e programação futura precisam de confirmação do RH.",
    };
  }
  if (kind === "ponto")
    return {
      ...base,
      marks: assertScope(
        await query(
          "R070ACC",
          [...keys, "DATAPU", "DATACC", "HORACC"],
          [...scoped, ...dates],
          "ronda",
        ),
        link,
      ),
      situations: assertScope(
        await query(
          "R066SIT",
          [...keys, "DATAPU", "CODSIT", "CODRAT", "QTDHOR"],
          [...scoped, ...dates],
          "ronda",
        ),
        link,
      ),
      notice:
        "Consulta de marcações e situações apuradas. O espelho oficial depende do modelo de relatório homologado pelo RH.",
    };
  const calendars = await query(
    "R044CAL",
    ["NUMEMP", "CODCAL", "TIPCAL", "PERREF", "DATPAG", "SITCAL"],
    [
      ["NUMEMP", "=", link.NUMEMP],
      ["TIPCAL", "=", "11"],
      ["PERREF", "=", `01/${m}/${year}`],
    ],
  );
  if (calendars.some((c) => Number(c.NUMEMP) !== Number(link.NUMEMP)))
    throw error("Calendário fora da empresa solicitada.");
  const closed = calendars.filter((c) => c.SITCAL === "T");
  if (!closed.length)
    return {
      ...base,
      events: [],
      notice: "Não há folha mensal encerrada para esta competência.",
    };
  if (closed.length !== 1)
    throw error(
      "Mais de um cálculo mensal encontrado. O RH deve definir o cálculo publicado.",
    );
  if (
    !configuration().releasedCalculations.some(
      (code) => code === "*" || code === String(closed[0].CODCAL),
    )
  )
    return {
      ...base,
      events: [],
      notice:
        "O RH ainda não liberou a consulta desta folha no portal. Solicite seu holerite pelo atendimento.",
    };
  const rows = assertScope(
    await query(
      "R046VER",
      [...keys, "CODCAL", "CODEVE", "REFEVE", "VALEVE"],
      [...scoped, ["CODCAL", "=", closed[0].CODCAL]],
    ),
    link,
  );
  if (rows.some((row) => Number(row.CODCAL) !== Number(closed[0].CODCAL)))
    throw error("Eventos fora do cálculo solicitado.");
  const events = [];
  for (const code of [...new Set(rows.map((row) => row.CODEVE))]) {
    const entry = await eventCatalogEntry(code, { query, configuration });
    for (const row of rows.filter((item) => item.CODEVE === code))
      events.push({
        code,
        description: entry.DESEVE,
        type: entry.TIPEVE,
        reference: row.REFEVE,
        cents: cents(row.VALEVE),
      });
  }
  if (kind === "beneficios") {
    const mapping = configuration().benefits;
    return {
      ...base,
      events: events.filter((event) => mapping.includes(event.code)),
      notice: mapping.length
        ? "Benefícios identificados pelos eventos de folha configurados pelo RH. Não representa cadastro de adesões ou dependentes."
        : "O RH precisa configurar os códigos dos eventos de benefícios; nenhum benefício será inferido pela descrição.",
    };
  }
  return {
    ...base,
    events,
    totals: totals(events),
    paymentDate: closed[0].DATPAG,
    notice:
      "Demonstrativo de consulta da folha encerrada. A emissão do holerite oficial aguarda homologação do modelo e da regra de publicação pelo RH.",
  };
}
