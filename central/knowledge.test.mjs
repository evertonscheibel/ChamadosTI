import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const dir = `${import.meta.dirname}/../work/knowledge-test`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(
  `${dir}/ferias.md`,
  "# Política de férias\n\nO colaborador pode vender até 10 dias de férias, mediante acordo com o gestor.\n\nO período de férias é definido com a chefia imediata.",
);
writeFileSync(
  `${dir}/vale-refeicao.txt`,
  "O vale-refeição é creditado todo dia 5 do mês, no cartão Alelo.",
);
process.env.CENTRAL_POLICIES_DIR = dir;
const { search, contextFor, knowledgeAvailable } =
  await import("./knowledge.mjs");

test("knowledgeAvailable is true once there are documents in the folder", () => {
  assert.equal(knowledgeAvailable(), true);
});

test("search ranks the chunk sharing the most terms with the question first", () => {
  const results = search("posso vender dias de férias?");
  assert.ok(results.length > 0);
  assert.match(results[0].content, /vender até 10 dias de férias/);
  assert.equal(results[0].source, "ferias.md");
});

test("search returns nothing for a question with no overlap with any document", () => {
  assert.deepEqual(search("qual é a capital da frança"), []);
});

test("contextFor returns null instead of an empty block when nothing matches", () => {
  assert.equal(contextFor("qual é a previsão do tempo em marte"), null);
});

test("contextFor cites the source file so the answer can be checked", () => {
  const context = contextFor("quando cai o vale-refeição");
  assert.match(context, /\[vale-refeicao\.txt\]/);
});

after(() => rmSync(dir, { recursive: true, force: true }));
