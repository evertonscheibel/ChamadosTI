import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { accountsSchema } from "./senior-import.mjs";

const directory =
  process.env.CENTRAL_DATA_DIR ||
  fileURLToPath(new URL("../data/", import.meta.url));
mkdirSync(directory, { recursive: true });
export const db = new DatabaseSync(`${directory}/central.sqlite`);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, identifier TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('colaborador','rh')), unit TEXT NOT NULL, department TEXT NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS access_codes (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, protocol TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), service_id TEXT NOT NULL, subject TEXT NOT NULL, description TEXT NOT NULL, fields TEXT NOT NULL, status TEXT NOT NULL, assigned_to TEXT REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL REFERENCES requests(id), user_id TEXT NOT NULL REFERENCES users(id), event TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, type TEXT NOT NULL, content BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS requests_owner ON requests(user_id);
CREATE INDEX IF NOT EXISTS messages_request ON messages(request_id);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS history_request ON history(request_id);
CREATE INDEX IF NOT EXISTS attachments_request ON attachments(request_id);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('chatbot','atendimento')), session_id TEXT NOT NULL, candidate_name TEXT, candidate_identifier TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS conversation_messages_conv ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS conversations_updated ON conversations(updated_at);
CREATE TABLE IF NOT EXISTS ai_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('chatbot','atendimento')), rag_hit INTEGER NOT NULL, ticket_created INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ai_answers_created ON ai_answers(created_at);
CREATE TABLE IF NOT EXISTS whatsapp_rh (conversation_id TEXT PRIMARY KEY, stage TEXT NOT NULL, theme INTEGER, invalid INTEGER NOT NULL DEFAULT 0, request_id TEXT REFERENCES requests(id), phone TEXT, updated_at TEXT NOT NULL);`);
function column(table, name, definition) {
  if (
    !db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === name)
  )
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
column("requests", "priority", "TEXT NOT NULL DEFAULT 'Normal'");
column("requests", "due_at", "TEXT");
column("messages", "internal", "INTEGER NOT NULL DEFAULT 0");
column("attachments", "internal", "INTEGER NOT NULL DEFAULT 0");
column("requests", "closed_at", "TEXT");
column("requests", "closed_due_at", "TEXT");
column("history", "kind", "TEXT NOT NULL DEFAULT 'legacy'");
column("history", "data", "TEXT NOT NULL DEFAULT '{}'");
column("history", "internal", "INTEGER NOT NULL DEFAULT 0");
column("history", "actor_name", "TEXT");
column("requests", "chatwoot_conversation_id", "TEXT");
column("whatsapp_rh", "data", "TEXT NOT NULL DEFAULT '{}'");
// Auditoria: quem recebeu qual documento da Senior pelo WhatsApp.
db.exec(
  "CREATE TABLE IF NOT EXISTS whatsapp_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, phone TEXT, kind TEXT NOT NULL, month TEXT NOT NULL, numemp TEXT, numcad TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)",
);
column("whatsapp_documents", "name", "TEXT");
column("requests", "rating", "INTEGER");
column("requests", "rated_at", "TEXT");
column("attachments", "message_id", "TEXT");
// Respostas prontas do RH. {nome} e {protocolo} são trocados na hora de usar.
db.exec(
  "CREATE TABLE IF NOT EXISTS reply_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL)",
);
if (!db.prepare("SELECT 1 FROM reply_templates LIMIT 1").get()) {
  const seed = db.prepare("INSERT INTO reply_templates (title,body,created_at) VALUES (?,?,?)");
  for (const [title, body] of [
    ["Atestado recebido", "Olá, {nome}! Recebemos o seu atestado e ele já foi lançado no sistema. Qualquer dúvida, é só chamar por aqui."],
    ["Ajuste de ponto feito", "Olá, {nome}! O ajuste no seu ponto foi feito e aparece no espelho do mês na próxima atualização."],
    ["Preciso de mais informações", "Olá, {nome}! Para seguir com o chamado {protocolo}, preciso que você me envie: "],
    ["Encaminhado ao DP", "Olá, {nome}! Encaminhamos a sua solicitação ao Departamento Pessoal. Assim que tivermos o retorno, avisamos por aqui."],
    ["Documento em anexo", "Olá, {nome}! Segue em anexo o documento solicitado."],
  ])
    seed.run(title, body, new Date().toISOString());
}
db.exec(
  `UPDATE requests SET closed_at=(SELECT MAX(created_at) FROM history WHERE request_id=requests.id AND event='Status alterado para Concluída') WHERE status='Concluída' AND closed_at IS NULL;`,
);
db.exec(accountsSchema);
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password, hash) {
  if (!/^[^:]+:[a-f0-9]{128}$/.test(hash || "")) return false;
  const [salt, digest] = hash.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(digest, "hex"),
  );
}
const insert = db.prepare("INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?,?)");
insert.run(
  "demo-colaborador",
  "00000000191",
  "Mariana Silva",
  "colaborador",
  "Unidade de demonstração",
  "Produção",
  hashPassword("FrizeloDemo!2026"),
);
insert.run(
  "demo-rh",
  "00000000272",
  "Equipe de RH",
  "rh",
  "Unidade de demonstração",
  "Recursos Humanos",
  hashPassword("FrizeloDemo!2026"),
);
