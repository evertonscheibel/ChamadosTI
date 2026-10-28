import React, { useState } from "react";
import { api } from "./api";

type Link = { id: string; name: string };
type Row = Record<string, string>;
type Report = {
  notice: string;
  events?: {
    code: string;
    description: string;
    cents: number;
    reference: string;
  }[];
  totals?: { earnings: number; deductions: number; net: number };
  periods?: Row[];
  history?: Row[];
  marks?: Row[];
  situations?: Row[];
};
const money = (value: number) =>
  (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hour = (value: string) =>
  /^\d+$/.test(value) && Number(value) < 1440
    ? `${String(Math.floor(Number(value) / 60)).padStart(2, "0")}:${String(Number(value) % 60).padStart(2, "0")}`
    : value;
function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return rows.length ? (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((title) => (
              <th scope="col" key={title}>
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((value, column) => (
                <td key={column}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="muted">Nenhum registro encontrado nesta consulta.</p>
  );
}
export default function SeniorDocuments() {
  const [kind, setKind] = useState("holerite");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [links, setLinks] = useState<Link[]>([]);
  const [link, setLink] = useState("");
  const [result, setResult] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const available = await api<{ links: Link[] }>("/senior/links");
      setLinks(available.links);
      let selected = link;
      if (!available.links.some((item) => item.id === selected)) {
        selected = available.links.length === 1 ? available.links[0].id : "";
        setLink(selected);
      }
      if (!selected)
        throw new Error(
          available.links.length
            ? "Selecione seu vínculo e consulte novamente."
            : "Nenhum vínculo encontrado para seu CPF.",
        );
      setResult(
        await api<Report>(
          `/senior/consult?${new URLSearchParams({ kind, month, link: selected })}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="requests-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Consulta pessoal</span>
          <h1>Minhas informações</h1>
          <p>
            Consulte suas informações ou solicite documentos ao RH pela página
            inicial.
          </p>
        </div>
      </div>
      <form
        className="request-form consultation-form"
        onSubmit={load}
        aria-busy={busy}
      >
        <label>
          Informação
          <select
            disabled={busy}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setResult(null);
              setError("");
            }}
          >
            {[
              ["holerite", "Folha de pagamento"],
              ["ponto", "Marcações de ponto"],
              ["ferias", "Férias"],
              ["beneficios", "Benefícios em folha"],
            ].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {kind !== "ferias" && (
          <label>
            Competência
            <input
              type="month"
              required
              disabled={busy}
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setResult(null);
              }}
            />
          </label>
        )}
        {links.length > 1 && (
          <label>
            Vínculo
            <select
              disabled={busy}
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setResult(null);
              }}
            >
              <option value="">Selecione</option>
              {links.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="button primary" disabled={busy} type="submit">
          {busy ? "Consultando…" : "Consultar"}
        </button>
      </form>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="consultation-result">
          <p className="notice" role="status">
            {result.notice}
          </p>
          {result.totals && (
            <div className="payroll-totals">
              <p>
                Proventos<strong>{money(result.totals.earnings)}</strong>
              </p>
              <p>
                Descontos<strong>{money(result.totals.deductions)}</strong>
              </p>
              <p>
                Líquido<strong>{money(result.totals.net)}</strong>
              </p>
            </div>
          )}
          {result.events && result.events.length > 0 && (
            <Table
              headers={["Código", "Descrição", "Referência", "Valor"]}
              rows={result.events.map((item) => [
                item.code,
                item.description,
                item.reference,
                money(item.cents),
              ])}
            />
          )}
          {result.periods && (
            <>
              <h2>Períodos aquisitivos</h2>
              <Table
                headers={["Início", "Fim", "Situação"]}
                rows={result.periods.map((item) => [
                  item.INIPER,
                  item.FIMPER,
                  (
                    {
                      "0": "Aberto",
                      "1": "Gozado",
                      "4": "Quitado por afastamento",
                    } as Record<string, string>
                  )[item.SITPER] || `Código ${item.SITPER}: confirmar com RH`,
                ])}
              />
            </>
          )}
          {result.history && (
            <>
              <h2>Histórico de gozo</h2>
              <Table
                headers={["Início do gozo", "Dias"]}
                rows={result.history.map((item) => [item.INIFER, item.DIAFER])}
              />
            </>
          )}
          {result.marks && (
            <>
              <h2>Marcações</h2>
              <Table
                headers={["Dia de apuração", "Data da marcação", "Horário"]}
                rows={result.marks.map((item) => [
                  item.DATAPU,
                  item.DATACC,
                  hour(item.HORACC),
                ])}
              />
            </>
          )}
          {result.situations && (
            <>
              <h2>Situações apuradas</h2>
              <Table
                headers={["Dia", "Código da situação", "Minutos"]}
                rows={result.situations.map((item) => [
                  item.DATAPU,
                  item.CODSIT,
                  item.QTDHOR,
                ])}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
