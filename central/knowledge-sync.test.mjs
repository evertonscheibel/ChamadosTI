import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";

const dir = `${import.meta.dirname}/../work/knowledge-sync-test`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
process.env.CENTRAL_POLICIES_DIR = dir;
const { writeStaticDocs } = await import("./knowledge-sync.mjs");

after(() => rmSync(dir, { recursive: true, force: true }));

test("writeStaticDocs generates the services and FAQ documents from the app's own catalog", () => {
  const files = writeStaticDocs();
  assert.deepEqual(files, ["servicos-rh.md", "duvidas-frequentes.md"]);
  const services = readFileSync(`${dir}/servicos-rh.md`, "utf8");
  assert.match(services, /Holerite e pagamentos/);
  assert.match(services, /Como pedir:/);
  const faq = readFileSync(`${dir}/duvidas-frequentes.md`, "utf8");
  assert.match(faq, /Como faço uma solicitação\?/);
});
