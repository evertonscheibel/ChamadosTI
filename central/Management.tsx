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
  missingClosedDate: number;
  services: {
    id: string;
    name: string;
    received: number;
    open: number;
    closed: number;
  }[];
  owners: { id: string; name: string; open: number; overdue: number }[];
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
  const [demo, setDemo] = useState(false);
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
          <h2>Indicadores de gestão</h2>
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
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={demo}
              onChange={(e) => setDemo(e.target.checked)}
            />
            Incluir demonstração
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
            {exporting ? "Exportando…" : "Exportar indicadores"}
          </button>
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => setRefresh(refresh + 1)}
          >
            Atualizar indicadores
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
              <button onClick={() => onQueue("Não atribuídas")}>
                <strong>{report.unassigned}</strong> sem responsável
              </button>
              <button onClick={() => onQueue("Prazo ultrapassado")}>
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
            </div>
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
              <h3>Fila por responsável</h3>
              {report.owners.length ? (
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Responsável</th>
                        <th>Em aberto</th>
                        <th>Atrasadas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.owners.map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>{row.open}</td>
                          <td>{row.overdue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Nenhuma solicitação em aberto.</p>
              )}
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
