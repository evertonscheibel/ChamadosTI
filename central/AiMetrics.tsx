import React, { useEffect, useState } from "react";
import { api } from "./api";

type Summary = {
  total: number;
  ragHits: number;
  tickets: number;
  daily: { day: string; total: number; rag_hits: number; tickets: number }[];
};

export default function AiMetrics() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Summary>("/ai-metrics")
      .then(setSummary)
      .catch((e) => setError((e as Error).message));
  }, []);
  if (error) return <div className="notice">{error}</div>;
  if (!summary) return null;
  const pct = (n: number) =>
    summary.total ? `${Math.round((n / summary.total) * 100)}%` : "—";
  return (
    <section className="panel ai-metrics">
      <h2>Como a IA está respondendo (últimos 30 dias)</h2>
      {summary.total === 0 ? (
        <p>Ainda não há dúvidas respondidas pela IA completa neste período.</p>
      ) : (
        <>
          <div className="ai-metrics-stats">
            <div>
              <strong>{summary.total}</strong>
              <small>dúvidas respondidas pela IA</small>
            </div>
            <div>
              <strong>{pct(summary.ragHits)}</strong>
              <small>
                com apoio de política/base de conhecimento ({summary.ragHits})
              </small>
            </div>
            <div>
              <strong>{pct(summary.tickets)}</strong>
              <small>terminaram em chamado para o RH ({summary.tickets})</small>
            </div>
          </div>
          <table className="ai-metrics-table">
            <thead>
              <tr>
                <th>Dia</th>
                <th>Dúvidas</th>
                <th>Com RAG</th>
                <th>Chamados</th>
              </tr>
            </thead>
            <tbody>
              {summary.daily.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td>{d.total}</td>
                  <td>{d.rag_hits}</td>
                  <td>{d.tickets}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="ai-metrics-hint">
        Dúvidas sem apoio da base de conhecimento são onde um documento novo em{" "}
        <code>data/policies/</code> tende a ajudar mais.
      </p>
    </section>
  );
}
