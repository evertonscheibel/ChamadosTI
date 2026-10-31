import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizedCpf } from "./identity.mjs";

test("normalizedCpf aceita CPF válido com ou sem máscara, preservando zeros à esquerda", () => {
  assert.equal(normalizedCpf("000.000.002-72"), "00000000272");
  assert.equal(normalizedCpf("00000000272"), "00000000272");
});

test("normalizedCpf rejeita dígito verificador inválido", () => {
  assert.equal(normalizedCpf("000.000.002-73"), null);
  assert.equal(normalizedCpf("123.456.789-00"), null);
});

test("normalizedCpf rejeita sequências repetidas (111.111.111-11 etc.)", () => {
  assert.equal(normalizedCpf("111.111.111-11"), null);
  assert.equal(normalizedCpf("00000000000"), null);
});

test("normalizedCpf rejeita entradas vazias, não numéricas ou nulas", () => {
  assert.equal(normalizedCpf(""), null);
  assert.equal(normalizedCpf(null), null);
  assert.equal(normalizedCpf(undefined), null);
  assert.equal(normalizedCpf("abc"), null);
});
