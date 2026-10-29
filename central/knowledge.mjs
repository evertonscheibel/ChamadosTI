import { readdirSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Documentos de políticas/RH exportados manualmente para esta pasta (texto ou
// Markdown). Não há embeddings aqui de propósito: o volume é pequeno e uma
// busca por palavra-chave evita gastar tokens de API só para indexar — está
// alinhado com o resto do projeto (ver CHATBOT-SIMULADOR.md, redução de
// consumo). Sem documentos, contextFor() simplesmente não acrescenta nada.
const directory =
  process.env.CENTRAL_POLICIES_DIR ||
  fileURLToPath(new URL("../data/policies/", import.meta.url));
mkdirSync(directory, { recursive: true });

const MAX_CHUNK = 900;
const STOPWORDS = new Set(
  "a o os as de do da dos das em no na nos nas para por com e ou que um uma uns umas se sua seu suas seus ao aos à às é foi ser são como mais menos muito pouco já não sim quando onde qual quais isso isto esse esta este".split(
    " ",
  ),
);

function listFiles() {
  try {
    return readdirSync(directory).filter((f) => /\.(txt|md)$/i.test(f));
  } catch {
    return [];
  }
}

function signatureOf(files) {
  return files
    .map((f) => `${f}:${statSync(`${directory}/${f}`).mtimeMs}`)
    .join("|");
}

function splitIntoChunks(text) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    if (buffer && buffer.length + paragraph.length + 2 > MAX_CHUNK) {
      chunks.push(buffer);
      buffer = paragraph;
    } else buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function tokenize(text) {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .match(/[a-z0-9]+/g) || []
  );
}

function meaningfulTerms(text) {
  return tokenize(text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

let cache = { signature: null, chunks: [] };

function load() {
  const files = listFiles();
  const signature = signatureOf(files);
  if (signature === cache.signature) return cache.chunks;
  const chunks = [];
  for (const file of files) {
    const text = readFileSync(`${directory}/${file}`, "utf8");
    splitIntoChunks(text).forEach((content, index) =>
      chunks.push({
        source: file,
        index,
        content,
        terms: meaningfulTerms(content),
      }),
    );
  }
  cache = { signature, chunks };
  return chunks;
}

/** Busca os trechos mais relevantes por contagem de termos em comum com a
 * pergunta. Retorna [] se não houver documentos carregados ou nenhum termo
 * em comum — nunca lança erro, para nunca travar a conversa por isso. */
export function search(query, limit = 3) {
  const chunks = load();
  const queryTerms = meaningfulTerms(query);
  if (!queryTerms.length || !chunks.length) return [];
  return chunks
    .map((chunk) => ({
      ...chunk,
      score: queryTerms.reduce(
        (sum, term) => sum + chunk.terms.filter((t) => t === term).length,
        0,
      ),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function knowledgeAvailable() {
  return load().length > 0;
}

/** Bloco pronto para entrar no system prompt, ou null se nada relevante foi
 * encontrado (o prompt segue sem alteração nesse caso). */
export function contextFor(query, limit = 3) {
  const results = search(query, limit);
  if (!results.length) return null;
  return [
    "Contexto de políticas internas da empresa (use somente se for relevante para a pergunta; nunca invente o que não estiver aqui; se a resposta não estiver neste contexto, diga que vai confirmar com o RH em vez de arriscar):",
    ...results.map((r) => `[${r.source}] ${r.content}`),
  ].join("\n\n");
}
