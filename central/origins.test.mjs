import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedOrigins } from "./origins.mjs";

test("origens aceitas: local sempre; endereço de produção via CENTRAL_URL e CENTRAL_ORIGINS", () => {
  const local = allowedOrigins(45873, {});
  assert.ok(local.has("http://127.0.0.1:45873"));
  assert.ok(local.has("http://localhost:45873"));
  assert.ok(!local.has("http://10.1.1.53:45873"));

  const prod = allowedOrigins(45873, {
    CENTRAL_URL: "http://10.1.1.53:45873/",
    CENTRAL_ORIGINS: "http://rh.frizelo.local, inválido, https://rh.frizelo.local:8443/x",
  });
  assert.ok(prod.has("http://10.1.1.53:45873"));
  assert.ok(prod.has("http://rh.frizelo.local"));
  assert.ok(prod.has("https://rh.frizelo.local:8443"));
  assert.ok(!prod.has("http://evil.example"));
  assert.ok(!prod.has(undefined));
});
