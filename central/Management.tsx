import React, { useEffect, useState } from "react";
import { api, downloadFile } from "./api";
type Report = {
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
  services: {
    id: string;
    name: string;
    received: number;
    open: number;
    closed: number;
  }[];
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
const duration = (ms: number | null) =>
  ms === null
    ? "Sem amostra"
    : ms < 3600000
      ? `${Math.round(ms / 60000)} min`
      : `${(ms / 3600000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
export default function Management({
  onQueue,
}: {
  onQueue: (name: string) => void;
}) {
  const [days, setDays] = useState("30");
  // Dados fictícios de demonstração ficam sempre fora dos indicadores.
  const demo = false;
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api<Report>(`/management?days=${days}&demo=${demo}`)
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
  }, [days, demo, refresh]);
  return (
    <section
      className="management"
      aria-label="Indicadores de gestão"
      aria-busy={loading}
    >
      <div className="section-heading">
        <div>
          <h1>Indicadores</h1>
          <p>
            Entradas e conclusões no período; fila e atrasos na situação atual.
          </p>
        </div>
        <div className="management-controls">
          <label>
            Período
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              {[
                ["7", "Últimos 7 dias"],
                ["30", "Últimos 30 dias"],
                ["90", "Últimos 90 dias"],
                ["0", "Todo o histórico"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            disabled={loading || exporting || !report}
            onClick={async () => {
              setExporting(true);
              setError("");
              try {
                await downloadFile(
                  `/management.csv?days=${days}&demo=${demo}`,
                  "indicadores-rh.csv",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => setRefresh(refresh + 1)}
          >
            Atualizar
          </button>
        </div>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p role="status">Atualizando indicadores…</p>
      ) : (
        report && (
          <>
            <div className="management-kpis">
              {[
                ["Recebidas no período", report.received],
                ["Concluídas no período", report.closed],
                ["Em aberto agora", report.backlog],
                ["Aguardando colaborador", report.awaitingEmployee],
                ["Sem primeira resposta", report.awaitingFirstReply],
              ].map(([label, value]) => (
                <div className="management-kpi" key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div className="queue-overview">
              <button onClick={() => onQueue("sem")}>
                <strong>{report.unassigned}</strong> sem responsável
              </button>
              <button onClick={() => onQueue("atrasados")}>
                <strong>{report.overdue}</strong> com prazo ultrapassado
              </button>
            </div>
            <div className="management-kpis">
              <div className="management-kpi">
                <strong>{duration(report.firstReplyMs)}</strong>
                <span>Primeira resposta média</span>
                <small>
                  {report.firstReplySample} respostas públicas · pedidos
                  recebidos no período
                </small>
              </div>
              <div className="management-kpi">
                <strong>{duration(report.resolutionMs)}</strong>
                <span>Tempo médio até conclusão</span>
                <small>
                  {report.resolutionSample} conclusões · horas corridas
                </small>
              </div>
              <div className="management-kpi">
                <strong>
                  {report.deadlineSample
                    ? `${Math.round((report.withinDeadline / report.deadlineSample) * 100)}%`
                    : "Sem amostra"}
                </strong>
                <span>Conclusões dentro do prazo</span>
                <small>
                  {report.withinDeadline} de {report.deadlineSample} com prazo
                  registrado no encerramento
                </small>
              </div>
              <div className="management-kpi">
                <strong>
                  {report.ratingAverage === null
                    ? "Sem notas"
                    : `${report.ratingAverage.toLocaleString("pt-BR")} de 5`}
                </strong>
                <span>Satisfação (WhatsApp)</span>
                <small>
                  {report.ratingSample} notas de {report.ratingSurveyed} chamados
                  concluídos pelo WhatsApp
                </small>
              </div>
            </div>
            <section className="owners-card">
              <h2>Desempenho por atendente</h2>
              <p>
                Fila de agora e, no período, conclusões e tempos médios. A 1ª resposta conta para quem respondeu
                primeiro; a conclusão, para o responsável do chamado.
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
                          <td>{row.open}</td>
                          <td className={row.overdue ? "cell-alert" : ""}>{row.overdue}</td>
                          <td>{row.closed}</td>
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
                        <td>{row.received}</td>
                        <td>{row.open}</td>
                        <td>{row.closed}</td>
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
                        <th>Data · Cuiabá</th>
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
              Atualizado em{" "}
              {new Date(report.generatedAt).toLocaleString("pt-BR", {
                timeZone: "America/Cuiaba",
              })}
              . Notas internas não contam como resposta ao colaborador.{" "}
              {demo
                ? "Inclui solicitações fictícias."
                : "Solicitações fictícias excluídas."}
              {report.missingClosedDate > 0 &&
                ` ${report.missingClosedDate} conclusões antigas sem data comprovada não entram nos tempos.`}
            </p>
          </>
        )
      )}
    </section>
  );
}
