import assert from "node:assert/strict";
import { test } from "node:test";
import { staffDomains, normalizeEmail, emailProblem, passwordProblem, linkUrl, linkMessage, newLinkToken, createAccessMailer } from "./staff-access.mjs";

test("domínios: padrão frizelo.com.br, aceita lista e tira @", () => {
  assert.deepEqual(staffDomains({}), ["frizelo.com.br"]);
  assert.deepEqual(staffDomains({ RH_EMAIL_DOMINIOS: "@Frizelo.com.br, frimais.com.br" }), ["frizelo.com.br", "frimais.com.br"]);
});

test("e-mail: só corporativo e bem formado", () => {
  const d = ["frizelo.com.br"];
  assert.equal(normalizeEmail("  Raquel.RH@Frizelo.com.BR "), "raquel.rh@frizelo.com.br");
  assert.equal(emailProblem("raquel.rh@frizelo.com.br", d), null);
  assert.match(emailProblem("raquel@gmail.com", d), /corporativo/);
  assert.match(emailProblem("raquel@frizelo.com.br.evil.com", d), /corporativo/);
  assert.match(emailProblem("raquel@sub.frizelo.com.br", d), /corporativo/);
  assert.match(emailProblem("sem arroba", d), /válido/);
});

test("senha: tamanho, letras e números, sem e-mail nem palavras óbvias", () => {
  assert.equal(passwordProblem("Atendimento2026!", "ana.rh@frizelo.com.br"), null);
  assert.match(passwordProblem("curta1"), /10 caracteres/);
  assert.match(passwordProblem("somenteletras"), /letras e números/);
  assert.match(passwordProblem("12345678901"), /letras e números/);
  assert.match(passwordProblem("xana.rh2026x", "ana.rh@frizelo.com.br"), /e-mail/);
  assert.match(passwordProblem("Frizelo2026!"), /difícil/);
  assert.match(passwordProblem("minhasenha10"), /difícil/);
  assert.match(passwordProblem(undefined), /10 caracteres/);
});

test("link: token forte, no fragmento (#) e com validade no texto", () => {
  const token = newLinkToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, newLinkToken());
  const url = linkUrl("https://10.1.1.53:45873", token);
  assert.equal(url, `https://10.1.1.53:45873/#senha=${token}`);
  const invite = linkMessage({ name: "Ana <b>", url, purpose: "invite" });
  assert.match(invite.subject, /Crie a sua senha/);
  assert.match(invite.text, /72 horas/);
  assert.ok(invite.html.includes("Ana &lt;b&gt;"));
  const reset = linkMessage({ name: "Ana", url, purpose: "reset" });
  assert.match(reset.text, /1 hora/);
  assert.match(reset.text, /continua a mesma/);
});

test("mailer: sem SMTP fica desligado; com transporte envia", async () => {
  assert.equal(createAccessMailer({ smtp: {}, outbox: "" }).enabled, false);
  const sent = [];
  const mailer = createAccessMailer({ smtp: { from: "central@frizelo.com.br" }, outbox: "", transport: { sendMail: async (m) => sent.push(m) } });
  assert.equal(await mailer.send("ana@frizelo.com.br", { subject: "x", text: "y" }), true);
  assert.equal(sent[0].to, "ana@frizelo.com.br");
  const failing = createAccessMailer({ smtp: {}, outbox: "", log: () => {}, transport: { sendMail: async () => { throw new Error("off"); } } });
  assert.equal(await failing.send("a@frizelo.com.br", {}), false);
});
