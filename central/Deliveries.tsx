import React, { useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw, Search } from "lucide-react";
import { api } from "./api";

type Delivery = {
  id: number;
  kind: "holerite" | "ponto";
  month: string;
  status: string;
  created_at: string;
  numcad: string;
  phone: string;
  name: string | null;
};
const KIND = { holerite: "Holerite", ponto: "Espelho de ponto" } as const;
const competence = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const outcome = (status: string) =>
  status === "enviado" ? "enviado" : status === "sem dados" ? "sem-dados" : "erro";
const OUTCOME_LABEL = { enviado: "Enviado", "sem-dados": "Sem dados no mês", erro: "Falhou" } as const;

/** Holerites e espelhos de ponto entregues pelo WhatsApp (auditoria para o RH). */
export default function Deliveries() {
  const [days, setDays] = useState("30");
  const [rows, setRows] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [result, setResult] = useState("");
  const load = () => {
    setLoading(true);
    setError("");
    api<{ documents: Delivery[] }>(`/whatsapp/documents?days=${days}`)
      .then((r) => setRows(r.documents))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [days]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!kind || r.kind === kind) &&
        (!result || outcome(r.status) === result) &&
        (!q || [r.name, r.numcad, r.phone].some((v) => String(v || "").toLowerCase().includes(q))),
    );
  }, [rows, query, kind, result]);
  const sent = rows.filter((r) => r.status === "enviado").length;
  const failed = rows.filter((r) => outcome(r.status) === "erro").length;
  return (
    <section className="queue deliveries">
      <div className="queue-head">
        <div>
          <h1>Entregas</h1>
          <p>Holerites e espelhos de ponto enviados pelo WhatsApp, depois da confirmação de CPF, matrícula e nome.</p>
        </div>
        <div className="queue-tools">
          <select aria-label="Período" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="365">Últimos 12 meses</option>
          </select>
          <button className="icon-text" onClick={load} title="Atualizar agora">
            <RefreshCw size={15} />
            Atualizar
          </button>
        </div>
      </div>
      <div className="delivery-summary">
        <div>
          <strong>{sent}</strong>
          <span>documentos enviados</span>
        </div>
        <div>
          <strong>{rows.filter((r) => r.kind === "holerite" && r.status === "enviado").length}</strong>
          <span>holerites</span>
        </div>
        <div>
          <strong>{rows.filter((r) => r.kind === "ponto" && r.status === "enviado").length}</strong>
          <span>espelhos de ponto</span>
        </div>
        <button className={failed ? "has-alert" : ""} disabled={!failed} onClick={() => setResult(result === "erro" ? "" : "erro")}>
          <strong>{failed}</strong>
          <span>{result === "erro" ? "mostrando falhas · limpar" : "falhas na consulta"}</span>
        </button>
      </div>
      {error && <div className="notice" role="alert">{error}</div>}
      <div className="queue-filters">
        <label className="queue-search">
          <Search size={16} />
          <input placeholder="Buscar por nome, matrícula ou telefone" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select aria-label="Documento" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Todos os documentos</option>
          <option value="holerite">Holerite</option>
          <option value="ponto">Espelho de ponto</option>
        </select>
        <select aria-label="Situação" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">Todas as situações</option>
          <option value="enviado">Enviado</option>
          <option value="sem-dados">Sem dados no mês</option>
          <option value="erro">Falhou</option>
        </select>
      </div>
      <div className="queue-table">
        <div className="delivery-row queue-header" aria-hidden>
          <span>Quando</span>
          <span>Colaborador</span>
          <span>Documento</span>
          <span>Situação</span>
        </div>
        {loading ? (
          <p className="queue-empty">Carregando entregas…</p>
        ) : visible.length === 0 ? (
          <p className="queue-empty">{rows.length ? "Nenhuma entrega com esses filtros." : "Nenhum documento entregue no período."}</p>
        ) : (
          visible.map((r) => (
            <div className="delivery-row" key={r.id}>
              <span className="delivery-when">{when(r.created_at)}</span>
              <span className="queue-cell-person">
                <strong>
                  {/* Entregas antigas não gravavam o nome: o contato do WhatsApp é só o telefone. */}
                  {(r.name || "").replace(/^WhatsApp\s+/i, "") === r.phone || !r.name ? "Nome não registrado" : r.name}
                </strong>
                <small>
                  Matrícula {r.numcad}
                  {r.phone ? ` · ${r.phone}` : ""}
                </small>
              </span>
              <span className="delivery-doc">
                <FileText size={15} />
                {KIND[r.kind] || r.kind} · {competence(r.month)}
              </span>
              <span className={`delivery-status delivery-${outcome(r.status)}`} title={r.status}>
                {OUTCOME_LABEL[outcome(r.status)]}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
