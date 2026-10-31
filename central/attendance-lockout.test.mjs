import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";

test("atendimento: uma sessão bloqueada não pode ser reaberta com 'reiniciar'", async () => {
  const scratch =
    process.env.CENTRAL_TEST_ROOT ||
    path.join(process.cwd(), "work", "api-tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, "attendance-lockout-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["central/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CENTRAL_DATA_DIR: directory,
      CENTRAL_PORT: String(port),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (data) => {
    log += data;
  });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${log}`);
      try {
        if ((await fetch(`${origin}/health`)).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    async function send(sessionId, message) {
      const response = await fetch(`${origin}/api/atendimento/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ sessionId, text: message }),
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    const sessionId = "teste-bloqueio-1";
    await send(sessionId, "não sei"); // collect_cpf -> collect_matricula
    const blocked = await send(sessionId, "não sei"); // sem CPF nem matrícula -> blocked
    assert.equal(blocked.stage, "blocked");

    const afterRestart = await send(sessionId, "reiniciar");
    assert.equal(
      afterRestart.stage,
      "blocked",
      "uma sessão bloqueada nunca deve voltar para collect_cpf por 'reiniciar'",
    );

    const afterRecomecar = await send(sessionId, "recomeçar");
    assert.equal(afterRecomecar.stage, "blocked");

    const afterMenu = await send(sessionId, "menu");
    assert.equal(afterMenu.stage, "blocked");
  } finally {
    if (child.exitCode === null) {
      const exit = once(child, "exit");
      child.kill();
      await exit;
    }
  }
});
