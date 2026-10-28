import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configuration,
  systemPrompt,
  extractProtocolRequest,
  limits,
} from "./hermes-chat.mjs";

test("configuration reads HERMES_* environment variables", () => {
  process.env.HERMES_API_URL = "http://127.0.0.1:8642/v1";
  process.env.HERMES_API_KEY = "test-key";
  process.env.HERMES_API_MODEL = "frizelo-rh-test";
  process.env.HERMES_API_MODELS = ""; // override whatever .env.local sets
  const settings = configuration();
  assert.equal(settings.enabled, true);
  assert.equal(settings.url, "http://127.0.0.1:8642/v1");
  assert.deepEqual(settings.models, ["frizelo-rh-test"]);
  delete process.env.HERMES_API_URL;
  delete process.env.HERMES_API_KEY;
  delete process.env.HERMES_API_MODEL;
  delete process.env.HERMES_API_MODELS;
});

test("configuration prefers HERMES_API_MODELS for the failover route list", () => {
  process.env.HERMES_API_URL = "http://127.0.0.1:8642/v1";
  process.env.HERMES_API_KEY = "test-key";
  process.env.HERMES_API_MODELS = "frizelo-rh, frizelo-rh-2 ,frizelo-rh-3";
  const settings = configuration();
  assert.deepEqual(settings.models, [
    "frizelo-rh",
    "frizelo-rh-2",
    "frizelo-rh-3",
  ]);
  delete process.env.HERMES_API_URL;
  delete process.env.HERMES_API_KEY;
  delete process.env.HERMES_API_MODELS;
});

test("system prompt forbids real employee data", () => {
  assert.match(systemPrompt, /CPF/);
  assert.match(systemPrompt, /TESTE/);
});

test("system prompt requires identity confirmation before showing documents", () => {
  assert.match(systemPrompt, /confirmar/);
  assert.match(systemPrompt, /identificação fictícia/);
});

test("system prompt points doubts to the real ticket area", () => {
  assert.match(systemPrompt, /Minhas solicitações/);
});

test("extractProtocolRequest reads the marker and strips it from the reply", () => {
  const result = extractProtocolRequest(
    'Perfeito, vou registrar.\n<<PROTOCOLO assunto="Férias" descricao="Saldo divergente de 3 dias">>',
  );
  assert.equal(result.text, "Perfeito, vou registrar.");
  assert.deepEqual(result.request, {
    subject: "Férias",
    description: "Saldo divergente de 3 dias",
  });
});

test("extractProtocolRequest leaves plain replies untouched", () => {
  const result = extractProtocolRequest("Olá! Como posso ajudar?");
  assert.equal(result.text, "Olá! Como posso ajudar?");
  assert.equal(result.request, null);
});

test("history sent to the model is bounded (consumption control)", () => {
  assert.ok(limits.maxHistoryMessages > 0);
  assert.ok(limits.maxHistoryMessages < limits.maxSessionMessages);
});
