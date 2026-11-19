import assert from "node:assert/strict";
import { test } from "node:test";
import { emailConfig, alertMessage, digestMessage, createEmailAlerts } from "./email-alerts.mjs";

const request = {
  protocol: "FRZ-2026-000010",
  subject: "Atestado / afastamento",
  requester_name: "Maria Exemplo",
  channel: "WhatsApp",
  due_at: "2026-11-17T19:00:00Z",
  description: "CID e diagnóstico que não podem sair por e-mail",
};

test("e-mail fica desligado sem servidor ou sem destinatários", () => {
  assert.equal(emailConfig({}).enabled, false);
  assert.equal(emailConfig({ SMTP_HOST: "smtp.exemplo.com" }).enabled, false);
  const config = emailConfig({ SMTP_HOST: "smtp.exemplo.com", ALERTA_EMAILS: "rh@exemplo.com; ti@exemplo.com, invalido" });
  assert.equal(config.enabled, true);
  assert.deepEqual(config.recipients, ["rh@exemplo.com", "ti@exemplo.com"]);
  assert.equal(config.port, 587);
  assert.equal(config.secure, false);
  assert.equal(emailConfig({ SMTP_HOST: "x", SMTP_PORT: "465", ALERTA_EMAILS: "a@b.co" }).secure, true);
  assert.equal(emailConfig({ SMTP_HOST: "x", ALERTA_EMAILS: "a@b.co", ALERTA_EMAIL: "off" }).enabled, false);
});

test("mensagem leva protocolo, assunto, nome, canal e prazo, mas nunca o texto do chamado", () => {
  const m = alertMessage(request, "novo", "http://central.local");
  assert.equal(m.subject, "[Central RH] Novo chamado na central: FRZ-2026-000010 · Atestado / afastamento");
  for (const part of [m.text, m.html]) {
    assert.match(part, /FRZ-2026-000010/);
    assert.match(part, /Maria Exemplo/);
    assert.match(part, /17\/11, 15:00/);
    assert.match(part, /http:\/\/central\.local/);
    assert.doesNotMatch(part, /diagnóstico/);
  }
  assert.match(alertMessage(request, "vermelho", "x").subject, /Prazo estourado/);
  assert.match(alertMessage(request, "laranja", "x").subject, /Prazo perto do fim/);
});

test("assunto não aceita quebra de linha e o HTML escapa o conteúdo", () => {
  const m = alertMessage({ ...request, subject: "a\r\nBcc: x@y.z", requester_name: "<script>" }, "novo", "x");
  assert.doesNotMatch(m.subject, /[\r\n]/);
  assert.match(m.html, /&lt;script&gt;/);
});

test("envia para todos os destinatários e respeita os eventos ligados", async () => {
  const sent = [];
  const transport = { sendMail: async (message) => sent.push(message), verify: async () => true };
  const config = emailConfig({ SMTP_HOST: "x", SMTP_FROM: "central@exemplo.com", ALERTA_EMAILS: "rh@exemplo.com,ti@exemplo.com", ALERTA_EMAIL_EVENTOS: "critico" });
  const alerts = createEmailAlerts({ config, transport, log: () => {} });
  assert.equal(await alerts.notify(request, "novo"), false);
  assert.equal(await alerts.digest({ vencidos: [request] }, "2026-11-20"), true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ["rh@exemplo.com", "ti@exemplo.com"]);
  assert.equal(sent[0].from, "central@exemplo.com");
});

test("falha no envio vai para o log e não derruba nada", async () => {
  const logs = [];
  const transport = { sendMail: async () => { throw new Error("recusado"); } };
  const alerts = createEmailAlerts({ config: emailConfig({ SMTP_HOST: "x", ALERTA_EMAILS: "a@b.co" }), transport, log: (l) => logs.push(l) });
  assert.equal(await alerts.notify(request, "novo"), false);
  assert.match(logs[0], /FRZ-2026-000010.*recusado/);
});

test("resumo diário: um e-mail com os grupos, sem o texto do chamado", () => {
  const late = { ...request, protocol: "FRZ-2026-000001" };
  const near = { ...request, protocol: "FRZ-2026-000002", subject: "Férias" };
  const m = digestMessage({ vencidos: [late], primeira: [late], perto: [near], semResponsavel: [] }, "http://central.local", "2026-11-20");
  assert.equal(m.subject, "[Central RH] Resumo dos prazos de 20/11/2026: 2 chamados pedem atenção");
  for (const part of [m.text, m.html]) {
    assert.match(part, /Prazo estourado \(1\)/);
    assert.match(part, /1ª resposta atrasada \(1\)/);
    assert.match(part, /Prazo perto do fim \(1\)/);
    assert.doesNotMatch(part, /Sem responsável/);
    assert.doesNotMatch(part, /diagnóstico/);
  }
  assert.equal(digestMessage({ vencidos: [], perto: [] }, "x", "2026-11-20"), null);
});

test("aviso na hora só para chamado novo; prazo vai só no resumo", async () => {
  const sent = [];
  const transport = { sendMail: async (message) => sent.push(message) };
  const alerts = createEmailAlerts({ config: emailConfig({ SMTP_HOST: "x", ALERTA_EMAILS: "a@b.co" }), transport, log: () => {} });
  assert.equal(await alerts.notify(request, "vermelho"), false);
  assert.equal(await alerts.notify(request, "primeira"), false);
  assert.equal(await alerts.notify(request, "novo"), true);
  assert.equal(await alerts.digest({ vencidos: [] }, "2026-11-20"), false);
  assert.equal(await alerts.digest({ vencidos: [request] }, "2026-11-20"), true);
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /Resumo dos prazos/);
});

test("eventos e hora do resumo configuráveis; 'critico' continua valendo como resumo", () => {
  const base = { SMTP_HOST: "x", ALERTA_EMAILS: "a@b.co" };
  assert.deepEqual(emailConfig(base).events, ["novo", "resumo"]);
  assert.deepEqual(emailConfig({ ...base, ALERTA_EMAIL_EVENTOS: "critico" }).events, ["resumo"]);
  assert.equal(emailConfig(base).digestMinute, 480);
  assert.equal(emailConfig({ ...base, ALERTA_RESUMO_HORA: "7:30" }).digestMinute, 450);
  assert.equal(emailConfig({ ...base, ALERTA_RESUMO_HORA: "lixo" }).digestMinute, 480);
});
