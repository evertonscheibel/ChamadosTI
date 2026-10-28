import { test } from "node:test";
import assert from "node:assert/strict";
import {
  secondName,
  lastTwoCpfDigits,
  admissionYear,
  buildChallenge,
  looksUnknown,
} from "./senior-identity.mjs";

test("secondName takes the second word of the registered full name", () => {
  assert.equal(secondName("Maria Clara Silva"), "Clara");
  assert.equal(secondName("João Silva"), "Silva");
  assert.equal(secondName("Ana"), null);
});

test("lastTwoCpfDigits pads and validates like the rest of the project", () => {
  assert.equal(lastTwoCpfDigits("000.000.001-91"), "91");
  assert.equal(lastTwoCpfDigits("12345678900"), null); // dígito verificador inválido
});

test("admissionYear reads dd/mm/yyyy", () => {
  assert.equal(admissionYear("15/03/2021"), 2021);
  assert.equal(admissionYear(""), null);
  assert.equal(admissionYear("2021-03-15"), null);
});

test("looksUnknown recognizes common ways of saying 'I don't know'", () => {
  assert.equal(looksUnknown("não sei"), true);
  assert.equal(looksUnknown("Não sei de cor"), true);
  assert.equal(looksUnknown("não lembro a matrícula"), true);
  assert.equal(looksUnknown("123.456.789-00"), false);
});

test("buildChallenge skips what the employee already confirmed", () => {
  const candidate = {
    NOMFUN: "Maria Clara Silva",
    NUMCPF: "00000000191",
    DATADM: "15/03/2021",
  };
  const withMatricula = buildChallenge(candidate, {
    cpfKnown: false,
    matriculaKnown: true,
  });
  assert.equal(withMatricula.length, 3); // cpf, segundo nome, admissão
  assert.deepEqual(
    new Set(withMatricula.map((q) => q.key)),
    new Set(["cpf_ultimos_2", "segundo_nome", "admissao"]),
  );

  const withCpf = buildChallenge(candidate, {
    cpfKnown: true,
    matriculaKnown: false,
  });
  assert.equal(withCpf.length, 2); // segundo nome, admissão (CPF já foi dado)
  assert.deepEqual(
    new Set(withCpf.map((q) => q.key)),
    new Set(["segundo_nome", "admissao"]),
  );
});

test("each challenge question's check() validates the registered answer", () => {
  const candidate = {
    NOMFUN: "Maria Clara Silva",
    NUMCPF: "00000000191",
    DATADM: "15/03/2021",
  };
  const questions = buildChallenge(candidate, {
    cpfKnown: false,
    matriculaKnown: true,
  });
  const byKey = Object.fromEntries(questions.map((q) => [q.key, q]));
  assert.equal(byKey.cpf_ultimos_2.check("91"), true);
  assert.equal(byKey.cpf_ultimos_2.check("00"), false);
  assert.equal(byKey.segundo_nome.check("clara"), true); // sem acento/caixa
  assert.equal(byKey.segundo_nome.check("Clára"), true); // tolera acentuação
  assert.equal(byKey.segundo_nome.check("Silva"), false);
  // admissao: aceita tanto o ano exato quanto o tempo de casa aproximado,
  // dependendo de qual formulação foi sorteada
  const admissaoOk =
    byKey.admissao.check("2021") ||
    byKey.admissao.check(String(new Date().getFullYear() - 2021));
  assert.equal(admissaoOk, true);
});
