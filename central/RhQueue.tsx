import React, { useState } from "react";
import { RefreshCw, Search, ChevronRight, MessageCircle, Globe, Inbox } from "lucide-react";
import { services } from "./catalog.mjs";

export type QueueTab = "abertos" | "meus" | "sem" | "atrasados" | "concluidos";
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
};

const open = (r: QueueRequest) => r.status !== "Concluída";
export const isOverdue = (r: QueueRequest) => open(r) && !!r.due_at && Date.parse(r.due_at) < Date.now();
const time = (iso?: string) => (iso ? Date.parse(iso) : Infinity);
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
  const tabs: [QueueTab, string, (r: QueueRequest) => boolean][] = [
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
      tab === "concluidos" ? time(b.closed_at) - time(a.closed_at) : time(a.due_at) - time(b.due_at),
    );
  const themes = services.filter((s) => requests.some((r) => r.service_id === s.id));
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
              className={`${tab === key ? "selected" : ""} ${key === "atrasados" && count ? "alert" : ""}`}
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
      <div className="queue-table" role="list">
        <div className="queue-row queue-header" aria-hidden="true">
          <span />
          <span>Chamado</span>
          <span>Colaborador</span>
          <span>Status</span>
          <span>Responsável</span>
          <span>Prazo</span>
          <span />
        </div>
        {rows.length === 0 ? (
          <div className="queue-empty">
            <Inbox size={30} />
            <strong>{requests.length ? "Nenhum chamado aqui" : "Nenhum chamado recebido ainda"}</strong>
            <span>{term || theme ? "Ajuste a busca ou o tema." : "Quando chegar um chamado, ele aparece nesta lista."}</span>
          </div>
        ) : (
          rows.map((r) => (
            <button
              key={r.id}
              role="listitem"
              className={`queue-row level-${open(r) ? r.sla?.level || "none" : "done"}`}
              onClick={() => onOpen(r.id)}
            >
              <span className="queue-stripe" />
              <span className="queue-cell-main">
                <small>{r.protocol}</small>
                <strong>{r.subject}</strong>
              </span>
              <span className="queue-cell-person">
                <strong>{displayName(r)}</strong>
                <span>
                  <Channel request={r} />
                  {r.department && r.department !== "Não informado" ? r.department : ""}
                </span>
              </span>
              <span>
                <span className={`pill pill-${r.status.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase()}`}>{r.status}</span>
              </span>
              <span className={r.assigned_name ? "queue-owner" : "queue-owner none"}>
                {r.assigned_name ? r.assigned_name.split(" ").slice(0, 2).join(" ") : "Ninguém"}
              </span>
              <span>
                <Deadline request={r} />
              </span>
              <ChevronRight size={18} className="queue-chevron" />
            </button>
          ))
        )}
      </div>
    </section>
  );
}
