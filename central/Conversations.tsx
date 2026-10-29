import React, { useEffect, useState } from "react";
import {
  MessagesSquare,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "./api";
import KnowledgeSync from "./KnowledgeSync";
import AiMetrics from "./AiMetrics";

type ConversationSummary = {
  id: string;
  kind: "chatbot" | "atendimento";
  session_id: string;
  candidate_name: string | null;
  candidate_identifier: string | null;
  started_at: string;
  updated_at: string;
  message_count: number;
  last_message: string;
};
type ConversationMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};
const formatDate = (date: string) =>
  new Date(date).toLocaleString("pt-BR", {
    timeZone: "America/Cuiaba",
    dateStyle: "short",
    timeStyle: "short",
  });

export default function Conversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    try {
      setError("");
      const result = await api<{ conversations: ConversationSummary[] }>(
        "/conversations",
      );
      setConversations(result.conversations);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    api<{ messages: ConversationMessage[] }>(
      `/conversations/${encodeURIComponent(selected)}`,
    )
      .then((r) => setMessages(r.messages))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [selected]);
  const current = conversations.find((c) => c.id === selected);
  return (
    <section className="conversations-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Central de Relacionamentos · RH</span>
          <h1>Histórico de conversas</h1>
          <p>
            Simulador do chatbot e atendimento real com dados da Senior, em um
            só lugar.
          </p>
        </div>
        <button className="button secondary" onClick={() => void load()}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </div>
      {error && <div className="notice">{error}</div>}
      <AiMetrics />
      <KnowledgeSync />
      <div className="conversations-grid">
        <div className="conversations-list">
          {conversations.length === 0 ? (
            <div className="empty-state">
              <MessagesSquare size={32} />
              <h3>Nenhuma conversa ainda</h3>
              <p>
                As conversas do simulador e do atendimento real aparecerão aqui.
              </p>
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                className={`conversation-row ${selected === c.id ? "selected" : ""}`}
                onClick={() => setSelected(c.id)}
              >
                <span className="avatar">
                  {(c.candidate_name || "?").slice(0, 1)}
                </span>
                <div className="conversation-row-main">
                  <h3>
                    {c.candidate_name || "Colaborador não identificado"}
                    <span
                      className={`conversation-tag ${c.kind === "atendimento" ? "conversation-tag-real" : ""}`}
                    >
                      {c.kind === "atendimento" ? "Dados reais" : "Simulador"}
                    </span>
                  </h3>
                  <p>{c.last_message}</p>
                  <small>
                    {c.message_count} mensagens · {formatDate(c.updated_at)}
                  </small>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="conversation-thread">
          {!selected ? (
            <div className="empty-state">
              <MessagesSquare size={32} />
              <h3>Selecione uma conversa</h3>
              <p>Escolha um item na lista para ver o histórico completo.</p>
            </div>
          ) : (
            <>
              <div className="conversation-thread-header">
                <span className="avatar">
                  <UserRound size={20} />
                </span>
                <div>
                  <strong>
                    {current?.candidate_name || "Colaborador não identificado"}
                  </strong>
                  <small>
                    {current?.candidate_identifier
                      ? `${current.candidate_identifier} · `
                      : ""}
                    {current?.kind === "atendimento"
                      ? "Atendimento com dados reais"
                      : "Simulador do chatbot"}
                  </small>
                </div>
              </div>
              {loading ? (
                <p className="conversation-loading">Carregando…</p>
              ) : (
                <div className="conversation-thread-scroll">
                  {messages.map((m) => (
                    <article
                      key={m.id}
                      className={`bot-message ${m.role === "assistant" ? "bot-message-bot" : "bot-message-user"}`}
                    >
                      {m.content}
                      <small>{formatDate(m.created_at)}</small>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="help-banner">
        <ShieldCheck size={28} />
        <div>
          <h3>Histórico apenas para a equipe de RH</h3>
          <p>
            As conversas ficam registradas para acompanhamento interno e não são
            compartilhadas fora da Central.
          </p>
        </div>
      </div>
    </section>
  );
}
