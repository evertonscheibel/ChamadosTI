import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { portalVacancyById, portalVacancies } from "./portal-integration.mjs";

test("consulta uma solicitacao antiga por ID com token de servico", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, token: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/integrations/v1/vagas/201")
      return res.end(
        JSON.stringify({
          solicitacao: { id: "201", status: "aprovado", resultado: "APROVADA" },
        }),
      );
    if (req.url === "/integrations/v1/vagas/999") {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "Nao encontrada" }));
    }
    return res.end(JSON.stringify({ solicitacoes: [] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const previousUrl = process.env.PORTAL_INTEGRATION_URL;
  const previousToken = process.env.FRIZELO_PORTAL_INTEGRATION_TOKEN;
  process.env.PORTAL_INTEGRATION_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.FRIZELO_PORTAL_INTEGRATION_TOKEN = "local-test-token";
  try {
    assert.deepEqual(await portalVacancyById("201"), {
      state: "ok",
      solicitacao: { id: "201", status: "aprovado", resultado: "APROVADA" },
    });
    assert.deepEqual(await portalVacancyById("999"), {
      state: "missing",
      status: 404,
      solicitacao: null,
    });
    assert.deepEqual(await portalVacancies(), {
      state: "ok",
      solicitacoes: [],
    });
    await assert.rejects(portalVacancyById("201/other"), /invalido/);
    assert.deepEqual(
      seen.map((call) => call.url),
      [
        "/integrations/v1/vagas/201",
        "/integrations/v1/vagas/999",
        "/integrations/v1/vagas",
      ],
    );
    assert.ok(seen.every((call) => call.token === "Bearer local-test-token"));
  } finally {
    if (previousUrl === undefined) delete process.env.PORTAL_INTEGRATION_URL;
    else process.env.PORTAL_INTEGRATION_URL = previousUrl;
    if (previousToken === undefined)
      delete process.env.FRIZELO_PORTAL_INTEGRATION_TOKEN;
    else process.env.FRIZELO_PORTAL_INTEGRATION_TOKEN = previousToken;
    server.close();
    await once(server, "close");
  }
});
