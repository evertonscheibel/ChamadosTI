import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { services, faq } from "./catalog.mjs";
import { query, configuration } from "./senior.mjs";

const directory =
  process.env.CENTRAL_POLICIES_DIR ||
  fileURLToPath(new URL("../data/policies/", import.meta.url));

function write(name, content) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/${name}`, content, "utf8");
}

const TIPEVE_LABEL = {
  1: "Provento",
  2: "Provento",
  5: "Provento",
  3: "Desconto",
  6: "Desconto",
  4: "Informativo",
};

/** Gera documentos a partir de conteúdo que já existe no próprio sistema
 * (catálogo de serviços e FAQ do portal) — não depende da Senior estar
 * disponível, então sempre pode ser gerado. */
export function writeStaticDocs() {
  write(
    "servicos-rh.md",
    [
      "# Serviços do RH disponíveis na Central",
      "",
      ...services.map((s) =>
        [
          `## ${s.title}`,
          s.description,
          `Como pedir: ${s.hint}`,
          s.fields.length ? `Informações pedidas: ${s.fields.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n\n"),
  );
  write(
    "duvidas-frequentes.md",
    [
      "# Dúvidas frequentes sobre o uso da Central",
      "",
      ...faq.map(([q, a]) => `## ${q}\n${a}`),
    ].join("\n\n"),
  );
  return ["servicos-rh.md", "duvidas-frequentes.md"];
}

/** Gera o catálogo de eventos de folha (código → descrição) a partir da
 * Senior (tabela R008EVC), para responder perguntas como "o que é o evento
 * X no meu holerite?". Exige a integração com a Senior habilitada.
 *
 * A tabela inteira costuma passar do limite de registros de uma única
 * consulta da Senior; quando isso acontece, divide o intervalo de códigos
 * em dois e tenta cada metade separadamente (mesmo padrão de
 * senior-export.mjs#extractEmployees). */
export async function syncEventCatalog() {
  const table = configuration().eventTable;
  const rows = new Map();
  let requests = 0;
  async function range(start, end) {
    if (++requests > 500)
      throw new Error(
        "Sincronização interrompida: limite de consultas atingido.",
      );
    let batch;
    try {
      batch = await query(
        "R008EVC",
        ["CODTAB", "CODEVE", "DESEVE", "TIPEVE"],
        [
          ["CODTAB", "=", table],
          ["CODEVE", ">=", String(start)],
          ["CODEVE", "<=", String(end)],
        ],
      );
    } catch (e) {
      if (e.code !== "SENIOR_LIMIT" || start === end) throw e;
      const middle =
        start === 0 && end === 99999 ? 999 : Math.floor((start + end) / 2);
      await range(start, middle);
      await range(middle + 1, end);
      return;
    }
    for (const row of batch) rows.set(Number(row.CODEVE), row);
  }
  await range(0, 99999);
  const sorted = [...rows.values()].sort(
    (a, b) => Number(a.CODEVE) - Number(b.CODEVE),
  );
  write(
    "eventos-folha.md",
    [
      "# Catálogo de eventos de folha (Senior, tabela " + table + ")",
      "",
      ...sorted.map(
        (r) =>
          `## Evento ${r.CODEVE} — ${r.DESEVE}\nTipo: ${TIPEVE_LABEL[Number(r.TIPEVE)] || "Não identificado"}.`,
      ),
    ].join("\n\n"),
  );
  return { file: "eventos-folha.md", count: sorted.length };
}

/** Sincroniza tudo que estiver disponível. Documentos estáticos sempre são
 * gerados; o catálogo de eventos da Senior só entra se a integração estiver
 * habilitada — uma falha nela não impede os documentos estáticos. */
export async function syncAll() {
  const files = writeStaticDocs();
  try {
    const events = await syncEventCatalog();
    files.push(events.file);
    return { files, eventCount: events.count, seniorError: null };
  } catch (e) {
    return { files, eventCount: 0, seniorError: e.message };
  }
}
