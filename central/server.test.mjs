import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scryptSync } from "node:crypto";

test("Central Frizelo: privacy, shared workflow, access codes and persistence", async () => {
  const scratch =
    process.env.CENTRAL_TEST_ROOT ||
    path.join(process.cwd(), "work", "api-tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, "central-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  let child;
  let log = "";
  async function start() {
    child = spawn(process.execPath, ["central/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CENTRAL_DATA_DIR: directory,
        CENTRAL_PORT: String(port),
        WAHA_WATCHDOG: "off",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (data) => {
      log += data;
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${log}`);
      try {
        if ((await fetch(`${origin}/health`)).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Server failed to start: ${log}`);
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exit = once(child, "exit");
      child.kill();
      await exit;
    }
  }
  async function call(
    endpoint,
    { cookie, method = "GET", data, source = origin } = {},
  ) {
    const response = await fetch(`${origin}/api${endpoint}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data !== undefined
          ? { "Content-Type": "application/json", Origin: source }
          : {}),
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(identifier) {
    const result = await call("/login", {
      method: "POST",
      data: { identifier, password: "FrizeloDemo!2026" },
    });
    assert.equal(result.status, 200);
    assert.ok(!("password_hash" in result.body.user));
    return result.cookie;
  }
  try {
    await start();
    assert.equal(
      (await call("/login", { method: "POST", data: null })).status,
      400,
    );
    assert.equal(
      (await call("/login", { method: "POST", data: [] })).status,
      400,
    );
    assert.equal((await call("/%zz")).status, 400);
    assert.equal((await call("/requests")).status, 401);
    assert.equal(
      (
        await call("/login", {
          method: "POST",
          source: "https://evil.example",
          data: { identifier: "00000000191", password: "FrizeloDemo!2026" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/login", {
          method: "POST",
          data: { identifier: "00000000191", password: "wrong" },
        })
      ).status,
      401,
    );
    const employee = await login("00000000191");
    const rh = await login("00000000272");
    assert.equal(
      (await call("/portal-vacancies", { cookie: employee })).status,
      403,
    );
    assert.equal(
      (await call("/portal-vacancies/201", { cookie: employee })).status,
      403,
    );
    assert.equal(
      (await call("/portal-vacancies/invalid", { cookie: rh })).status,
      400,
    );
    assert.equal(
      (await call("/integration-links", { cookie: employee })).status,
      403,
    );
    assert.equal(
      (
        await call("/integration-links/missing/publication", {
          cookie: employee,
          method: "PATCH",
          data: { publish: true },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/integration-links/missing/publication", {
          cookie: rh,
          method: "PATCH",
          data: { publish: true },
        })
      ).status,
      404,
    );
    const linkInput = {
      sourceSystem: "portal-lider-isolado",
      sourceId: "test-request-1",
      sourceProtocol: "TEST-001",
      atsInstance: "ats-test-local",
      atsVacancyId: "1",
    };
    assert.equal(
      (
        await call("/integration-links", {
          cookie: employee,
          method: "POST",
          data: linkInput,
        })
      ).status,
      403,
    );
    const linked = await call("/integration-links", {
      cookie: rh,
      method: "POST",
      data: linkInput,
    });
    assert.equal(linked.status, 201);
    assert.equal(
      (
        await call(`/integration-links/${linked.body.link.id}/status`, {
          cookie: employee,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/integration-links", {
          cookie: rh,
          method: "POST",
          data: linkInput,
        })
      ).body.link.id,
      linked.body.link.id,
    );
    assert.equal(
      (
        await call("/integration-links", {
          cookie: rh,
          method: "POST",
          data: { ...linkInput, sourceId: "other" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("/integration-links", {
          cookie: rh,
          method: "POST",
          data: { ...linkInput, sourceProtocol: "other" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("/integration-links", {
          cookie: rh,
          method: "POST",
          data: { ...linkInput, sourceId: "" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await call("/integration-links", { cookie: rh })).body.links.length,
      1,
    );
    assert.equal((await call("/users", { cookie: employee })).status, 403);
    assert.equal((await call("/management", { cookie: employee })).status, 403);
    assert.equal(
      (await call("/management.csv", { cookie: employee })).status,
      403,
    );
    const exportResponse = await fetch(
      `${origin}/api/management.csv?days=0&demo=true`,
      { headers: { Cookie: rh } },
    );
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get("content-type"), /text\/csv/);
    assert.match(
      exportResponse.headers.get("content-disposition"),
      /attachment/,
    );
    const exported = await exportResponse.text();
    assert.ok(exported.includes('"Todo o histórico"'));
    assert.ok(exported.includes('"Inclui demonstração";"Sim"'));
    assert.ok(!exported.includes("00000000191"));
    assert.equal(
      (await call("/management?days=42", { cookie: rh })).status,
      400,
    );
    assert.equal(
      (await call("/senior/employees", { cookie: employee })).status,
      403,
    );
    assert.equal(
      (await call("/senior/employees.csv", { cookie: employee })).status,
      403,
    );
    assert.equal(
      (
        await call("/senior/employees", {
          cookie: employee,
          method: "POST",
          data: {},
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("/senior/employees.csv", { cookie: rh })).status,
      409,
    );
    assert.equal(
      (await call("/senior/links", { cookie: employee })).status,
      403,
    );
    assert.equal(
      (
        await call("/requests", {
          cookie: employee,
          method: "POST",
          data: {
            service_id: "holerite",
            subject: "teste",
            description: "teste",
            fields: { "Mês de referência": "Setembro 2026" },
            attachments: [null],
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/requests", {
          cookie: employee,
          method: "POST",
          data: {
            service_id: "holerite",
            subject: "teste",
            description: "teste",
          },
        })
      ).status,
      400,
    );
    const file = {
      name: "documento-teste.pdf",
      type: "application/pdf",
      data: Buffer.from(
        "%PDF-1.4\nDocumento ficticio de teste\n%%EOF",
      ).toString("base64"),
    };
    const created = await call("/requests", {
      cookie: employee,
      method: "POST",
      data: {
        service_id: "holerite",
        subject: "Teste isolado",
        description: "Dados fictícios.",
        fields: { "Mês de referência": "Setembro 2026" },
        attachments: [file],
      },
    });
    assert.equal(created.status, 201);
    const request = created.body.request;
    assert.match(request.protocol, /^FRZ-\d{4}-000001$/);
    assert.equal(
      (await call("/requests", { cookie: rh })).body.requests[0].id,
      request.id,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}`, {
          cookie: employee,
          method: "PATCH",
          data: { status: "Concluída" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}`, {
          cookie: rh,
          method: "PATCH",
          data: { status: "Concluída" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}`, {
          cookie: rh,
          method: "PATCH",
          data: { assign: true, status: "Em atendimento" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}`, {
          cookie: rh,
          method: "PATCH",
          data: {
            priority: "Alta",
            due_at: "2026-10-01T12:00:00Z",
            assigned_to: "demo-rh",
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}`, {
          cookie: rh,
          method: "PATCH",
          data: { assigned_to: "demo-colaborador" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}`, {
          cookie: rh,
          method: "PATCH",
          data: { due_at: "invalid" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}/messages`, {
          cookie: employee,
          method: "POST",
          data: { body: "Não pode criar nota interna", internal: true },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}/messages`, {
          cookie: rh,
          method: "POST",
          data: {
            body: "Nota interna confidencial de teste",
            internal: true,
            attachments: [file],
          },
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}`, {
          cookie: rh,
          method: "PATCH",
          data: { status: "Concluída" },
        })
      ).status,
      400,
    );
    const internalDetail = (
      await call(`/requests/${request.id}`, { cookie: rh })
    ).body;
    assert.equal(internalDetail.messages.length, 1);
    const hidden = (await call(`/requests/${request.id}`, { cookie: employee }))
      .body;
    assert.equal(hidden.messages.length, 0);
    assert.ok(
      internalDetail.history.some((row) => row.kind === "internal_note"),
    );
    assert.ok(!hidden.history.some((row) => row.kind === "internal_note"));
    assert.equal(
      (await call("/management?demo=true", { cookie: rh })).body
        .firstReplySample,
      0,
    );
    assert.equal(hidden.attachments.length, 1);
    const internalFile = internalDetail.attachments.find(
      (a) => a.internal === 1,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/attachments/${internalFile.id}`, {
          headers: { Cookie: employee },
        })
      ).status,
      404,
    );
    const database = new DatabaseSync(path.join(directory, "central.sqlite"));
    const salt = "second-user-test";
    database
      .prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)")
      .run(
        "test-second",
        "00000000353",
        "Outro colaborador",
        "colaborador",
        "Teste",
        "Teste",
        `${salt}:${scryptSync("FrizeloDemo!2026", salt, 64).toString("hex")}`,
      );
    database.close();
    const other = await login("00000000353");
    assert.deepEqual(
      (await call("/requests", { cookie: other })).body.requests,
      [],
    );
    assert.equal(
      (await call(`/requests/${request.id}`, { cookie: other })).status,
      404,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}/messages`, {
          cookie: other,
          method: "POST",
          data: { body: "Não autorizado" },
        })
      ).status,
      404,
    );
    const detail = (await call(`/requests/${request.id}`, { cookie: employee }))
      .body;
    const attachmentId = detail.attachments[0].id;
    assert.equal(
      (
        await fetch(`${origin}/api/attachments/${attachmentId}`, {
          headers: { Cookie: other },
        })
      ).status,
      404,
    );
    const download = await fetch(`${origin}/api/attachments/${attachmentId}`, {
      headers: { Cookie: employee },
    });
    assert.equal(download.status, 200);
    assert.equal(
      await download.text(),
      Buffer.from(file.data, "base64").toString(),
    );
    assert.equal(
      (
        await call(`/requests/${request.id}/messages`, {
          cookie: rh,
          method: "POST",
          data: { body: "Qual é o mês de referência?" },
        })
      ).status,
      201,
    );
    await call(`/requests/${request.id}`, {
      cookie: rh,
      method: "PATCH",
      data: { status: "Aguardando colaborador" },
    });
    await call(`/requests/${request.id}/messages`, {
      cookie: employee,
      method: "POST",
      data: { body: "Setembro." },
    });
    assert.equal(
      (await call(`/requests/${request.id}`, { cookie: employee })).body.request
        .status,
      "Em atendimento",
    );
    await call(`/requests/${request.id}/messages`, {
      cookie: rh,
      method: "POST",
      data: { body: "Orientações enviadas. Atendimento de teste concluído." },
    });
    assert.equal(
      (
        await call(`/requests/${request.id}`, {
          cookie: rh,
          method: "PATCH",
          data: { status: "Concluída" },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(`/requests/${request.id}/messages`, {
          cookie: employee,
          method: "POST",
          data: { body: "Não deve permitir" },
        })
      ).status,
      409,
    );
    assert.equal(
      (await call("/users", { cookie: rh, method: "POST", data: {} })).status,
      405,
    );
    const importedDb = new DatabaseSync(path.join(directory, "central.sqlite"));
    importedDb
      .prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)")
      .run(
        "imported-test",
        "00000000434",
        "Cadastro fictício",
        "colaborador",
        "Teste",
        "Teste",
        "!activation-required",
      );
    importedDb
      .prepare("INSERT INTO senior_accounts VALUES (?,?,?,?,?)")
      .run("imported-test", "7", 1, "[]", new Date().toISOString());
    importedDb.close();
    const registered = await call("/users/imported-test/access-code", {
      cookie: rh,
      method: "POST",
      data: {},
    });
    assert.equal(registered.status, 200);

    assert.equal(
      (
        await call("/activate", {
          method: "POST",
          data: {
            identifier: "00000000434",
            code: "wrong",
            password: "SenhaDeTeste!2026",
          },
        })
      ).status,
      400,
    );
    const activate = {
      identifier: "00000000434",
      code: registered.body.code,
      password: "SenhaDeTeste!2026",
    };
    assert.equal(
      (await call("/activate", { method: "POST", data: activate })).status,
      200,
    );
    assert.equal(
      (await call("/activate", { method: "POST", data: activate })).status,
      400,
    );
    assert.equal(
      (
        await call("/login", {
          method: "POST",
          data: { identifier: "00000000434", password: "SenhaDeTeste!2026" },
        })
      ).status,
      200,
    );
    await stop();
    await start();
    assert.equal(
      (await call("/integration-links", { cookie: rh })).body.links[0].id,
      linked.body.link.id,
    );
    const persisted = (
      await call(`/requests/${request.id}`, { cookie: employee })
    ).body;
    assert.equal(persisted.request.status, "Concluída");
    assert.equal(persisted.messages.length, 3);
    assert.ok(persisted.history.length >= 4);
    assert.equal(persisted.attachments.length, 1);
    assert.equal(persisted.request.priority, "Alta");
    assert.equal(persisted.request.assigned_to, "demo-rh");
    assert.ok(persisted.request.closed_at);
    assert.equal(persisted.request.closed_due_at, "2026-10-01T12:00:00Z");
    const analytics = (
      await call("/management?days=0&demo=true", { cookie: rh })
    ).body;
    assert.equal(analytics.closed, 1);
    assert.equal(analytics.firstReplySample, 1);
    assert.equal(analytics.resolutionSample, 1);
    assert.equal(analytics.deadlineSample, 1);
    assert.equal(
      (await call("/management?days=0", { cookie: rh })).body.received,
      0,
    );
    assert.ok(
      persisted.history.some(
        (row) =>
          row.kind === "priority" &&
          row.data.from === "Normal" &&
          row.data.to === "Alta",
      ),
    );
    await call("/logout", { cookie: employee, method: "POST", data: {} });
    assert.equal((await call("/me", { cookie: employee })).status, 401);
  } finally {
    await stop();
  }
});
