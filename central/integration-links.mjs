import { randomUUID } from "node:crypto";

export function initializeLinks(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS integration_links (
    id TEXT PRIMARY KEY, source_system TEXT NOT NULL, source_id TEXT NOT NULL,
    source_protocol TEXT NOT NULL, ats_instance TEXT NOT NULL, ats_vacancy_id TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
    UNIQUE(source_system, source_id, ats_instance, ats_vacancy_id));
    CREATE TABLE IF NOT EXISTS integration_link_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, link_id TEXT NOT NULL REFERENCES integration_links(id),
    actor_id TEXT NOT NULL REFERENCES users(id), event TEXT NOT NULL, created_at TEXT NOT NULL);`);
}

export function registerLink(db, input, actorId) {
  const values = {};
  for (const field of [
    "sourceSystem",
    "sourceId",
    "sourceProtocol",
    "atsInstance",
    "atsVacancyId",
  ]) {
    if (
      typeof input[field] !== "string" ||
      !input[field].trim() ||
      input[field].length > 160
    )
      throw Object.assign(
        new Error("Preencha todas as referências (até 160 caracteres)."),
        { status: 400 },
      );
    values[field] = input[field].trim();
  }
  if (
    !["portal-lider-isolado", "portal-lider-conector"].includes(
      values.sourceSystem,
    )
  )
    throw Object.assign(new Error("Origem inválida."), { status: 400 });
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db
      .prepare(
        `SELECT * FROM integration_links WHERE source_system=? AND source_id=? AND ats_instance=? AND ats_vacancy_id=?`,
      )
      .get(
        values.sourceSystem,
        values.sourceId,
        values.atsInstance,
        values.atsVacancyId,
      );
    if (existing) {
      if (existing.source_protocol !== values.sourceProtocol)
        throw Object.assign(
          new Error(
            "Este vínculo já existe com outro protocolo. Confira as referências.",
          ),
          { status: 409 },
        );
      db.exec("COMMIT");
      return { link: existing, created: false };
    }
    const conflict = db
      .prepare(
        `SELECT id FROM integration_links WHERE ats_instance=? AND ats_vacancy_id=?`,
      )
      .get(values.atsInstance, values.atsVacancyId);
    if (conflict)
      throw Object.assign(
        new Error("Esta vaga já está vinculada a outra solicitação."),
        { status: 409 },
      );
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO integration_links VALUES (?,?,?,?,?,?,?,?)").run(
      id,
      values.sourceSystem,
      values.sourceId,
      values.sourceProtocol,
      values.atsInstance,
      values.atsVacancyId,
      actorId,
      now,
    );
    db.prepare(
      "INSERT INTO integration_link_history (link_id,actor_id,event,created_at) VALUES (?,?,?,?)",
    ).run(id, actorId, "VINCULO_MANUAL_REGISTRADO", now);
    db.exec("COMMIT");
    return {
      link: db.prepare("SELECT * FROM integration_links WHERE id=?").get(id),
      created: true,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
