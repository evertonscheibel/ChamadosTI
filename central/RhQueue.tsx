import React, { useEffect, useState } from "react";
import { RefreshCw, Search, ChevronRight, MessageCircle, Globe, Inbox, Headphones, X } from "lucide-react";
import { services, statuses } from "./catalog.mjs";
import { api } from "./api";

export type QueueTab = "responder" | "abertos" | "meus" | "sem" | "atrasados" | "concluidos";
export type QueueRequest = {
  id: string;
  protocol: string;
  subject: string;
  service_id: string;
  fields: Record<string, string>;
  status: string;
  created_at: string;
  requester_name: string;
  department: string;
  assigned_name?: string;
  assigned_to?: string;
  due_at?: string;
  closed_at?: string;
  sla?: { percent: number; level: "verde" | "amarelo" | "laranja" | "vermelho" } | null;
  first_response?: { due_at: string; level: "respondido" | "ok" | "perto" | "atrasado"; late: boolean; left_ms?: number } | null;
  first_response_at?: string | null;
  needs_reply?: boolean;
  last_message_at?: string | null;
};
/** Ainda sem nenhuma resposta pública do RH. */
export const unanswered = (r: QueueRequest) => !!r.first_response && r.first_response.level !== "respondido";
/** Colaborador escreveu de novo depois de o RH já ter respondido. */
export const newMessage = (r: QueueRequest) => !!r.needs_reply && !unanswered(r);
const shortSpan = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, "0") : ""}` : `${minutes} min`;
};
/** Selo da vez do RH: 1ª resposta (com prazo) ou nova mensagem do colaborador. */
export function ReplyFlag({ request }: { request: QueueRequest }) {
  if (request.status === "Concluída") return null;
  const fr = request.first_response;
  if (fr && fr.level !== "respondido")
    return (
      <span className={`reply-flag reply-${fr.level}`} title={`Prazo da 1ª resposta: ${shortDate(fr.due_at)} (horas de expediente)`}>
        {fr.level === "atrasado" ? "1ª resposta atrasada" : `1ª resposta em ${shortSpan(fr.left_ms || 0)}`}
      </span>
    );
  if (newMessage(request)) return <span className="reply-flag reply-new">Nova mensagem</span>;
  return null;
}

const open = (r: QueueRequest) => r.status !== "Concluída";
export const isOverdue = (r: QueueRequest) => open(r) && !!r.due_at && Date.parse(r.due_at) < Date.now();
const time = (iso?: string | null) => (iso ? Date.parse(iso) : Infinity);
const urgency = (r: QueueRequest) =>
  Math.min(time(r.due_at), r.first_response && r.first_response.level !== "respondido" ? time(r.first_response.due_at) : Infinity);
const shortDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Cuiaba",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Tempo restante (ou de atraso) em texto curto: "3d 4h", "5h", "40 min". */
export function remaining(dueAt: string) {
  const minutes = Math.round((Date.parse(dueAt) - Date.now()) / 60000);
  const abs = Math.abs(minutes);
  const span =
    abs >= 1440
      ? `${Math.floor(abs / 1440)}d ${Math.floor((abs % 1440) / 60)}h`
      : abs >= 60
        ? `${Math.floor(abs / 60)}h`
        : `${abs} min`;
  return minutes >= 0 ? `vence em ${span}` : `atrasado há ${span}`;
}

export function Deadline({ request }: { request: QueueRequest }) {
  if (!open(request)) return <span className="deadline-done">Concluído {request.closed_at ? shortDate(request.closed_at) : ""}</span>;
  if (!request.due_at || !request.sla) return <span className="deadline-none">Sem prazo</span>;
  return (
    <span className={`deadline sla-${request.sla.level}`} title={`${request.sla.percent}% do prazo útil consumido · vence ${shortDate(request.due_at)}`}>
      <span className="deadline-track">
        <span style={{ width: `${Math.max(request.sla.percent, 4)}%` }} />
      </span>
      <span className="deadline-text">{remaining(request.due_at)}</span>
    </span>
  );
}

/** Contato do WhatsApp chega como "WhatsApp (67) 9…": o selo de canal já diz isso. */
export const displayName = (r: { requester_name: string; fields?: Record<string, string> }) =>
  r.fields?.Origem === "WhatsApp" ? r.requester_name.replace(/^WhatsApp\s+/i, "") : r.requester_name;

export function Channel({ request }: { request: QueueRequest }) {
  return request.fields?.Origem === "WhatsApp" ? (
    <span className="channel channel-whatsapp">
      <MessageCircle size={12} />
      WhatsApp
    </span>
  ) : (
    <span className="channel">
      <Globe size={12} />
      Portal
    </span>
  );
}

export default function RhQueue({
  requests,
  userId,
  tab,
  setTab,
  onOpen,
  onRefresh,
  syncedAt,
  error,
  tools,
  banner,
}: {
  requests: QueueRequest[];
  userId: string;
  tab: QueueTab;
  setTab: (tab: QueueTab) => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  syncedAt: Date | null;
  error: string;
  tools?: React.ReactNode;
  banner?: React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    api<{ team: { id: string; name: string }[] }>("/team")
      .then((r) => setTeam(r.team))
      .catch(() => {});
  }, []);
  useEffect(() => setSelected(new Set()), [tab]);
  /** Ação rápida em um ou vários chamados; o servidor registra cada mudança no histórico. */
  async function apply(ids: string[], patch: Record<string, unknown>) {
    if (!ids.length || working) return;
    setWorking(true);
    setActionError("");
    const failures: string[] = [];
    const warnings: string[] = [];
    for (const id of ids) {
      try {
        const r = await api<{ warning?: string }>(`/requests/${id}`, "PATCH", patch);
        if (r?.warning) warnings.push(r.warning);
      } catch (e) {
        failures.push(`${requests.find((r) => r.id === id)?.protocol}: ${(e as Error).message}`);
      }
    }
    setWorking(false);
    setSelected(new Set());
    setActionError([...failures, ...new Set(warnings)].join(" · "));
    onRefresh();
  }
  const tabs: [QueueTab, string, (r: QueueRequest) => boolean][] = [
    ["responder", "Para responder", (r) => open(r) && !!r.needs_reply],
    ["abertos", "Abertos", open],
    ["meus", "Minha fila", (r) => open(r) && r.assigned_to === userId],
    ["sem", "Sem responsável", (r) => open(r) && !r.assigned_to],
    ["atrasados", "Atrasados", isOverdue],
    ["concluidos", "Concluídos", (r) => !open(r)],
  ];
  const match = tabs.find(([key]) => key === tab)![2];
  const term = search.trim().toLowerCase();
  const rows = requests
    .filter(match)
    .filter((r) => !theme || r.service_id === theme)
    .filter((r) => !term || `${r.protocol} ${r.subject} ${r.requester_name} ${r.department}`.toLowerCase().includes(term))
    .sort((a, b) =>
      tab === "concluidos"
        ? time(b.closed_at) - time(a.closed_at)
        : // A vez do RH primeiro; depois o prazo mais próximo (1ª resposta ou conclusão).
          Number(!!b.needs_reply) - Number(!!a.needs_reply) || urgency(a) - urgency(b),
    );
  const themes = services.filter((s) => requests.some((r) => r.service_id === s.id));
  const selectable = tab !== "concluidos";
  const chosen = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="queue">
      <div className="queue-head">
        <div>
          <h1>Chamados</h1>
          <p>Ordenados pelo prazo: os mais críticos aparecem primeiro.</p>
        </div>
        <div className="queue-tools">
        {tools}
        <button className="icon-text" onClick={onRefresh} title="Atualizar agora">
          <RefreshCw size={15} />
          {syncedAt ? `Atualizado ${syncedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Atualizar"}
        </button>
        </div>
      </div>
      {banner}
      {error && <div className="notice" role="alert">{error}</div>}
      <div className="queue-tabs-v2" role="tablist">
        {tabs.map(([key, label, test]) => {
          const count = requests.filter(test).length;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`${tab === key ? "selected" : ""} ${(key === "atrasados" || key === "responder") && count ? "alert" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
              <span>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="queue-filters">
        <label className="queue-search">
          <Search size={16} />
          <input
            aria-label="Buscar chamado"
            placeholder="Buscar por protocolo, nome ou assunto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select aria-label="Filtrar por tema" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="">Todos os temas</option>
          {themes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </div>
      {actionError && <div className="notice" role="alert">{actionError}</div>}
      {chosen.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Ações nos chamados selecionados">
          <strong>
            {chosen.length} {chosen.length === 1 ? "selecionado" : "selecionados"}
          </strong>
          <button className="button secondary" disabled={working} onClick={() => void apply(chosen, { assign: true })}>
            <Headphones size={15} />
            Assumir
          </button>
          <select
            aria-label="Mudar status dos selecionados"
            disabled={working}
            value=""
            onChange={(e) => e.target.value && void apply(chosen, { status: e.target.value })}
          >
            <option value="">Mudar status…</option>
            {statuses
              .filter((st) => st !== "Concluída")
              .map((st) => (
                <option key={st}>{st}</option>
              ))}
          </select>
          <select
            aria-label="Passar os selecionados para"
            disabled={working}
            value=""
            onChange={(e) => e.target.value && void apply(chosen, { assigned_to: e.target.value === "-" ? null : e.target.value })}
          >
            <option value="">Passar para…</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="-">Ninguém</option>
          </select>
          <button className="icon-text" onClick={() => setSelected(new Set())}>
            <X size={15} />
            Limpar
          </button>
          {working && <span className="muted">Aplicando…</span>}
        </div>
      )}
      <div className="queue-table" role="list">
        <div className="queue-row v3 queue-header">
          <span className="q-stripe" />
          <span className="q-check">
            {selectable && rows.length > 0 && (
              <input
                type="checkbox"
                aria-label="Selecionar todos os chamados da lista"
                checked={chosen.length === rows.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
              />
            )}
          </span>
          <span className="q-main">Chamado</span>
          <span className="q-person">Colaborador</span>
          <span className="q-status">Status</span>
          <span className="q-owner">Responsável</span>
          <span className="q-deadline">Prazo</span>
          <span className="q-chev" />
        </div>
        {rows.length === 0 ? (
          <div className="queue-empty">
            <Inbox size={30} />
            <strong>
              {tab === "responder" && !term && !theme
                ? "Tudo respondido"
                : requests.length
                  ? "Nenhum chamado aqui"
                  : "Nenhum chamado recebido ainda"}
            </strong>
            <span>{term || theme ? "Ajuste a busca ou o tema." : "Quando chegar um chamado, ele aparece nesta lista."}</span>
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              role="listitem"
              className={`queue-row v3 level-${open(r) ? r.sla?.level || "none" : "done"} ${selected.has(r.id) ? "selected" : ""}`}
              onClick={() => onOpen(r.id)}
            >
              <span className="queue-stripe q-stripe" />
              <span className="q-check" onClick={(e) => e.stopPropagation()}>
                {selectable && (
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${r.protocol}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                )}
              </span>
              <button className="queue-cell-main q-main" onClick={(e) => (e.stopPropagation(), onOpen(r.id))}>
                <small>{r.protocol}</small>
                <strong>{r.subject}</strong>
              </button>
              <span className="queue-cell-person q-person">
                <strong>{displayName(r)}</strong>
                <span>
                  <Channel request={r} />
                  {r.department && r.department !== "Não informado" ? r.department : ""}
                </span>
              </span>
              <span className="q-status">
                <span className={`pill pill-${r.status.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase()}`}>{r.status}</span>
                <ReplyFlag request={r} />
              </span>
              <span className={`q-owner ${r.assigned_name ? "queue-owner" : "queue-owner none"}`}>
                {r.assigned_name ? (
                  r.assigned_name.split(" ").slice(0, 2).join(" ")
                ) : open(r) ? (
                  <button
                    className="quick-assign"
                    disabled={working}
                    title="Assumir este chamado"
                    onClick={(e) => {
                      e.stopPropagation();
                      void apply([r.id], { assign: true, ...(r.status === "Recebida" ? { status: "Em atendimento" } : {}) });
                    }}
                  >
                    <Headphones size={13} />
                    Assumir
                  </button>
                ) : (
                  "Ninguém"
                )}
              </span>
              <span className="q-deadline">
                <Deadline request={r} />
              </span>
              <ChevronRight size={18} className="queue-chevron q-chev" />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
