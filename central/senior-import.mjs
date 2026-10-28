import { randomUUID } from "node:crypto";
import { extractEmployees, extraction } from "./senior-export.mjs";
import { configuration } from "./senior.mjs";
import { normalizedCpf } from "./identity.mjs";

export const accountsSchema = `CREATE TABLE IF NOT EXISTS senior_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id), company TEXT NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0,1)), links TEXT NOT NULL, synced_at TEXT NOT NULL
);`;
export const synchronization = { state: "idle" };
export function applyActiveEmployees(db, rows, company) {
  if (!rows.length)
    throw new Error(
      "A Senior não retornou empregados ativos. Nenhum cadastro foi alterado.",
    );
  const grouped = new Map();
  let invalidCpf = 0,
    missingName = 0;
  for (const row of rows) {
    if (
      Number(row.NUMEMP) !== Number(company) ||
      Number(row.TIPCOL) !== 1 ||
      !/^\d+$/.test(row.SITAFA) ||
      Number(row.SITAFA) === 7
    )
      throw new Error("Vínculo fora do quadro ativo.");
    const cpf = normalizedCpf(row.NUMCPF);
    if (!cpf) {
      invalidCpf++;
      continue;
    }
    if (!row.NOMFUN?.trim()) {
      missingName++;
      continue;
    }
    if (!grouped.has(cpf)) grouped.set(cpf, []);
    grouped.get(cpf).push(row);
  }
  if (!grouped.size)
    throw new Error(
      "Nenhum CPF válido no quadro ativo. Nenhum cadastro foi alterado.",
    );
  const result = {
    sourceLinks: rows.length,
    validCpfs: grouped.size,
    created: 0,
    updated: 0,
    deactivated: 0,
    invalidCpf,
    missingName,
    roleConflicts: 0,
  };
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const seen = new Set();
    for (const [cpf, links] of grouped) {
      let user = db.prepare("SELECT * FROM users WHERE identifier=?").get(cpf);
      if (
        user &&
        (user.role !== "colaborador" || user.id.startsWith("demo-"))
      ) {
        result.roleConflicts++;
        continue;
      }
      const names = [...new Set(links.map((r) => r.NOMFUN.trim()))];
      if (names.length !== 1)
        throw new Error(
          "CPF com nomes divergentes na Senior. Nenhum cadastro foi alterado.",
        );
      const unit = [...new Set(links.map((r) => `Filial ${r.CODFIL}`))].join(
        " / ",
      );
      if (user) {
        db.prepare("UPDATE users SET name=?,unit=? WHERE id=?").run(
          names[0],
          unit,
          user.id,
        );
        result.updated++;
      } else {
        const id = randomUUID();
        db.prepare(
          "INSERT INTO users (id,identifier,name,role,unit,department,password_hash) VALUES (?,?,?,?,?,?,?)",
        ).run(
          id,
          cpf,
          names[0],
          "colaborador",
          unit,
          "Não informado",
          "!activation-required",
        );
        user = { id };
        result.created++;
      }
      seen.add(user.id);
      db.prepare(
        "INSERT INTO senior_accounts VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET company=excluded.company,active=1,links=excluded.links,synced_at=excluded.synced_at",
      ).run(
        user.id,
        String(company),
        1,
        JSON.stringify(
          links.map((r) => ({
            NUMEMP: r.NUMEMP,
            TIPCOL: r.TIPCOL,
            NUMCAD: r.NUMCAD,
            CODFIL: r.CODFIL,
            SITAFA: r.SITAFA,
          })),
        ),
        now,
      );
    }
    // Invalid source CPFs must not cause an ambiguous account to be silently disabled.
    if (!invalidCpf && !missingName) {
      for (const account of db
        .prepare(
          "SELECT user_id FROM senior_accounts WHERE company=? AND active=1",
        )
        .all(String(company))) {
        if (seen.has(account.user_id)) continue;
        db.prepare(
          "UPDATE senior_accounts SET active=0,synced_at=? WHERE user_id=?",
        ).run(now, account.user_id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(account.user_id);
        db.prepare("DELETE FROM access_codes WHERE user_id=?").run(
          account.user_id,
        );
        result.deactivated++;
      }
    }
    db.exec("COMMIT");
    return {
      ...result,
      deactivationDeferred: Boolean(invalidCpf || missingName),
    };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function startSynchronization(db) {
  if (synchronization.state === "running") return;
  if (extraction.state === "running")
    throw Object.assign(
      new Error("A extração está em andamento. Aguarde antes de sincronizar."),
      { status: 429 },
    );
  Object.assign(synchronization, {
    state: "running",
    count: 0,
    queries: 0,
    result: undefined,
    error: undefined,
    startedAt: new Date().toISOString(),
    completedAt: undefined,
  });
  const company = configuration().company;
  extractEmployees(
    undefined,
    company,
    (progress) => Object.assign(synchronization, progress),
    { activeOnly: true },
  )
    .then((rows) => {
      const result = applyActiveEmployees(db, rows, company);
      Object.assign(synchronization, {
        state: "complete",
        result,
        completedAt: new Date().toISOString(),
      });
    })
    .catch((e) =>
      Object.assign(synchronization, {
        state: "failed",
        error: e.status
          ? e.message
          : "Não foi possível concluir a sincronização. Nenhum cadastro foi alterado.",
      }),
    );
}
