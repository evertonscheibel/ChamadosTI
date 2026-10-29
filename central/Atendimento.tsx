import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCheck,
  MessageCircle,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import "./chatbot.css";

type Options =
  | { kind: "topics" }
  | { kind: "yesno" }
  | { kind: "month"; choices: string[] }
  | { kind: "unknown" }
  | null;
type Message = { role: "bot" | "user"; text: string; options?: Options };
type Ticket = {
  protocol: string;
  subject: string;
  description: string;
  status: string;
};
const TOPIC_CHOICES = ["Holerite", "Espelho de ponto", "Férias", "Benefícios"];

const welcome: Message = {
  role: "bot",
  text: "Olá! Este é o atendimento de RH com dados reais, em teste. Para continuar, preciso confirmar sua identidade.\n\nQual é o seu CPF? (Se não souber, digite 'não sei'.)",
  options: { kind: "unknown" },
};

function newSessionId() {
  return crypto.randomUUID();
}

export default function Atendimento() {
  const [sessionId, setSessionId] = useState(newSessionId);
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = bottom.current?.parentElement;
    container?.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);
  async function send(text: string) {
    const value = text.trim();
    if (!value || sending) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", text: value }]);
    setSending(true);
    try {
      const response = await fetch("/api/atendimento/message", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, text: value }),
      });
      const result = await response.json();
      setMessages((current) => [
        ...current,
        {
          role: "bot",
          text: response.ok
            ? result.text
            : `⚠ ${result.error || "Não consegui concluir agora."}`,
          options: response.ok ? result.options || null : null,
        },
      ]);
      if (Array.isArray(result.tickets)) setTickets(result.tickets);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "bot",
          text: "⚠ Não consegui falar com o atendimento agora. Verifique a conexão e tente novamente.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }
  function reset() {
    setSessionId(newSessionId());
    setMessages([welcome]);
    setTickets([]);
    setInput("");
  }
  return (
    <div className="bot-app">
      <header className="bot-header">
        <a href="/" className="bot-back">
          <ArrowLeft size={17} /> Central de Relacionamentos
        </a>
        <span className="bot-demo bot-demo-real">
          <span /> Dados reais · em teste
        </span>
      </header>
      <main className="bot-main">
        <section className="bot-intro">
          <div className="bot-eyebrow">
            FRIZELO · ATENDIMENTO AO COLABORADOR
          </div>
          <h1>
            Atendimento real.
            <br />
            <span>Sem precisar logar na Central.</span>
          </h1>
          <p>
            Confirme sua identidade pelo chat e consulte holerite, espelho de
            ponto, férias e benefícios de verdade.
          </p>
          <div className="bot-safety">
            <ShieldCheck size={20} />
            <span>
              <strong>Ambiente de teste com dado real.</strong> Sua identidade é
              verificada por CPF/matrícula (ou por perguntas do seu cadastro)
              antes de qualquer consulta. A conversa é apagada ao sair ou
              recarregar.
            </span>
          </div>
          <div className="bot-flow">
            <span>
              01 <b>Confirme sua identidade</b>
            </span>
            <span>
              02 <b>Consulte seus dados reais</b>
            </span>
            <span>
              03 <b>Dúvidas viram chamado no RH</b>
            </span>
          </div>
          <aside className="bot-rh" aria-label="Chamados desta sessão">
            <div className="bot-rh-title">
              <div>
                <small>CHAMADOS DESTA SESSÃO</small>
                <h2>Painel de teste</h2>
              </div>
              <span>{tickets.length}</span>
            </div>
            {tickets.length === 0 ? (
              <div className="bot-empty">
                <MessageCircle size={25} />
                <p>Nenhum chamado registrado ainda.</p>
                <small>
                  Dúvidas confirmadas pelo assistente abrem um chamado de teste
                  aqui. O acompanhamento oficial continua em "Minhas
                  solicitações", para quem está logado na Central.
                </small>
              </div>
            ) : (
              <div className="bot-ticket-list">
                {tickets.map((ticket) => (
                  <article className="bot-ticket" key={ticket.protocol}>
                    <div className="bot-ticket-top">
                      <strong>{ticket.protocol}</strong>
                      <span>{ticket.status}</span>
                    </div>
                    <h3>{ticket.subject}</h3>
                    <p>{ticket.description}</p>
                  </article>
                ))}
              </div>
            )}
            <p className="bot-rh-foot">
              Ambiente de teste. Os dados consultados aqui são reais da Senior.
            </p>
          </aside>
        </section>
        <section className="bot-chat" aria-label="Atendimento com dados reais">
          <header className="bot-chat-header">
            <div className="bot-avatar">
              <Bot size={25} />
            </div>
            <div>
              <h2>Central Frizelo</h2>
              <p>
                <span /> Atendimento real · em teste
              </p>
            </div>
            <button
              type="button"
              className="bot-reset"
              onClick={reset}
              aria-label="Reiniciar atendimento"
              title="Reiniciar e apagar a conversa"
              disabled={sending}
            >
              <RotateCcw size={19} />
            </button>
          </header>
          <div
            className="bot-chat-scroll"
            role="log"
            aria-label="Mensagens da conversa"
            aria-live="polite"
          >
            <div className="bot-chat-label">ATENDIMENTO COM DADOS REAIS</div>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`bot-message bot-message-${message.role}`}
              >
                <span>{message.text}</span>
                <small>
                  {message.role === "bot" ? "Central Frizelo" : "Você"}{" "}
                  {message.role === "user" && <CheckCheck size={13} />}
                </small>
              </div>
            ))}
            {sending && (
              <div className="bot-message bot-message-bot">
                <span>Digitando…</span>
              </div>
            )}
            <div ref={bottom} />
          </div>
          {!sending &&
            messages.length > 0 &&
            messages[messages.length - 1].role === "bot" && (
              <div
                className="bot-options"
                role="group"
                aria-label="Opções rápidas"
              >
                {(() => {
                  const options = messages[messages.length - 1].options;
                  const choices = !options
                    ? []
                    : options.kind === "topics"
                      ? TOPIC_CHOICES
                      : options.kind === "yesno"
                        ? ["Sim", "Não"]
                        : options.kind === "month"
                          ? options.choices
                          : options.kind === "unknown"
                            ? ["Não sei"]
                            : [];
                  return choices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => send(choice)}
                    >
                      {choice}
                    </button>
                  ));
                })()}
                <button type="button" onClick={reset}>
                  Reiniciar atendimento
                </button>
              </div>
            )}
          <form
            className="bot-compose"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <label className="bot-sr-only" htmlFor="atendimento-input">
              Sua mensagem
            </label>
            <input
              id="atendimento-input"
              maxLength={500}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Digite sua resposta…"
              autoComplete="off"
              disabled={sending}
            />
            <button
              type="submit"
              aria-label="Enviar mensagem"
              disabled={!input.trim() || sending}
            >
              <Send size={19} />
            </button>
          </form>
          <div className="bot-chat-foot">
            Dado real da Senior, após verificação de identidade · Ambiente de
            teste
          </div>
        </section>
      </main>
    </div>
  );
}
