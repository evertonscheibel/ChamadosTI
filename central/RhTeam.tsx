import React, { useEffect, useState } from "react";
import { History, KeyRound, Mail, Send, Star, UserMinus, UserPlus, Users } from "lucide-react";
import { api } from "./api";

export type TeamMember = {
  id: string;
  name: string;
  email: string | null;
  cpf_masked: string | null;
  manager: boolean;
  manager_marked: boolean;
  manager_fixed: boolean;
  active: boolean;
  link_pending: boolean;
  open: number;
  self: boolean;
};
type TeamResponse = {
  team: TeamMember[];
  can_manage: boolean;
  managers_defined: boolean;
  domains: string[];
  mail_enabled: boolean;
};
type AuditEvent = { at: string; actor_name: string | null; target_name: string | null; action: string; detail: string | null };

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Campo_Grande", dateStyle: "short", timeStyle: "short" });

/**
 * Equipe do RH: quem atende na central e quem é gestor. Só gestores alteram.
 * A pessoa entra com o e-mail corporativo; o acesso nasce com o convite do gestor
 * (link de uso único por e-mail para criar a senha). Sem gestor marcado, todo o RH é gestor.
 */
export default function RhTeam({ onCode }: { onCode: (access: { code: string; name: string }) => void }) {
  const [data, setData] = useState<TeamResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  async function load() {
    try {
      setData(await api<TeamResponse>("/rh-team"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await action();
      if (message) setNotice(message);
      await load();
      if (audit) setAudit((await api<{ events: AuditEvent[] }>("/rh-team/audit")).events);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const sentText = (sent: boolean, to: string) =>
    sent ? `Link enviado para ${to}.` : `O acesso foi salvo, mas o e-mail para ${to} não saiu. Tente "Enviar link" de novo.`;
  function invite(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const result = await api<{ sent: boolean }>("/rh-team", "POST", { name, email });
      setInviting(false);
      const to = email.trim().toLowerCase();
      setName("");
      setEmail("");
      return sentText(result.sent, to);
    });
  }
  const sendLink = (m: TeamMember) =>
    void run(async () => {
      const result = await api<{ sent: boolean; email: string }>(`/rh-team/${m.id}/link`, "POST", {});
      return sentText(result.sent, result.email);
    });
  const setMemberEmail = (m: TeamMember) => {
    const value = window.prompt(`E-mail corporativo de ${m.name}:`, "");
    if (value)
      void run(async () => {
        await api(`/rh-team/${m.id}`, "PATCH", { email: value });
        return `E-mail cadastrado. Agora use "Enviar link" para ${m.name} criar a senha. A partir daí, o login pelo CPF deixa de valer.`;
      });
  };
  const remove = (m: TeamMember) => {
    if (
      window.confirm(
        `Remover o acesso de ${m.name} à central do RH?\n\nA pessoa sai na hora e não entra mais. O histórico dos atendimentos continua.`,
      )
    )
      void run(async () => {
        await api(`/rh-team/${m.id}`, "DELETE");
        return `Acesso de ${m.name} removido.`;
      });
  };
  const code = (m: TeamMember) =>
    void run(async () => {
      onCode(await api(`/rh-team/${m.id}/access-code`, "POST", {}));
    });
  const toggleManager = (m: TeamMember) =>
    void run(async () => {
      await api(`/rh-team/${m.id}`, "PATCH", { manager: !m.manager_marked });
    });
  async function toggleAudit() {
    if (audit) return setAudit(null);
    try {
      setAudit((await api<{ events: AuditEvent[] }>("/rh-team/audit")).events);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!data) return error ? <div className="notice">{error}</div> : null;
  const status = (m: TeamMember) =>
    m.active ? null : m.link_pending ? (
      <span className="team-tag pendente">convite enviado</span>
    ) : (
      <span className="team-tag pendente">sem senha</span>
    );
  return (
    <div className="rh-team">
      <div className="rh-team-head">
        <Users size={20} />
        <div>
          <h2>Equipe do RH</h2>
          <p>
            Quem atende os chamados na central. A pessoa entra com o <strong>e-mail corporativo</strong> e cria a própria
            senha pelo link enviado ao e-mail. Só gestores liberam ou removem acessos.
            {!data.managers_defined && " Ainda não há gestor marcado: por enquanto todo o RH é gestor."}
          </p>
        </div>
        {data.can_manage && (
          <div className="team-head-actions">
            <button className="button secondary" onClick={() => void toggleAudit()}>
              <History size={15} />
              {audit ? "Ocultar histórico" : "Histórico de acessos"}
            </button>
            <button className="button primary" disabled={busy} onClick={() => setInviting(!inviting)}>
              <UserPlus size={15} />
              Liberar acesso
            </button>
          </div>
        )}
      </div>
      {data.can_manage && !data.mail_enabled && (
        <div className="notice">O envio de e-mail não está configurado na central: não dá para mandar convites.</div>
      )}
      {inviting && (
        <form className="team-invite" onSubmit={invite}>
          <label>
            Nome
            <input required minLength={3} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            E-mail corporativo
            <input
              required
              type="email"
              maxLength={120}
              placeholder={`nome@${data.domains[0] || "frizelo.com.br"}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div className="team-invite-actions">
            <button type="button" className="button secondary" onClick={() => setInviting(false)} disabled={busy}>
              Cancelar
            </button>
            <button className="button primary" disabled={busy}>
              <Send size={15} />
              {busy ? "Enviando…" : "Liberar e enviar convite"}
            </button>
          </div>
          <small>
            Só e-mails {data.domains.map((d) => `@${d}`).join(", ")}. O link vale por 72 horas e só pode ser usado uma
            vez.
          </small>
        </form>
      )}
      {notice && <div className="pending-service">{notice}</div>}
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
                {status(m)}
              </h3>
              <p>
                {m.email || (
                  <>
                    <span className="team-tag pendente">sem e-mail</span> entra pelo CPF {m.cpf_masked}
                  </>
                )}
                {m.open ? ` · ${m.open} chamado(s) em aberto` : ""}
              </p>
            </div>
            {data.can_manage && (
              <div className="team-actions">
                {m.email ? (
                  <button
                    className="button secondary"
                    disabled={busy || !data.mail_enabled}
                    onClick={() => sendLink(m)}
                    title={m.active ? "Envia um link para a pessoa criar uma nova senha" : "Reenvia o convite para criar a senha"}
                  >
                    <Mail size={15} />
                    {m.active ? "Enviar link de senha" : "Reenviar convite"}
                  </button>
                ) : (
                  <>
                    <button className="button secondary" disabled={busy} onClick={() => setMemberEmail(m)}>
                      <Mail size={15} />
                      Cadastrar e-mail
                    </button>
                    <button className="button secondary" disabled={busy} onClick={() => code(m)}>
                      <KeyRound size={15} />
                      Código (CPF)
                    </button>
                  </>
                )}
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
        {!data.team.length && (
          <div className="empty-state">
            <p>Ninguém na equipe ainda. Use “Liberar acesso”.</p>
          </div>
        )}
      </div>
      {audit && (
        <div className="team-audit">
          <h3>Histórico de acessos</h3>
          {audit.length ? (
            <ul>
              {audit.map((a, i) => (
                <li key={i}>
                  <time>{when(a.at)}</time> <strong>{a.actor_name || "Pedido pela própria pessoa"}</strong>: {a.action}
                  {a.target_name ? ` · ${a.target_name}` : ""}
                  {a.detail ? ` (${a.detail})` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nada registrado ainda.</p>
          )}
        </div>
      )}
    </div>
  );
}
