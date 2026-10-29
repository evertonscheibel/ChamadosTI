import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRows,
  cents,
  totals,
  assertScope,
  links,
  consult,
} from "./senior.mjs";
test("Senior does not confuse query errors with empty results", async () => {
  const xml = (message) =>
    `<Envelope><Body><ConsultarTabelasResponse><result><ocorrencia><mensagem>${message}</mensagem></ocorrencia></result></ConsultarTabelasResponse></Body></Envelope>`;
  assert.deepEqual(await parseRows(xml("Não houve resultados")), []);
  await assert.rejects(parseRows(xml("Limite excedeu")));
  await assert.rejects(parseRows("<Envelope><Body><Fault/></Body></Envelope>"));
});
test("closed payroll is not published automatically and benefits are not guessed", async () => {
  const calls = [];
  const source = {
    configuration: () => ({ benefits: [], releasedCalculations: [] }),
    links: async () => [
      { NUMEMP: "7", TIPCOL: "1", NUMCAD: "1", id: "7:1:1", name: "Fictício" },
    ],
    query: async (table) => {
      calls.push(table);
      assert.equal(table, "R044CAL");
      return [{ NUMEMP: "7", CODCAL: "99", SITCAL: "T" }];
    },
  };
  const payroll = await consult({}, "holerite", "2026-09", "", source);
  assert.deepEqual(payroll.events, []);
  assert.match(payroll.notice, /não liberou/);
  assert.deepEqual(calls, ["R044CAL"]);
  calls.length = 0;
  const benefits = await consult({}, "beneficios", "2026-09", "", source);
  assert.deepEqual(benefits.events, []);
  assert.deepEqual(calls, []);
});
test("amounts and all official event types", () => {
  assert.equal(cents("1.234,56"), 123456);
  assert.equal(cents("1234.56"), 123456);
  assert.throws(() => cents("1,234"));
  assert.deepEqual(
    totals([
      { type: 1, cents: 10000 },
      { type: 2, cents: 100 },
      { type: 5, cents: 200 },
      { type: 3, cents: 1000 },
      { type: 6, cents: 100 },
      { type: 4, cents: 999 },
    ]),
    { earnings: 10300, deductions: 1100, net: 9200 },
  );
  assert.throws(() => totals([{ type: 7, cents: 10 }]));
});
test("foreign employee rows and demonstration accounts are blocked", async () => {
  assert.throws(() =>
    assertScope([{ NUMEMP: 7, TIPCOL: 1, NUMCAD: 2 }], {
      NUMEMP: 7,
      TIPCOL: 1,
      NUMCAD: 1,
    }),
  );
  await assert.rejects(
    links({ id: "demo-colaborador", identifier: "00000000191" }),
    { status: 403 },
  );
});
test("explicit all-calculations release includes closed payroll only", async () => {
  let state = "T";
  const calls = [];
  const source = {
    configuration: () => ({ benefits: [], releasedCalculations: ["*"] }),
    links: async () => [
      { NUMEMP: "7", TIPCOL: "1", NUMCAD: "1", id: "7:1:1", name: "Fictício" },
    ],
    query: async (table) => {
      calls.push(table);
      if (table === "R044CAL")
        return [{ NUMEMP: "7", CODCAL: "99", SITCAL: state }];
      assert.equal(table, "R046VER");
      return [];
    },
  };
  const closed = await consult({}, "holerite", "2026-09", "", source);
  assert.deepEqual(calls, ["R044CAL", "R046VER"]);
  assert.ok(closed.totals);
  state = "A";
  calls.length = 0;
  const pending = await consult({}, "holerite", "2026-09", "", source);
  assert.match(pending.notice, /Não há folha mensal encerrada/);
  assert.deepEqual(calls, ["R044CAL"]);
});
test("the payroll event catalog is fetched once per code, not once per event row", async () => {
  // Regressão de desempenho: um holerite com várias ocorrências do mesmo
  // evento (ex.: horas extras em dias diferentes) não deve consultar a
  // Senior uma vez por linha — só uma vez por código distinto.
  const calls = [];
  const source = {
    configuration: () => ({
      benefits: [],
      releasedCalculations: ["*"],
      eventTable: "1",
    }),
    links: async () => [
      { NUMEMP: "7", TIPCOL: "1", NUMCAD: "1", id: "7:1:1", name: "Fictício" },
    ],
    query: async (table) => {
      calls.push(table);
      if (table === "R044CAL")
        return [{ NUMEMP: "7", CODCAL: "99", SITCAL: "T" }];
      if (table === "R046VER")
        return [
          {
            NUMEMP: "7",
            TIPCOL: "1",
            NUMCAD: "1",
            CODCAL: "99",
            CODEVE: "10",
            REFEVE: "1",
            VALEVE: "100,00",
          },
          {
            NUMEMP: "7",
            TIPCOL: "1",
            NUMCAD: "1",
            CODCAL: "99",
            CODEVE: "10",
            REFEVE: "2",
            VALEVE: "50,00",
          },
        ];
      assert.equal(table, "R008EVC");
      return [{ CODTAB: "1", CODEVE: "10", DESEVE: "Hora extra", TIPEVE: "1" }];
    },
  };
  const result = await consult({}, "holerite", "2026-09", "", source);
  assert.equal(result.events.length, 2);
  assert.deepEqual(
    calls.filter((t) => t === "R008EVC"),
    ["R008EVC"],
  );
});
