import React, { useEffect, useState } from "react";
import { KeyRound, Star, UserMinus, Users } from "lucide-react";
import { api } from "./api";

export type TeamMember = {
  id: string;
  name: string;
  cpf_masked: string;
  unit: string;
  department: string;
  manager: boolean;
  manager_marked: boolean;
  manager_fixed: boolean;
  active: boolean;
  open: number;
  self: boolean;
};
type TeamResponse = { team: TeamMember[]; can_manage: boolean; managers_defined: boolean };

/**
 * Equipe do RH: quem atende na central e quem é gestor. Só gestores alteram;
 * sem nenhum gestor marcado, todo o RH é gestor (como antes).
 */
export default function RhTeam({
  reload,
  onChanged,
  onCode,
  onCanManage,
}: {
  reload: number;
  onChanged: () => void;
  onCode: (access: { code: string; name: string }) => void;
  onCanManage: (canManage: boolean) => void;
}) {
  const [data, setData] = useState<TeamResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const result = await api<TeamResponse>("/rh-team");
      setData(result);
      onCanManage(result.can_manage);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [reload]);
  async function run(action: () => Promise<unknown>, changed = true) {
    setBusy(true);
    setError("");
    try {
      await action();
      if (changed) {
        await load();
        onChanged();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const remove = (m: TeamMember) => {
    if (
      window.confirm(
        `Remover ${m.name} da equipe do RH?\n\nA pessoa deixa de ver os chamados e volta a ser só colaborador. O histórico dos atendimentos continua.`,
      )
    )
      void run(() => api(`/rh-team/${m.id}`, "DELETE"));
  };
  const code = (m: TeamMember) =>
    void run(async () => onCode(await api(`/rh-team/${m.id}/access-code`, "POST", {})), false);
  const toggleManager = (m: TeamMember) =>
    void run(() => api(`/rh-team/${m.id}`, "PATCH", { manager: !m.manager_marked }));
  if (!data) return error ? <div className="notice">{error}</div> : null;
  return (
    <div className="rh-team">
      <div className="rh-team-head">
        <Users size={20} />
        <div>
          <h2>Equipe do RH</h2>
          <p>
            Quem atende os chamados na central. Para incluir alguém, use{" "}
            <strong>Tornar atendente</strong> na lista de colaboradores abaixo.
            {!data.managers_defined &&
              " Ainda não há gestor marcado: por enquanto todo o RH é gestor."}
          </p>
        </div>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="requests-list">
        {data.team.map((m) => (
          <div className="request-row employee-row" key={m.id}>
            <span className="avatar">{m.name[0]}</span>
            <div className="request-row-main">
              <h3>
                {m.name}
                {m.self && <span className="team-tag">você</span>}
                {m.manager && data.managers_defined && <span className="team-tag gestor">gestor</span>}
                {!m.active && <span className="team-tag pendente">sem primeiro acesso</span>}
              </h3>
              <p>
                {m.cpf_masked} · {m.unit}
                {m.open ? ` · ${m.open} chamado(s) em aberto` : ""}
              </p>
            </div>
            {data.can_manage && (
              <div className="team-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => code(m)}
                  title={m.active ? "Gera um código para a pessoa criar uma nova senha" : "Gera o código de primeiro acesso"}
                >
                  <KeyRound size={15} />
                  {m.active ? "Nova senha" : "Código de acesso"}
                </button>
                {!m.self && (
                  <button
                    className={`button secondary${m.manager_marked || m.manager_fixed ? " is-on" : ""}`}
                    disabled={busy || m.manager_fixed}
                    onClick={() => toggleManager(m)}
                    title={
                      m.manager_fixed
                        ? "Definido na configuração do servidor"
                        : m.manager_marked
                          ? "Deixar de ser gestor"
                          : "Marcar como gestor: vê os indicadores de toda a equipe e gerencia a equipe"
                    }
                  >
                    <Star size={15} />
                    {m.manager_marked || m.manager_fixed ? "Gestor" : "Tornar gestor"}
                  </button>
                )}
                {!m.self && !m.manager_fixed && (
                  <button className="button secondary danger" disabled={busy} onClick={() => remove(m)}>
                    <UserMinus size={15} />
                    Remover
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
