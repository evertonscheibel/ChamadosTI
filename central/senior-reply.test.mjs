import { test } from "node:test";
import assert from "node:assert/strict";
import { money, parseMonth } from "./senior-reply.mjs";

test("money formats cents as BRL", () => {
  assert.equal(money(270000), "R$ 2.700,00");
  assert.equal(money(0), "R$ 0,00");
});

test("parseMonth understands the formats a colaborador is likely to type", () => {
  assert.equal(parseMonth("2026-09"), "2026-09");
  assert.equal(parseMonth("09/2026"), "2026-09");
  assert.equal(parseMonth("9/2026"), "2026-09");
  assert.equal(parseMonth("setembro/2026"), "2026-09");
  assert.equal(parseMonth("setembro de 2026"), "2026-09");
  assert.equal(parseMonth("Setembro 2026"), "2026-09");
});

test("parseMonth returns null for text it cannot understand", () => {
  assert.equal(parseMonth("mês passado"), null);
  assert.equal(parseMonth(""), null);
});
