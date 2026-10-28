import test from "node:test";
import assert from "node:assert/strict";
import { indicators } from "./indicators.mjs";
const now = Date.parse("2026-10-08T12:00:00Z");
const iso = (days) => new Date(now - days * 86400000).toISOString();
const request = (extra = {}) => ({
  user_id: "real",
  service_id: "holerite",
  status: "Recebida",
  created_at: iso(1),
  assigned_to: null,
  due_at: null,
  closed_at: null,
  first_response_at: null,
  ...extra,
});
test("management separates current backlog from period activity and excludes demo", () => {
  const rows = [
    request(),
    request({
      created_at: iso(40),
      due_at: iso(2),
      assigned_to: "rh",
      assigned_name: "RH",
    }),
    request({
      status: "Concluída",
      created_at: iso(50),
      closed_at: iso(2),
      closed_due_at: iso(1),
      first_response_at: iso(49),
    }),
    request({ user_id: "demo-colaborador" }),
  ];
  const result = indicators(rows, { now, days: 7 });
  assert.equal(result.received, 1);
  assert.equal(result.backlog, 2);
  assert.equal(result.closed, 1);
  assert.equal(result.unassigned, 1);
  assert.equal(result.overdue, 1);
  assert.equal(result.firstReplySample, 0);
  assert.equal(result.firstReplyMs, null);
  assert.equal(result.resolutionMs, 48 * 86400000);
  assert.equal(result.withinDeadline, 1);
  assert.equal(result.deadlineSample, 1);
  assert.equal(
    indicators(rows, { now, days: 7, includeDemo: true }).received,
    2,
  );
});
test("closure deadline snapshot is used even when the current due date changes", () => {
  const result = indicators(
    [
      request({
        status: "Concluída",
        closed_at: iso(0),
        due_at: iso(-3),
        closed_due_at: iso(1),
      }),
      request({ status: "Concluída", closed_at: null }),
    ],
    { now, days: 30 },
  );
  assert.equal(result.withinDeadline, 0);
  assert.equal(result.missingClosedDate, 1);
  assert.equal(result.closed, 1);
});
