import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG_TOPICS, exampleFor } from "./chatbot-templates.mjs";

test("every catalog topic has a fictitious example", () => {
  for (const topic of CATALOG_TOPICS) {
    const example = exampleFor(topic);
    assert.equal(typeof example, "string");
    assert.match(example, /FICTÍCIO/);
  }
});

test("exampleFor is undefined for topics outside the catalog", () => {
  assert.equal(exampleFor("duvida"), undefined);
});
