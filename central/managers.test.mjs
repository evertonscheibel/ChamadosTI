import assert from "node:assert/strict";
import { test } from "node:test";
import { managerConfig, isManager, monthlyReportDue, managementPdf, peakSummary, monthRange, localMidnight } from "./managers.mjs";
import { indicators, indicatorRows, previousPeriod } from "./indicators.mjs";

const at = (iso) => Date.parse(iso);

test("gestor: lista vazia mantém todo o RH; com lista, só quem está nela", () => {
  const rh = { role: "rh", identifier: "02970431106" };
  assert.equal(isManager(rh, managerConfig({})), true);
  assert.equal(isManager({ role: "colaborador", identifier: "1" }, managerConfig({})), false);
  const config = managerConfig({ CENTRAL_GESTORES: "029.704.311-06; 111", GESTORES_EMAILS: "a@b.co, invalido" });
  assert.equal(isManager(rh, config), true);
  assert.equal(isManager({ role: "rh", identifier: "05502092127" }, config), false);
  assert.deepEqual(config.emails, ["a@b.co"]);
});

test("relatório mensal: 1º dia útil do mês, depois das 8h, uma vez", () => {
  // 01/11/2026 é domingo; o 1º dia útil é segunda, 02/11 (feriado de Finados se configurado).
  assert.equal(monthlyReportDue(at("2026-11-01T13:00:00Z")), null);
  assert.equal(monthlyReportDue(at("2026-11-02T11:59:00Z")), null);
  const due = monthlyReportDue(at("2026-11-02T12:00:00Z"));
  assert.equal(due.key, "2026-10");
  assert.equal(new Date(due.start).toISOString(), "2026-10-01T04:00:00.000Z");
  assert.equal(new Date(due.end).toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(monthlyReportDue(at("2026-11-02T15:00:00Z"), { lastKey: "2026-10" }), null);
  assert.equal(monthlyReportDue(at("2026-11-03T12:00:00Z")), null);
  assert.equal(monthlyReportDue(at("2026-11-02T12:00:00Z"), { holidays: ["2026-11-02"] }), null);
  assert.equal(monthlyReportDue(at("2026-11-03T12:00:00Z"), { holidays: ["2026-11-02"] }).key, "2026-10");
  // Janeiro manda dezembro do ano anterior (1º/01 é feriado: o 1º dia útil é 04/01).
  assert.equal(monthlyReportDue(at("2027-01-04T12:00:00Z"), { holidays: ["2027-01-01"] }).key, "2026-12");
});

test("período anterior: mês fechado compara com o mês anterior; intervalo, com a mesma duração", () => {
  const nov = monthRange(2026, 10);
  const prev = previousPeriod(nov.start, nov.end);
  assert.equal(new Date(prev.start).toISOString(), "2026-10-01T04:00:00.000Z");
  assert.equal(prev.end, nov.start);
  const start = localMidnight("2026-11-10");
  const end = localMidnight("2026-11-17");
  assert.deepEqual(previousPeriod(start, end), { start: start - 7 * 86400000, end: start });
});

const rows = [
  { id: "a", protocol: "P1", user_id: "u", service_id: "holerite", status: "Concluída", assigned_to: "x", assigned_name: "Ana", created_at: "2026-11-10T13:30:00Z", closed_at: "2026-11-11T13:00:00Z", due_at: "2026-11-12T13:00:00Z", closed_due_at: "2026-11-10T20:00:00Z" },
  { id: "b", protocol: "P2", user_id: "u", service_id: "ferias", status: "Recebida", assigned_to: null, created_at: "2026-11-11T21:10:00Z", due_at: "2026-11-12T13:00:00Z" },
  { id: "c", protocol: "P3", user_id: "u", service_id: "holerite", status: "Em atendimento", assigned_to: "x", assigned_name: "Ana", created_at: "2026-10-05T13:00:00Z", due_at: "2026-12-30T13:00:00Z" },
];
const now = at("2026-11-20T12:00:00Z");

test("horários de pico: dia da semana e hora no fuso de MS", () => {
  const report = indicators(rows, { start: localMidnight("2026-11-01"), end: localMidnight("2026-12-01"), now });
  assert.equal(report.received, 2);
  // 10/11 (terça) 09:30 em MS e 11/11 (quarta) 17:10 em MS.
  assert.equal(report.heatmap[2][9], 1);
  assert.equal(report.heatmap[3][17], 1);
  const peak = peakSummary(report.heatmap);
  assert.equal(peak.total, 2);
});

test("lista por indicador filtra por responsável e serviço", () => {
  const options = { start: localMidnight("2026-11-01"), end: localMidnight("2026-12-01"), now };
  assert.deepEqual(indicatorRows(rows, "received", options).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(indicatorRows(rows, "overdue", options).map((r) => r.id), ["b"]);
  assert.deepEqual(indicatorRows(rows, "backlog", { ...options, owner: "unassigned" }).map((r) => r.id), ["b"]);
  assert.deepEqual(indicatorRows(rows, "backlog", { ...options, owner: "x", service: "holerite" }).map((r) => r.id), ["c"]);
  assert.deepEqual(indicatorRows(rows, "closedLate", options).map((r) => r.id), ["a"]);
  assert.equal(indicatorRows(rows, "inexistente", options), null);
});

test("PDF do relatório sai com o período, a comparação e os atendentes", () => {
  const report = indicators(rows, { start: localMidnight("2026-11-01"), end: localMidnight("2026-12-01"), now });
  report.previous = { start: "2026-10-01T04:00:00Z", end: "2026-11-01T04:00:00Z", received: 1, closed: 0, firstReplyMs: null, resolutionMs: null, withinDeadline: 0, deadlineSample: 0, ratingAverage: null };
  const pdf = managementPdf(report, { title: "Relatório do atendimento RH · novembro de 2026" });
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-"));
  assert.match(text, /Desempenho por atendente/);
  assert.match(text, /Ana/);
  assert.match(text, /Hor\S*rios de pico/);
});
