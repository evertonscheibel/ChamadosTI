import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { mkdir, mkdtemp } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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
  const mailFile = path.join(directory, "emails.jsonl");
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
        CENTRAL_MAIL_ARQUIVO: mailFile,
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
    // Período por datas, comparação, lista por indicador e PDF dos gestores.
    assert.equal((await call("/management?from=2026-11-10&to=2026-11-01", { cookie: rh })).status, 400);
    assert.equal((await call("/management?from=2026-11-01", { cookie: rh })).status, 400);
    const ranged = (await call("/management?from=2026-11-01&to=2026-11-30&demo=true", { cookie: rh })).body;
    assert.equal(ranged.scope, "equipe");
    assert.equal(ranged.heatmap.length, 7);
    assert.equal(new Date(ranged.previous.start).toISOString(), "2026-10-01T04:00:00.000Z");
    assert.equal((await call("/management/list?metric=backlog&days=0&demo=true", { cookie: rh })).status, 200);
    assert.equal((await call("/management/list?metric=xyz&days=0", { cookie: rh })).status, 400);
    assert.equal((await call("/management/list?metric=backlog", { cookie: employee })).status, 403);
    const pdf = await fetch(`${origin}/api/management.pdf?days=30`, { headers: { cookie: rh } });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
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
    // Transferência: pede destino válido e motivo; vira nota interna e histórico.
    const transfer = (data) =>
      call(`/requests/${request.id}`, { cookie: rh, method: "PATCH", data: { transfer: data } });
    assert.equal((await transfer({ to: "demo-rh", reason: "Mesma pessoa" })).status, 400);
    assert.equal((await transfer({ to: "demo-colaborador", reason: "Não é do RH" })).status, 400);
    assert.equal((await transfer({ to: null, reason: "" })).status, 400);
    assert.equal((await transfer({ to: null, reason: "Férias da atendente" })).status, 200);
    const transferred = (await call(`/requests/${request.id}`, { cookie: rh })).body;
    assert.equal(transferred.request.assigned_to, null);
    assert.match(transferred.messages.at(-1).body, /transferido.*\n.*Férias da atendente/);
    assert.equal(transferred.messages.at(-1).internal, 1);
    assert.ok(transferred.history.some((row) => row.kind === "transfer"));
    assert.equal((await call(`/requests/${request.id}`, { cookie: employee })).body.messages.length, 0);
    assert.equal((await transfer({ to: "demo-rh", reason: "Volta para a demo" })).status, 200);
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
    assert.equal(internalDetail.messages.length, 3);
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
      .prepare("INSERT INTO users (id,identifier,name,role,unit,department,password_hash) VALUES (?,?,?,?,?,?,?)")
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
      .prepare("INSERT INTO users (id,identifier,name,role,unit,department,password_hash) VALUES (?,?,?,?,?,?,?)")
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
    // Respostas prontas, entregas do WhatsApp, anexo na mensagem e histórico do colaborador.
    assert.equal((await call("/reply-templates", { cookie: employee })).status, 403);
    assert.equal((await call("/whatsapp/documents", { cookie: employee })).status, 403);
    assert.deepEqual((await call("/whatsapp/documents", { cookie: rh })).body.documents, []);
    const seeded = (await call("/reply-templates", { cookie: rh })).body.templates;
    assert.ok(seeded.some((t) => t.title === "Atestado recebido"));
    const saved = await call("/reply-templates", {
      cookie: rh,
      method: "POST",
      data: { title: "Teste", body: "Olá, {nome}! Chamado {protocolo}." },
    });
    assert.equal(saved.status, 201);
    assert.equal(
      (await call(`/reply-templates/${saved.body.template.id}`, { cookie: rh, method: "DELETE", data: {} })).status,
      200,
    );
    assert.equal((await call("/reply-templates", { cookie: rh })).body.templates.length, seeded.length);
    const second = await call("/requests", {
      cookie: employee,
      method: "POST",
      data: { service_id: "holerite", subject: "Outro pedido", description: "Dados fictícios.", fields: { "Mês de referência": "Outubro 2026" } },
    });
    assert.equal(second.status, 201);
    const onlyFile = await call(`/requests/${second.body.request.id}/messages`, {
      cookie: rh,
      method: "POST",
      data: { body: "", attachments: [file] },
    });
    assert.equal(onlyFile.status, 201);
    const secondDetail = (await call(`/requests/${second.body.request.id}`, { cookie: rh })).body;
    const sent = secondDetail.messages.at(-1);
    assert.equal(sent.body, "📎 Segue o anexo.");
    assert.equal(secondDetail.attachments.find((a) => a.message_id === sent.id)?.name, "documento-teste.pdf");
    assert.deepEqual(secondDetail.related.requests.map((r) => r.id), [request.id]);
    assert.equal((await call(`/requests/${second.body.request.id}`, { cookie: employee })).body.related, undefined);

    // Equipe do RH: o gestor libera o e-mail corporativo, a pessoa cria a senha pelo link.
    const teamDb = new DatabaseSync(path.join(directory, "central.sqlite"));
    const outbox = () =>
      existsSync(mailFile)
        ? readFileSync(mailFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [];
    const tokenFrom = (mail) => /#senha=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
    assert.equal((await call("/rh-team", { cookie: employee })).status, 403);
    assert.equal((await call("/rh-team", { cookie: employee, method: "POST", data: { name: "Ana", email: "ana@frizelo.com.br" } })).status, 403);
    let team = (await call("/rh-team", { cookie: rh })).body;
    // Contas de demonstração/técnicas ficam fora; sem gestor marcado, todo o RH gerencia.
    assert.deepEqual(team.team, []);
    assert.equal(team.can_manage, true);
    assert.equal(team.managers_defined, false);
    assert.deepEqual(team.domains, ["frizelo.com.br"]);
    const invite = (data) => call("/rh-team", { cookie: rh, method: "POST", data });
    assert.equal((await invite({ name: "Ana Teste", email: "ana@gmail.com" })).status, 400);
    assert.equal((await invite({ name: "Ana Teste", email: "sem-arroba" })).status, 400);
    assert.equal((await invite({ name: "A", email: "ana@frizelo.com.br" })).status, 400);
    assert.equal((await invite({ name: "Ana Teste", email: " Ana.RH@Frizelo.com.br " })).body.sent, true);
    assert.equal((await invite({ name: "Outra", email: "ana.rh@frizelo.com.br" })).status, 409);
    let mails = outbox();
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, "ana.rh@frizelo.com.br");
    assert.match(mails[0].subject, /Crie a sua senha/);
    const inviteToken = tokenFrom(mails[0]);
    team = (await call("/rh-team", { cookie: rh })).body.team;
    assert.equal(team.length, 1);
    assert.equal(team[0].email, "ana.rh@frizelo.com.br");
    assert.equal(team[0].active, false);
    assert.equal(team[0].link_pending, true);
    // Sem senha ainda: não entra.
    assert.equal((await call("/login", { method: "POST", data: { identifier: "ana.rh@frizelo.com.br", password: "x" } })).status, 401);
    // O link mostra para quem é, valida a senha e só vale uma vez.
    assert.equal((await call("/password/link", { method: "POST", data: { token: "invalido-invalido-invalido" } })).status, 400);
    const linkInfo = (await call("/password/link", { method: "POST", data: { token: inviteToken } })).body;
    assert.deepEqual(linkInfo, { name: "Ana Teste", email: "ana.rh@frizelo.com.br", purpose: "invite" });
    for (const weak of ["curta1", "somenteletras", "1234567890123", "ana.rh2026xx", "Frizelo2026!"])
      assert.equal((await call("/password/set", { method: "POST", data: { token: inviteToken, password: weak } })).status, 400, weak);
    assert.equal((await call("/password/set", { method: "POST", data: { token: inviteToken, password: "Atendimento2026!" } })).status, 200);
    assert.equal((await call("/password/set", { method: "POST", data: { token: inviteToken, password: "Atendimento2026!" } })).status, 400);
    const attendant = await call("/login", { method: "POST", data: { identifier: "ANA.RH@frizelo.com.br", password: "Atendimento2026!" } });
    assert.equal(attendant.status, 200);
    assert.equal(attendant.body.user.role, "rh");
    assert.equal(attendant.body.user.manager, true);
    assert.equal((await call("/login", { method: "POST", data: { identifier: "ana.rh@frizelo.com.br", password: "errada-123" } })).body.error, "E-mail ou senha incorreta.");
    assert.deepEqual((await call("/team", { cookie: rh })).body.team.map((t) => t.id), [team[0].id]);
    const anaId = team[0].id;

    // Esqueci a senha: resposta igual para qualquer e-mail; link só para e-mail liberado.
    const forgot = (email) => call("/password/forgot", { method: "POST", data: { email } });
    const same = (await forgot("ninguem@frizelo.com.br")).body;
    assert.deepEqual((await forgot("ana@gmail.com")).body, same);
    assert.deepEqual((await forgot("ana.rh@frizelo.com.br")).body, same);
    mails = outbox();
    assert.equal(mails.length, 2);
    assert.match(mails[1].subject, /Redefinir/);
    // Novo pedido em menos de 2 minutos não manda outro e-mail.
    await forgot("ana.rh@frizelo.com.br");
    assert.equal(outbox().length, 2);
    assert.equal((await call("/password/set", { method: "POST", data: { token: tokenFrom(mails[1]), password: "Atendo#Bem2027" } })).status, 200);
    // Trocar a senha derruba as sessões abertas.
    assert.equal((await call("/me", { cookie: attendant.cookie })).status, 401);
    const gestorLogin = await call("/login", { method: "POST", data: { identifier: "ana.rh@frizelo.com.br", password: "Atendo#Bem2027" } });
    assert.equal(gestorLogin.status, 200);
    const gestor = gestorLogin.cookie;

    // Gestor marcado: só ele gerencia a equipe e vê os indicadores de todos.
    assert.equal((await call(`/rh-team/${anaId}`, { cookie: rh, method: "PATCH", data: { manager: "sim" } })).status, 400);
    assert.equal((await call(`/rh-team/${anaId}`, { cookie: rh, method: "PATCH", data: { manager: true } })).status, 200);
    team = (await call("/rh-team", { cookie: rh })).body;
    assert.equal(team.managers_defined, true);
    assert.equal(team.can_manage, false);
    assert.equal((await call("/me", { cookie: rh })).body.user.manager, false);
    assert.equal((await call("/rh-team", { cookie: rh, method: "POST", data: { name: "Bruno", email: "bruno@frizelo.com.br" } })).status, 403);
    assert.equal((await call("/rh-team/audit", { cookie: rh })).status, 403);
    assert.equal((await call(`/rh-team/${anaId}`, { cookie: gestor, method: "PATCH", data: { manager: false } })).status, 400);
    assert.equal((await call(`/rh-team/${anaId}`, { cookie: gestor, method: "DELETE", data: {} })).status, 400);

    // Conta antiga pelo CPF: recebe e-mail, o link, e o CPF deixa de valer para ela.
    teamDb
      .prepare("INSERT INTO users (id,identifier,name,role,unit,department,password_hash) VALUES (?,?,?,?,?,?,?)")
      .run("imported-two", "00000000515", "Segundo cadastro", "rh", "Teste", "Teste", "!activation-required");
    teamDb.prepare("INSERT INTO senior_accounts VALUES (?,?,?,?,?)").run("imported-two", "7", 1, "[]", new Date().toISOString());
    team = (await call("/rh-team", { cookie: gestor })).body.team;
    const two = team.find((t) => t.id === "imported-two");
    assert.equal(two.email, null);
    assert.equal(two.cpf_masked, "000.***.***-15");
    assert.equal((await call("/rh-team/imported-two/link", { cookie: gestor, method: "POST", data: {} })).status, 400);
    const cpfCode = await call("/rh-team/imported-two/access-code", { cookie: gestor, method: "POST", data: {} });
    assert.equal(cpfCode.status, 200);
    assert.equal((await call("/rh-team/imported-two", { cookie: gestor, method: "PATCH", data: { email: "ana.rh@frizelo.com.br" } })).status, 409);
    assert.equal((await call("/rh-team/imported-two", { cookie: gestor, method: "PATCH", data: { email: "segundo@outlook.com" } })).status, 400);
    assert.equal((await call("/rh-team/imported-two", { cookie: gestor, method: "PATCH", data: { email: "segundo@frizelo.com.br" } })).status, 200);
    assert.equal((await call("/rh-team/imported-two/access-code", { cookie: gestor, method: "POST", data: {} })).status, 400);
    // O código gerado antes do e-mail não ativa mais a conta.
    assert.equal(
      (await call("/activate", { method: "POST", data: { identifier: "00000000515", code: cpfCode.body.code, password: "SenhaDeTeste!2026" } })).status,
      400,
    );
    const resent = await call("/rh-team/imported-two/link", { cookie: gestor, method: "POST", data: {} });
    assert.equal(resent.body.sent, true);
    assert.equal(outbox().at(-1).to, "segundo@frizelo.com.br");
    assert.equal((await call("/rh-team/demo-rh/link", { cookie: gestor, method: "POST", data: {} })).status, 404);

    // Quem ainda é responsável por chamado aberto não sai da equipe.
    teamDb.prepare("UPDATE requests SET assigned_to='imported-two' WHERE id=?").run(second.body.request.id);
    const blocked = await call("/rh-team/imported-two", { cookie: gestor, method: "DELETE", data: {} });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /1 chamado\(s\) em aberto/);
    teamDb.prepare("UPDATE requests SET assigned_to=NULL WHERE id=?").run(second.body.request.id);
    assert.equal((await call("/rh-team/imported-two", { cookie: gestor, method: "DELETE", data: {} })).status, 200);
    // Veio da Senior: volta a ser colaborador e o e-mail fica livre.
    assert.deepEqual({ ...teamDb.prepare("SELECT role,email FROM users WHERE id='imported-two'").get() }, { role: "colaborador", email: null });

    // Conta só de e-mail removida: desativada, sem login e sem link de senha.
    assert.equal((await call("/rh-team", { cookie: gestor, method: "POST", data: { name: "Bruno Teste", email: "bruno@frizelo.com.br" } })).status, 200);
    const brunoToken = tokenFrom(outbox().at(-1));
    const brunoId = (await call("/rh-team", { cookie: gestor })).body.team.find((t) => t.email === "bruno@frizelo.com.br").id;
    assert.equal((await call(`/rh-team/${brunoId}`, { cookie: gestor, method: "DELETE", data: {} })).status, 200);
    assert.equal((await call("/password/set", { method: "POST", data: { token: brunoToken, password: "Atendimento2026!" } })).status, 400);
    const before = outbox().length;
    await forgot("bruno@frizelo.com.br");
    assert.equal(outbox().length, before);
    assert.ok(!(await call("/rh-team", { cookie: gestor })).body.team.some((t) => t.id === brunoId));
    // Liberar de novo reativa a mesma conta (histórico continua ligado a ela).
    assert.equal((await call("/rh-team", { cookie: gestor, method: "POST", data: { name: "Bruno Teste", email: "bruno@frizelo.com.br" } })).status, 200);
    assert.ok((await call("/rh-team", { cookie: gestor })).body.team.some((t) => t.id === brunoId));

    // Histórico de acessos para os gestores.
    const events = (await call("/rh-team/audit", { cookie: gestor })).body.events.map((e) => e.action);
    for (const action of ["acesso liberado", "convite enviado", "senha criada pelo convite", "senha redefinida pelo link", "marcado como gestor", "e-mail cadastrado", "acesso removido", "acesso reativado"])
      assert.ok(events.includes(action), action);
    teamDb.close();
    await call("/logout", { cookie: employee, method: "POST", data: {} });
    assert.equal((await call("/me", { cookie: employee })).status, 401);
  } finally {
    await stop();
  }
});
