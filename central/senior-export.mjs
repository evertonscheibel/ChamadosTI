import { query, configuration } from "./senior.mjs";
export const fields = [
  "NUMEMP",
  "TIPCOL",
  "NUMCAD",
  "NOMFUN",
  "NUMCPF",
  "CODFIL",
  "DATADM",
  "SITAFA",
];
export async function extractEmployees(
  read = query,
  company = configuration().company,
  onProgress = () => {},
  options = {},
) {
  const rows = new Map();
  let requests = 0;
  async function range(start, end) {
    if (++requests > 500)
      throw new Error(
        "Extração interrompida: limite de consultas atingido. Nenhum arquivo parcial será disponibilizado.",
      );
    let batch;
    try {
      batch = await read("R034FUN", fields, [
        ["NUMEMP", "=", company],
        ["NUMCAD", ">=", String(start)],
        ["NUMCAD", "<=", String(end)],
        ...(options.activeOnly
          ? [
              ["TIPCOL", "=", "1"],
              ["SITAFA", "<>", "7"],
            ]
          : []),
      ]);
    } catch (e) {
      if (e.code !== "SENIOR_LIMIT" || start === end) throw e;
      const middle =
        start === 0 && end === 999999999
          ? 19999
          : Math.floor((start + end) / 2);
      await range(start, middle);
      await range(middle + 1, end);
      return;
    }
    for (const row of batch) {
      const registration = Number(row.NUMCAD);
      if (
        Number(row.NUMEMP) !== Number(company) ||
        !Number.isInteger(registration) ||
        registration < start ||
        registration > end ||
        !/^\d+$/.test(row.TIPCOL || "")
      )
        throw new Error("Resposta fora do escopo da extração.");
      if (
        options.activeOnly &&
        (Number(row.TIPCOL) !== 1 ||
          !/^\d+$/.test(row.SITAFA) ||
          Number(row.SITAFA) === 7)
      )
        throw new Error("A Senior retornou vínculo fora do quadro ativo.");
      const id = `${row.NUMEMP}:${row.TIPCOL}:${row.NUMCAD}`;
      if (rows.has(id)) throw new Error("Vínculo duplicado na extração.");
      rows.set(
        id,
        Object.fromEntries(fields.map((field) => [field, row[field] || ""])),
      );
    }
    onProgress({ queries: requests, count: rows.size });
  }
  await range(0, 999999999);
  return [...rows.values()].sort(
    (a, b) =>
      Number(a.NUMCAD) - Number(b.NUMCAD) ||
      Number(a.TIPCOL) - Number(b.TIPCOL),
  );
}
export function csv(rows) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      fields,
      ...rows.map((row) =>
        fields.map((field) =>
          field === "NUMCPF" && row[field]
            ? String(row[field]).replace(/\D/g, "").padStart(11, "0")
            : row[field],
        ),
      ),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
}
export const extraction = { state: "idle" };
export function startExtraction(owner) {
  if (extraction.state === "running") {
    if (extraction.owner !== owner)
      throw Object.assign(
        new Error("Outra extração está em andamento. Aguarde a conclusão."),
        { status: 429 },
      );
    return;
  }
  const job = Symbol();
  Object.assign(extraction, {
    state: "running",
    owner,
    rows: undefined,
    error: undefined,
    count: 0,
    queries: 0,
    startedAt: new Date().toISOString(),
    completedAt: undefined,
    job,
  });
  extractEmployees(undefined, undefined, (progress) =>
    Object.assign(extraction, progress),
  )
    .then((rows) => {
      Object.assign(extraction, {
        state: "complete",
        rows,
        count: rows.length,
        completedAt: new Date().toISOString(),
      });
      setTimeout(
        () => {
          if (extraction.job === job) {
            extraction.rows = undefined;
            extraction.state = "expired";
          }
        },
        15 * 60 * 1000,
      ).unref();
    })
    .catch((e) =>
      Object.assign(extraction, {
        state: "failed",
        rows: undefined,
        error: e.status
          ? e.message
          : "A extração não foi concluída. Verifique a configuração e tente novamente.",
      }),
    );
}
