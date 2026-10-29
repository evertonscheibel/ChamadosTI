import { test } from "node:test";
import assert from "node:assert/strict";
import { recordAnswer, metricsSummary } from "./ai-metrics.mjs";

test("metricsSummary tallies rag hits and tickets created, split by kind", () => {
  const before = metricsSummary().total;
  recordAnswer({ kind: "chatbot", ragHit: true, ticketCreated: false });
  recordAnswer({ kind: "atendimento", ragHit: false, ticketCreated: true });
  recordAnswer({ kind: "atendimento", ragHit: true, ticketCreated: true });
  const summary = metricsSummary();
  assert.equal(summary.total, before + 3);
  assert.ok(summary.ragHits >= 2);
  assert.ok(summary.tickets >= 2);
  assert.ok(summary.daily.length > 0);
  assert.equal(summary.daily[0].day, new Date().toISOString().slice(0, 10));
});
