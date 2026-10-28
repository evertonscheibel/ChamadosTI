import { test } from "node:test";
import assert from "node:assert/strict";
import { localGuess, classify } from "./chatbot-router.mjs";

test("localGuess recognizes greetings without calling the AI", () => {
  assert.equal(localGuess("Oi, bom dia!"), "saudacao");
  assert.equal(localGuess("menu"), "saudacao");
});

test("localGuess recognizes yes/no confirmations", () => {
  assert.equal(localGuess("Sim, pode confirmar"), "confirmacao");
  assert.equal(localGuess("Não, cancela"), "negacao");
});

test("localGuess recognizes the four catalog topics", () => {
  assert.equal(localGuess("quero ver meu holerite"), "holerite");
  assert.equal(localGuess("meu contracheque de setembro"), "holerite");
  assert.equal(localGuess("espelho de ponto, por favor"), "ponto");
  assert.equal(localGuess("quero ver meu ponto de setembro"), "ponto");
  assert.equal(localGuess("quanto de férias eu tenho?"), "ferias");
  assert.equal(localGuess("quais benefícios eu tenho"), "beneficios");
  assert.equal(localGuess("vale-transporte cobre quanto?"), "beneficios");
});

test("localGuess sends complaints/disputes to the AI, not the canned example", () => {
  assert.equal(
    localGuess("minha marcação de ponto está errada, quero contestar"),
    null,
  );
  assert.equal(
    localGuess("tem uma falta no meu ponto que não é verdade"),
    null,
  );
});

test("localGuess returns null for text unrelated to any catalog topic", () => {
  assert.equal(localGuess("o sistema travou quando eu tentei acessar"), null);
});

test("localGuess never reads a request as a confirmation just because it contains 'pode'", () => {
  assert.equal(
    localGuess("Pode me mostrar um exemplo do meu holerite?"),
    "holerite",
  );
});

test("classify routes a dispute straight to the AI, without asking the cheap classifier to decide", async () => {
  // Regressão: um classificador barato, sem contexto, já confundiu essa
  // frase com "ponto" (pedido de exemplo) em vez de "duvida" (contestação).
  const category = await classify(
    "Tenho uma dúvida: no ponto aparece uma falta no dia 10 mas eu trabalhei.",
  );
  assert.equal(category, "duvida");
});
