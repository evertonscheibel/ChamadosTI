import assert from "node:assert/strict";
import { test } from "node:test";
import { indicators } from "./indicators.mjs";
import { managementCsv } from "./management-export.mjs";
test("management CSV preserves scope, missing samples and neutralizes formulas", () => {
  const report = indicators([]);
  report.owners = [{ name: '  =HYPERLINK("evil")', open: 1, overdue: 0 }];
  const result = managementCsv(report);
  assert.ok(result.startsWith("\uFEFF"));
  assert.ok(result.includes('"Inclui demonstração";"Não"'));
  assert.ok(result.includes('"Sem amostra";"0"'));
  assert.ok(result.includes('"\'  =HYPERLINK(""evil"")"'));
  assert.ok(!result.includes("undefined"));
});
