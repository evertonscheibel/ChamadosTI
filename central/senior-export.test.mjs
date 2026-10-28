import test from "node:test";
import assert from "node:assert/strict";
import {
  extractEmployees,
  csv,
  extraction,
  startExtraction,
} from "./senior-export.mjs";
test("active import restricts the upstream query and refuses inactive rows", async () => {
  const read = async (_table, _fields, filters) => {
    assert.deepEqual(filters.slice(3), [
      ["TIPCOL", "=", "1"],
      ["SITAFA", "<>", "7"],
    ]);
    return [{ NUMEMP: "7", TIPCOL: "1", NUMCAD: "1", SITAFA: "2" }];
  };
  assert.equal(
    (await extractEmployees(read, "7", () => {}, { activeOnly: true })).length,
    1,
  );
  await assert.rejects(
    extractEmployees(
      async () => [{ NUMEMP: "7", TIPCOL: "1", NUMCAD: "1", SITAFA: "7" }],
      "7",
      () => {},
      { activeOnly: true },
    ),
  );
});
test("complete extraction subdivides limits, preserves all links and refuses foreign rows", async () => {
  let calls = 0;
  const read = async (_table, _fields, filters) => {
    calls++;
    const start = Number(filters[1][2]),
      end = Number(filters[2][2]);
    if (start === 0 && end === 999999999)
      throw Object.assign(new Error(), { code: "SENIOR_LIMIT" });
    return start === 0
      ? [
          { NUMEMP: "7", TIPCOL: "1", NUMCAD: "1", NOMFUN: "Teste" },
          { NUMEMP: "7", TIPCOL: "2", NUMCAD: "1", NOMFUN: "Outro vínculo" },
        ]
      : [{ NUMEMP: "7", TIPCOL: "1", NUMCAD: "999999999" }];
  };
  const rows = await extractEmployees(read, "7");
  assert.equal(rows.length, 3);
  assert.equal(calls, 3);
  await assert.rejects(
    extractEmployees(
      async () => [{ NUMEMP: "8", TIPCOL: "1", NUMCAD: "1" }],
      "7",
    ),
  );
  await assert.rejects(
    extractEmployees(async () => {
      throw new Error("connection");
    }, "7"),
  );
});
test("CSV protects formulas, quotes and leading CPF zeros", () => {
  const result = csv([{ NOMFUN: '=formula;"x"', NUMCPF: "123456789" }]);
  assert.ok(result.startsWith("\uFEFF"));
  assert.ok(result.includes("'=formula"));
  assert.ok(result.includes('"00123456789"'));
  assert.ok(result.includes('""x""'));
  assert.ok(
    csv([{ NOMFUN: '  =HYPERLINK("test")' }]).includes("'  =HYPERLINK"),
  );
  assert.ok(!csv([{ NUMCPF: "" }]).includes("00000000000"));
});
test("a second RH cannot take over a running extraction", () => {
  Object.assign(extraction, { state: "running", owner: "rh-1" });
  try {
    assert.throws(() => startExtraction("rh-2"), { status: 429 });
    assert.equal(extraction.owner, "rh-1");
    assert.doesNotThrow(() => startExtraction("rh-1"));
  } finally {
    Object.assign(extraction, { state: "idle", owner: undefined });
  }
});
