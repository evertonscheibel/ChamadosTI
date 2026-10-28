import React, { useEffect, useState } from "react";
import { api } from "./api";

type Request = {
  id: string;
  codigo: string | null;
  colaborador: string;
  motivo: string;
  status: string;
  resultado: string | null;
  criadoEm: string;
  vaga?: { cargo: string; setor: string; quantidade: number } | null;
};
export default function PortalVacancies() {
  const [items, setItems] = useState<Request[]>([]);
  const [state, setState] = useState("Carregando solicitações…");
  const [creating, setCreating] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [searchId, setSearchId] = useState("");
  const [searched, setSearched] = useState<Request | null>(null);
  const [searchStatus, setSearchStatus] = useState("");
  async function search() {
    const id = searchId.trim();
    if (!/^\d+$/.test(id)) {
      setSearchStatus("Informe o ID numérico da solicitação.");
      return;
    }
    setSearchStatus("Consultando solicitação…");
    try {
      const result = await api<Request>(`/portal-vacancies/${id}`);
      setSearched(result);
      setSearchStatus("Solicitação localizada no Portal do Líder.");
    } catch (e) {
      setSearched(null);
      setSearchStatus(e instanceof Error ? e.message : "Falha na consulta.");
    }
  }
  async function create(id: string) {
    setCreating(id);
    try {
      await api(`/portal-vacancies/${id}/create-ats`, "POST", {});
      window.dispatchEvent(new Event("frizelo-vacancy-linked"));
      await load();
      setState(
        "Vaga criada ou vinculada no ATS. Confira em Vínculos de recrutamento.",
      );
    } catch (e) {
      setState(e instanceof Error ? e.message : "Falha ao criar vaga.");
    } finally {
      setCreating(null);
    }
  }
  async function decide(id: string, decision: "APROVADA" | "REPROVADA") {
    if (
      !window.confirm(
        `${decision === "APROVADA" ? "Aprovar" : "Reprovar"} a solicitação ${id} pelo RH?`,
      )
    )
      return;
    setDeciding(id);
    try {
      await api(`/portal-vacancies/${id}/decision`, "POST", { decision });
      await load();
      if (searched?.id === id)
        setSearched(await api<Request>(`/portal-vacancies/${id}`));
      setState(
        decision === "APROVADA"
          ? "Pedido aprovado pelo RH. Decisão registrada no Portal do Líder. A vaga já pode ser criada no ATS, sem divulgação automática."
          : "Pedido reprovado pelo RH. Decisão registrada no Portal do Líder.",
      );
    } catch (e) {
      setState(
        e instanceof Error ? e.message : "Falha ao decidir solicitação.",
      );
    } finally {
      setDeciding(null);
    }
  }
  async function load() {
    setState("Atualizando…");
    try {
      const result = await api<{ state: string; solicitacoes: Request[] }>(
        "/portal-vacancies",
      );
      setItems(result.solicitacoes);
      setState(
        result.state === "ok"
          ? `Atualizado agora · ${result.solicitacoes.length} solicitações de vaga`
          : "Portal do Líder indisponível ou não configurado.",
      );
    } catch (e) {
      setState(e instanceof Error ? e.message : "Falha na consulta.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section
      className="management"
      aria-label="Solicitações de vaga do Portal do Líder"
    >
      <div className="section-heading">
        <div>
          <h2>Solicitações de vaga do Portal do Líder</h2>
          <p>{state}</p>
        </div>
        <button type="button" onClick={() => void load()}>
          Atualizar
        </button>
      </div>
      <p>
        O líder solicita no Portal do Líder. O RH aprova ou recusa aqui na
        Central, cria a vaga no ATS após a aprovação e autoriza a divulgação no
        site em uma etapa separada.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label htmlFor="portal-vacancy-id">
          Buscar solicitação antiga pelo ID
        </label>{" "}
        <input
          id="portal-vacancy-id"
          inputMode="numeric"
          pattern="[0-9]+"
          value={searchId}
          onChange={(event) => setSearchId(event.target.value)}
          placeholder="ID da solicitação"
        />{" "}
        <button type="submit">Buscar</button>
        {searchStatus ? <p role="status">{searchStatus}</p> : null}
      </form>
      {searched || items.length ? (
        <ul>
          {[
            ...(searched && !items.some((item) => item.id === searched.id)
              ? [searched]
              : []),
            ...items,
          ].map((item) => (
            <li key={item.id}>
              <strong>{item.codigo || `#${item.id}`}</strong> ·{" "}
              {item.vaga
                ? `${item.vaga.cargo} · ${item.vaga.setor} · ${item.vaga.quantidade} posição(ões)`
                : item.colaborador}{" "}
              · {item.status}
              {item.resultado ? ` / ${item.resultado}` : ""} · {item.motivo}
              {item.status === "aguardando_aprovacao" && !item.resultado ? (
                <>
                  <button
                    type="button"
                    disabled={deciding === item.id}
                    onClick={() => void decide(item.id, "APROVADA")}
                  >
                    {deciding === item.id ? "Registrando…" : "Aprovar pelo RH"}
                  </button>{" "}
                  <button
                    type="button"
                    disabled={deciding === item.id}
                    onClick={() => void decide(item.id, "REPROVADA")}
                  >
                    Reprovar
                  </button>
                </>
              ) : null}
              {item.status === "aprovado" &&
              item.resultado === "APROVADA" &&
              item.vaga ? (
                <button
                  type="button"
                  disabled={creating === item.id}
                  onClick={() => void create(item.id)}
                >
                  {creating === item.id
                    ? "Criando…"
                    : "Criar ou localizar no ATS"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : state.startsWith("Atualizado") ? (
        <p>Nenhuma solicitação de vaga encontrada.</p>
      ) : null}
    </section>
  );
}
