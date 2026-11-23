import React, { useEffect, useMemo, useState } from "react";
import { api, downloadFile } from "./api";
import { services as catalog } from "./catalog.mjs";

type Previous = {
  start: string;
  end: string;
  received: number;
  closed: number;
  firstReplyMs: number | null;
  resolutionMs: number | null;
  withinDeadline: number;
  deadlineSample: number;
  ratingAverage: number | null;
};
type Report = {
  scope: "equipe" | "pessoal";
  period: { start: string | null; end: string };
  previous?: Previous;
  received: number;
  closed: number;
  backlog: number;
  unassigned: number;
  overdue: number;
  awaitingEmployee: number;
  awaitingFirstReply: number;
  firstReplyMs: number | null;
  firstReplySample: number;
  resolutionMs: number | null;
  resolutionSample: number;
  withinDeadline: number;
  deadlineSample: number;
  ratingAverage: number | null;
  ratingSample: number;
  ratingSurveyed: number;
  missingClosedDate: number;
  heatmap: number[][];
  services: { id: string; name: string; received: number; open: number; closed: number }[];
  owners: {
    id: string;
    name: string;
    open: number;
    overdue: number;
    closed: number;
    firstReplyMs: number | null;
    firstReplySample: number;
    resolutionMs: number | null;
    rating: number | null;
    ratingSample: number;
  }[];
  aging: { label: string; count: number }[];
  trend: { day: string; received: number; closed: number }[];
  generatedAt: string;
};
type ListRow = {
  id: string;
  protocol: string;
  subject: string;
  status: string;
  service_id: string;
  assigned_name: string | null;
  created_at: string;
  due_at: string | null;
  closed_at: string | null;
};
/** O que abrir na lista por indicador. */
type Drill = { metric: string; title: string; owner?: string; service?: string };

const duration = (ms: number | null | undefined) =>
  ms === null || ms === undefined
    ? "Sem amostra"
    : ms < 3600000
      ? `${Math.round(ms / 60000)} min`
      : `${(ms / 3600000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : null);
const TZ = "America/Campo_Grande";
const dateText = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ }) : "";
const dateTimeText = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";
/** Data local (MS) no formato AAAA-MM-DD. */
const localDay = (d: Date) => new Date(d.getTime() - 4 * 3600000).toISOString().slice(0, 10);
const serviceName = (id: string) => catalog.find((s) => s.id === id)?.title || id;

/** Variação contra o período anterior, já dizendo se melhorou. */
function Delta({
  now,
  before,
  lowerIsBetter = false,
  neutral = false,
  points = false,
}: {
  now: number | null | undefined;
  before: number | null | undefined;
  lowerIsBetter?: boolean;
  neutral?: boolean;
  points?: boolean;
}) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  let text: string;
  let change: number;
  if (points) {
    change = Math.round(now - before);
    text = `${change > 0 ? "+" : ""}${change} p.p.`;
  } else if (before === 0) {
    if (now === 0) return <em className="delta">igual ao anterior</em>;
    return <em className="delta">antes: 0</em>;
  } else {
    change = Math.round(((now - before) / before) * 100);
    text = `${change > 0 ? "+" : ""}${change}%`;
  }
  if (!change) return <em className="delta">igual ao anterior</em>;
  const better = lowerIsBetter ? change < 0 : change > 0;
  return (
    <em className={`delta ${neutral ? "" : better ? "delta-good" : "delta-bad"}`}>
      {change > 0 ? "▲" : "▼"} {text} vs. anterior
    </em>
  );
}

const PRESETS = [
  ["30d", "Últimos 30 dias"],
  ["7d", "Últimos 7 dias"],
  ["90d", "Últimos 90 dias"],
  ["mes", "Este mês"],
  ["mes-1", "Mês passado"],
  ["livre", "Escolher datas"],
  ["tudo", "Todo o histórico"],
] as const;
function presetQuery(preset: string, from: string, to: string) {
  const today = new Date();
  const local = new Date(today.getTime() - 4 * 3600000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === "mes") return `from=${iso(new Date(Date.UTC(y, m, 1)))}&to=${localDay(today)}`;
  if (preset === "mes-1") return `from=${iso(new Date(Date.UTC(y, m - 1, 1)))}&to=${iso(new Date(Date.UTC(y, m, 0)))}`;
  if (preset === "livre") return from && to ? `from=${from}&to=${to}` : null;
  if (preset === "tudo") return "days=0";
  return `days=${preset.replace("d", "")}`;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
/** Mapa de dia da semana x hora: quanto mais escuro, mais pedidos chegaram. */
function Heatmap({ data }: { data: number[][] }) {
  const max = Math.max(0, ...data.flat());
  const total = data.flat().reduce((a, b) => a + b, 0);
  if (!total) return <p>Sem pedidos no período.</p>;
  // Mostra das 5h às 22h; o que chega fora disso entra na primeira/última coluna.
  const hours = Array.from({ length: 18 }, (_, i) => i + 5);
  const value = (row: number[], hour: number) =>
    hour === 5 ? row.slice(0, 6).reduce((a, b) => a + b, 0) : hour === 22 ? row.slice(22).reduce((a, b) => a + b, 0) : row[hour];
  return (
    <div className="heatmap-wrap">
      <table className="heatmap" aria-label="Pedidos por dia da semana e hora de chegada">
        <thead>
          <tr>
            <th />
            {hours.map((h) => (
              <th key={h} scope="col">
                {h === 5 ? "até 5h" : h === 22 ? "22h+" : `${h}h`}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const row = data[day] || [];
            const rowTotal = row.reduce((a, b) => a + b, 0);
            return (
              <tr key={day}>
                <th scope="row">{WEEKDAYS[day]}</th>
                {hours.map((h) => {
                  const n = value(row, h);
                  const level = n && max ? Math.max(1, Math.ceil((n / max) * 4)) : 0;
                  return (
                    <td key={h} className={`heat-${level}`} title={`${WEEKDAYS[day]}, ${h}h: ${n} pedido(s)`}>
                      {n || ""}
                    </td>
                  );
                })}
                <td className="heat-total">{rowTotal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Lista dos chamados por trás de um número. */
function DrillList({
  drill,
  query,
  onClose,
  onOpenRequest,
}: {
  drill: Drill;
  query: string;
  onClose: () => void;
  onOpenRequest: (id: string) => void;
}) {
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const params = new URLSearchParams(query);
    params.set("metric", drill.metric);
    if (drill.owner) params.set("owner", drill.owner);
    if (drill.service) params.set("service", drill.service);
    api<{ total: number; requests: ListRow[] }>(`/management/list?${params}`)
      .then((r) => {
        if (!live) return;
        setRows(r.requests);
        setTotal(r.total);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [drill, query]);
  return (
    <section className="drill" aria-label={drill.title}>
      <div className="drill-head">
        <h2>{drill.title}</h2>
        <button className="button secondary" onClick={onClose}>
          Fechar lista
        </button>
      </div>
      {error && <div className="notice">{error}</div>}
      {!rows ? (
        <p role="status">Carregando…</p>
      ) : rows.length ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Chamado</th>
                <th>Assunto</th>
                <th>Serviço</th>
                <th>Responsável</th>
                <th>Status</th>
                <th>Aberto</th>
                <th>Prazo</th>
                <th>Concluído</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button className="link-cell" onClick={() => onOpenRequest(r.id)}>
                      {r.protocol}
                    </button>
                  </td>
                  <td>{r.subject}</td>
                  <td>{serviceName(r.service_id)}</td>
                  <td>{r.assigned_name || "Sem responsável"}</td>
                  <td>{r.status}</td>
                  <td>{dateTimeText(r.created_at)}</td>
                  <td className={r.due_at && !r.closed_at && Date.parse(r.due_at) < Date.now() ? "cell-alert" : ""}>
                    {dateTimeText(r.due_at)}
                  </td>
                  <td>{dateTimeText(r.closed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > rows.length && <p className="muted">Mostrando {rows.length} de {total}.</p>}
        </div>
      ) : (
        <p>Nenhum chamado.</p>
      )}
    </section>
  );
}

export default function Management({
  onQueue,
  onOpenRequest,
}: {
  onQueue: (name: string) => void;
  onOpenRequest: (id: string) => void;
}) {
  const [preset, setPreset] = useState<string>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Dados fictícios de demonstração ficam sempre fora dos indicadores.
  const demo = false;
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [drill, setDrill] = useState<Drill | null>(null);
  const query = useMemo(() => {
    const q = presetQuery(preset, from, to);
    return q ? `${q}&demo=${demo}` : null;
  }, [preset, from, to, demo]);
  useEffect(() => {
    if (!query) return;
    let live = true;
    setLoading(true);
    setError("");
    setDrill(null);
    api<Report>(`/management?${query}`)
      .then((data) => {
        if (live) setReport(data);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setReport(null);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [query, refresh]);
  async function exportFile(kind: "csv" | "pdf") {
    if (!query) return;
    setExporting(kind);
    setError("");
    try {
      await downloadFile(`/management.${kind}?${query}`, kind === "csv" ? "indicadores-rh.csv" : "relatorio-atendimento-rh.pdf");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting("");
    }
  }
  const team = report?.scope !== "pessoal";
  const prev = report?.previous;
  // Número clicável: abre a lista dos chamados por trás dele.
  const open = (d: Drill) => () => {
    setDrill(d);
    window.setTimeout(() => document.querySelector(".drill")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const Num = ({ value, d, alert = false }: { value: number; d: Drill; alert?: boolean }) =>
    value ? (
      <button className={`num-link ${alert ? "cell-alert" : ""}`} onClick={open(d)} title="Ver os chamados">
        {value}
      </button>
    ) : (
      <>0</>
    );
  return (
    <section className="management" aria-label="Indicadores de gestão" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h1>{team ? "Indicadores" : "Meus indicadores"}</h1>
          <p>
            {team
              ? "Entradas e conclusões no período, comparadas com o período anterior; fila e atrasos na situação de agora. Clique num número para ver os chamados."
              : "Seus números: chamados em que você é responsável ou deu a primeira resposta. Clique num número para ver os chamados."}
          </p>
        </div>
        <div className="management-controls">
          <label>
            Período
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {preset === "livre" && (
            <>
              <label>
                De
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                Até
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
          {team && (
            <button className="button secondary" disabled={loading || !!exporting || !report} onClick={() => void exportFile("pdf")}>
              {exporting === "pdf" ? "Gerando…" : "Baixar PDF"}
            </button>
          )}
          <button className="button secondary" disabled={loading || !!exporting || !report} onClick={() => void exportFile("csv")}>
            {exporting === "csv" ? "Exportando…" : "Exportar CSV"}
          </button>
          <button className="button secondary" disabled={loading || !query} onClick={() => setRefresh(refresh + 1)}>
            Atualizar
          </button>
        </div>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {!query ? (
        <p>Escolha a data inicial e a final.</p>
      ) : loading ? (
        <p role="status">Atualizando indicadores…</p>
      ) : (
        report && (
          <>
            <p className="period-line">
              {report.period.start ? `De ${dateText(report.period.start)} a ${dateText(new Date(Date.parse(report.period.end) - 1).toISOString())}` : `Todo o histórico até ${dateText(report.period.end)}`}
              {prev && ` · comparado com ${dateText(prev.start)} a ${dateText(new Date(Date.parse(prev.end) - 1).toISOString())}`}
            </p>
            <div className="management-kpis">
              <div className="management-kpi">
                <strong>
                  <Num value={report.received} d={{ metric: "received", title: "Pedidos recebidos no período" }} />
                </strong>
                <span>Recebidos no período</span>
                <Delta now={report.received} before={prev?.received} neutral />
              </div>
              <div className="management-kpi">
                <strong>
                  <Num value={report.closed} d={{ metric: "closed", title: "Chamados concluídos no período" }} />
                </strong>
                <span>Concluídos no período</span>
                <Delta now={report.closed} before={prev?.closed} />
              </div>
              <div className="management-kpi">
                <strong>
                  <Num value={report.backlog} d={{ metric: "backlog", title: "Chamados em aberto agora" }} />
                </strong>
                <span>Em aberto agora</span>
              </div>
              <div className="management-kpi">
                <strong>
                  <Num value={report.awaitingEmployee} d={{ metric: "awaitingEmployee", title: "Aguardando o colaborador" }} />
                </strong>
                <span>Aguardando colaborador</span>
              </div>
              <div className="management-kpi">
                <strong>
                  <Num value={report.awaitingFirstReply} d={{ metric: "awaitingFirstReply", title: "Sem primeira resposta" }} alert />
                </strong>
                <span>Sem primeira resposta</span>
              </div>
            </div>
            <div className="queue-overview">
              <button onClick={team ? () => onQueue("sem") : open({ metric: "unassigned", title: "Sem responsável" })}>
                <strong>{report.unassigned}</strong> sem responsável
              </button>
              <button onClick={open({ metric: "overdue", title: "Com prazo ultrapassado agora" })}>
                <strong>{report.overdue}</strong> com prazo ultrapassado
              </button>
            </div>
            <div className="management-kpis">
              <div className="management-kpi">
                <strong>{duration(report.firstReplyMs)}</strong>
                <span>Primeira resposta média</span>
                <Delta now={report.firstReplyMs} before={prev?.firstReplyMs} lowerIsBetter />
                <small>{report.firstReplySample} respostas públicas · pedidos recebidos no período</small>
              </div>
              <div className="management-kpi">
                <strong>{duration(report.resolutionMs)}</strong>
                <span>Tempo médio até conclusão</span>
                <Delta now={report.resolutionMs} before={prev?.resolutionMs} lowerIsBetter />
                <small>{report.resolutionSample} conclusões · horas corridas</small>
              </div>
              <div className="management-kpi">
                <strong>{report.deadlineSample ? `${pct(report.withinDeadline, report.deadlineSample)}%` : "Sem amostra"}</strong>
                <span>Conclusões dentro do prazo</span>
                <Delta
                  now={pct(report.withinDeadline, report.deadlineSample)}
                  before={prev ? pct(prev.withinDeadline, prev.deadlineSample) : null}
                  points
                />
                <small>
                  {report.withinDeadline} de {report.deadlineSample} ·{" "}
                  <button
                    className="link-inline"
                    onClick={open({ metric: "closedLate", title: "Concluídos fora do prazo no período" })}
                  >
                    ver os fora do prazo
                  </button>
                </small>
              </div>
              <div className="management-kpi">
                <strong>
                  {report.ratingAverage === null ? "Sem notas" : `${report.ratingAverage.toLocaleString("pt-BR")} de 5`}
                </strong>
                <span>Satisfação (WhatsApp)</span>
                <Delta now={report.ratingAverage} before={prev?.ratingAverage} />
                <small>
                  {report.ratingSample} notas de {report.ratingSurveyed} chamados concluídos pelo WhatsApp
                </small>
              </div>
            </div>
            {drill && query && (
              <DrillList drill={drill} query={query} onClose={() => setDrill(null)} onOpenRequest={onOpenRequest} />
            )}
            <section className="owners-card">
              <h2>{team ? "Desempenho por atendente" : "Seu desempenho"}</h2>
              <p>
                Fila de agora e, no período, conclusões e tempos médios. A 1ª resposta conta para quem respondeu primeiro; a
                conclusão, para o responsável do chamado.
              </p>
              {report.owners.length ? (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Atendente</th>
                        <th>Em aberto</th>
                        <th>Atrasados</th>
                        <th>Concluídos</th>
                        <th>1ª resposta média</th>
                        <th>Até concluir</th>
                        <th>Satisfação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.owners.map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>
                            <Num value={row.open} d={{ metric: "backlog", owner: row.id, title: `Em aberto · ${row.name}` }} />
                          </td>
                          <td>
                            <Num
                              value={row.overdue}
                              alert
                              d={{ metric: "overdue", owner: row.id, title: `Com prazo ultrapassado · ${row.name}` }}
                            />
                          </td>
                          <td>
                            <Num value={row.closed} d={{ metric: "closed", owner: row.id, title: `Concluídos no período · ${row.name}` }} />
                          </td>
                          <td>
                            {row.firstReplySample ? duration(row.firstReplyMs) : "—"}
                            {row.firstReplySample > 0 && <small> · {row.firstReplySample}</small>}
                          </td>
                          <td>{row.closed ? duration(row.resolutionMs) : "—"}</td>
                          <td>{row.rating === null ? "—" : `${row.rating.toLocaleString("pt-BR")} ★ · ${row.ratingSample}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Nenhum chamado no período.</p>
              )}
            </section>
            <section className="owners-card">
              <h2>Horários de pico</h2>
              <p>Quando os pedidos chegam, por dia da semana e hora (horário de MS). Ajuda a decidir a escala da equipe.</p>
              <Heatmap data={report.heatmap} />
            </section>
            <details className="management-details">
              <summary>Distribuição e evolução do atendimento</summary>
              <h3>Por serviço</h3>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Serviço</th>
                      <th>Recebidas</th>
                      <th>Fila atual</th>
                      <th>Concluídas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.services.map((row) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>
                          <Num value={row.received} d={{ metric: "received", service: row.id, title: `Recebidos · ${row.name}` }} />
                        </td>
                        <td>
                          <Num value={row.open} d={{ metric: "backlog", service: row.id, title: `Em aberto · ${row.name}` }} />
                        </td>
                        <td>
                          <Num value={row.closed} d={{ metric: "closed", service: row.id, title: `Concluídos · ${row.name}` }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Idade da fila atual</h3>
              <div className="management-kpis">
                {report.aging.map((row) => (
                  <div className="management-kpi" key={row.label}>
                    <strong>{row.count}</strong>
                    <span>{row.label}</span>
                  </div>
                ))}
              </div>
              <h3>Entradas e conclusões por dia</h3>
              {report.trend.length ? (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Recebidas</th>
                        <th>Concluídas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.trend.map((row) => (
                        <tr key={row.day}>
                          <td>{row.day.split("-").reverse().join("/")}</td>
                          <td>{row.received}</td>
                          <td>{row.closed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Sem movimentação no período.</p>
              )}
            </details>
            <p className="muted">
              Atualizado em {new Date(report.generatedAt).toLocaleString("pt-BR", { timeZone: TZ })}. Notas internas não contam
              como resposta ao colaborador. Solicitações fictícias excluídas.
              {report.missingClosedDate > 0 &&
                ` ${report.missingClosedDate} conclusões antigas sem data comprovada não entram nos tempos.`}
            </p>
          </>
        )
      )}
    </section>
  );
}
