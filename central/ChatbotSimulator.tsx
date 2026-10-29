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
  text: "Olá! Sou o assistente de RH da Central de Relacionamentos Frizelo, em modo de teste com IA.\n\nEsta é uma simulação: use somente informações fictícias. Não informe CPF, senha ou dados reais.",
  options: { kind: "topics" },
};

function newSessionId() {
  return crypto.randomUUID();
}

export default function ChatbotSimulator() {
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
      const response = await fetch("/api/chatbot/message", {
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
            : `⚠ ${result.error || "Não consegui falar com o assistente agora."}`,
          options: response.ok ? result.options || null : null,
        },
        ...(result.ticket
          ? [
              {
                role: "bot" as const,
                text: `Protocolo fictício registrado: ${result.ticket.protocol}.\n\nVocê pode acompanhar no painel ao lado. Nenhum atendimento real foi aberto.`,
                options: { kind: "topics" } as Options,
              },
            ]
          : []),
      ]);
      if (Array.isArray(result.tickets)) setTickets(result.tickets);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "bot",
          text: "⚠ Não consegui falar com o assistente agora. Verifique a conexão e tente novamente.",
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
        <span className="bot-demo">
          <span /> Ambiente de demonstração
        </span>
      </header>
      <main className="bot-main">
        <section className="bot-intro">
          <div className="bot-eyebrow">
            FRIZELO · ATENDIMENTO AO COLABORADOR
          </div>
          <h1>
            Uma conversa.
            <br />
            <span>Mais facilidade no seu dia.</span>
          </h1>
          <p>
            Experimente o atendimento por IA antes de conectar o WhatsApp.
            Converse livremente, como faria em uma conversa real.
          </p>
          <div className="bot-safety">
            <ShieldCheck size={20} />
            <span>
              <strong>Somente dados fictícios.</strong> Não informe CPF, senha
              ou informações de funcionários. A conversa é apagada ao sair ou
              recarregar.
            </span>
          </div>
          <div className="bot-flow">
            <span>
              01 <b>Converse livremente</b>
            </span>
            <span>
              02 <b>A IA responde em tempo real</b>
            </span>
            <span>
              03 <b>Em breve: WhatsApp real</b>
            </span>
          </div>
          <aside className="bot-rh" aria-label="Protocolos desta sessão">
            <div className="bot-rh-title">
              <div>
                <small>PROTOCOLOS DESTA SESSÃO</small>
                <h2>Painel de teste</h2>
              </div>
              <span>{tickets.length}</span>
            </div>
            {tickets.length === 0 ? (
              <div className="bot-empty">
                <MessageCircle size={25} />
                <p>Nenhum protocolo fictício registrado ainda.</p>
                <small>
                  A IA registra um protocolo de teste quando você confirma uma
                  dúvida que precisa de acompanhamento. Respostas geradas por IA
                  (Hermes + Groq); nada chega à Central, ao RH ou à Senior.
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
              Ambiente de teste. Não utilize informações reais de colaboradores.
            </p>
          </aside>
        </section>
        <section className="bot-chat" aria-label="Simulador de conversa">
          <header className="bot-chat-header">
            <div className="bot-avatar">
              <Bot size={25} />
            </div>
            <div>
              <h2>Central Frizelo</h2>
              <p>
                <span /> Simulador · IA de teste · WhatsApp desconectado
              </p>
            </div>
            <button
              type="button"
              className="bot-reset"
              onClick={reset}
              aria-label="Reiniciar simulação"
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
            <div className="bot-chat-label">CONVERSA DE DEMONSTRAÇÃO</div>
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
                  Reiniciar conversa
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
            <label className="bot-sr-only" htmlFor="bot-input">
              Sua mensagem fictícia
            </label>
            <input
              id="bot-input"
              maxLength={1000}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Digite uma mensagem fictícia…"
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
            Conversa de texto livre · Respostas geradas por IA em teste
          </div>
        </section>
      </main>
    </div>
  );
}
