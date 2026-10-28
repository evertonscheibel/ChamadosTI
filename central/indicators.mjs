import { services, statuses } from "./catalog.mjs";
const time = (value) => (value ? Date.parse(value) : NaN);
const average = (values) =>
  values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;
export function indicators(
  rows,
  { days = 30, includeDemo = false, now = Date.now() } = {},
) {
  const selected = rows.filter(
    (row) => includeDemo || !row.user_id.startsWith("demo-"),
  );
  const cutoff = days === 0 ? -Infinity : now - days * 86400000;
  const cohort = selected.filter(
    (row) => time(row.created_at) >= cutoff && time(row.created_at) <= now,
  );
  const open = selected.filter((row) => row.status !== "Concluída");
  const closed = selected.filter(
    (row) =>
      row.status === "Concluída" &&
      time(row.closed_at) >= cutoff &&
      time(row.closed_at) <= now,
  );
  const responses = cohort.filter(
    (row) =>
      Number.isFinite(time(row.first_response_at)) &&
      time(row.first_response_at) >= time(row.created_at),
  );
  const durations = closed.filter(
    (row) => time(row.closed_at) >= time(row.created_at),
  );
  const withDue = closed.filter((row) =>
    Number.isFinite(time(row.closed_due_at)),
  );
  const serviceRows = services.map((service) => ({
    id: service.id,
    name: service.title,
    received: cohort.filter((row) => row.service_id === service.id).length,
    open: open.filter((row) => row.service_id === service.id).length,
    closed: closed.filter((row) => row.service_id === service.id).length,
  }));
  const owners = new Map();
  for (const row of open) {
    const id = row.assigned_to || "unassigned";
    if (!owners.has(id))
      owners.set(id, {
        id,
        name: row.assigned_name || "Sem responsável",
        open: 0,
        overdue: 0,
      });
    const owner = owners.get(id);
    owner.open++;
    if (time(row.due_at) < now) owner.overdue++;
  }
  const trend = new Map();
  for (const row of cohort) {
    const day = new Date(row.created_at).toLocaleDateString("en-CA", {
      timeZone: "America/Cuiaba",
    });
    if (!trend.has(day)) trend.set(day, { day, received: 0, closed: 0 });
    trend.get(day).received++;
  }
  for (const row of closed) {
    const day = new Date(row.closed_at).toLocaleDateString("en-CA", {
      timeZone: "America/Cuiaba",
    });
    if (!trend.has(day)) trend.set(day, { day, received: 0, closed: 0 });
    trend.get(day).closed++;
  }
  return {
    days,
    includeDemo,
    generatedAt: new Date(now).toISOString(),
    received: cohort.length,
    closed: closed.length,
    backlog: open.length,
    unassigned: open.filter((row) => !row.assigned_to).length,
    overdue: open.filter((row) => time(row.due_at) < now).length,
    awaitingEmployee: open.filter(
      (row) => row.status === "Aguardando colaborador",
    ).length,
    awaitingFirstReply: open.filter((row) => !row.first_response_at).length,
    firstReplyMs: average(
      responses.map(
        (row) => time(row.first_response_at) - time(row.created_at),
      ),
    ),
    firstReplySample: responses.length,
    resolutionMs: average(
      durations.map((row) => time(row.closed_at) - time(row.created_at)),
    ),
    resolutionSample: durations.length,
    withinDeadline: withDue.filter(
      (row) => time(row.closed_at) <= time(row.closed_due_at),
    ).length,
    deadlineSample: withDue.length,
    missingClosedDate: selected.filter(
      (row) => row.status === "Concluída" && !row.closed_at,
    ).length,
    statuses: statuses.map((status) => ({
      status,
      count: selected.filter((row) => row.status === status).length,
    })),
    aging: [
      { label: "Até 2 dias", min: 0, max: 2 },
      { label: "2 a 7 dias", min: 2, max: 7 },
      { label: "7 a 15 dias", min: 7, max: 15 },
      { label: "15 dias ou mais", min: 15, max: Infinity },
    ].map((bucket) => ({
      label: bucket.label,
      count: open.filter((row) => {
        const age = (now - time(row.created_at)) / 86400000;
        return age >= bucket.min && age < bucket.max;
      }).length,
    })),
    services: serviceRows,
    owners: [...owners.values()].sort((a, b) => b.open - a.open),
    trend: [...trend.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}
export function managementReport(db, options) {
  const rows = db
    .prepare(
      `WITH replies AS (SELECT m.request_id,MIN(m.created_at) first_response_at FROM messages m JOIN users u ON u.id=m.user_id WHERE u.role='rh' AND m.internal=0 GROUP BY m.request_id) SELECT r.id,r.user_id,r.service_id,r.status,r.assigned_to,r.created_at,r.closed_at,r.due_at,r.closed_due_at,u.name assigned_name,p.first_response_at FROM requests r LEFT JOIN users u ON u.id=r.assigned_to LEFT JOIN replies p ON p.request_id=r.id`,
    )
    .all();
  return indicators(rows, options);
}
