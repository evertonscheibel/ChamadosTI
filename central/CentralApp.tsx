import React, { useEffect, useState, useRef } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Search,
  ReceiptText,
  Sun,
  Clock3,
  HeartHandshake,
  FileText,
  UserRound,
  ShieldCheck,
  MessagesSquare,
  LogOut,
  ChevronRight,
  Plus,
  X,
  Paperclip,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Building2,
  Headphones,
  CircleHelp,
  Send,
  CheckCircle2,
} from "lucide-react";
import { services, statuses, faq } from "./catalog.mjs";
import "./central.css";
import { api } from "./api";
import SeniorDocuments from "./SeniorDocuments";
import SeniorExport from "./SeniorExport";
import SeniorSync from "./SeniorSync";
import Management from "./Management";
import { useTicketAlerts, AlertToasts, AlertSettings, WhatsappBanner, type WhatsappHealth } from "./TicketAlerts";
import RhQueue, { Channel, Deadline, displayName, type QueueTab } from "./RhQueue";

type User = {
  id: string;
  name: string;
  role: "colaborador" | "rh";
  unit: string;
  department: string;
};
type Service = (typeof services)[number];
type Request = {
  id: string;
  protocol: string;
  user_id: string;
  subject: string;
  description: string;
  service_id: string;
  fields: Record<string, string>;
  status: string;
  created_at: string;
  updated_at: string;
  requester_name: string;
  unit: string;
  department: string;
  assigned_name?: string;
  assigned_to?: string;
  priority: string;
  due_at?: string;
  closed_at?: string;
  sla?: { percent: number; level: "verde" | "amarelo" | "laranja" | "vermelho" } | null;
};
type Detail = {
  request: Request;
  messages: {
    id: string;
    body: string;
    author: string;
    role: string;
    created_at: string;
    internal: number;
  }[];
  history: {
    id: number;
    event: string;
    author: string;
    created_at: string;
    kind: string;
    internal: number;
    data: { from?: string | null; to?: string | null; attachments?: number };
  }[];
  attachments: { id: string; name: string; size: number; internal: number }[];
};
type Attachment = { name: string; type: string; data: string };
const icons = {
  receipt: ReceiptText,
  sun: Sun,
  clock: Clock3,
  heart: HeartHandshake,
  file: FileText,
  user: UserRound,
  shield: ShieldCheck,
  message: MessagesSquare,
};
const formatDate = (date: string) =>
  new Date(date).toLocaleString("pt-BR", {
    timeZone: "America/Cuiaba",
    dateStyle: "short",
    timeStyle: "short",
  });
const serviceFor = (id: string) => services.find((s) => s.id === id);
const maskCpf = (value: string) =>
  value
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <img
        className="brand-logo"
        src="/brand/frizelo-logo.png"
        alt="Frizelo Frigoríficos"
        width="148"
        height="80"
      />
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge status-${statuses.indexOf(status)}`}>
      <i />
      {status}
    </span>
  );
}
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="notice" role="alert">
      {children}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]",
        ) || [],
      );
    if (!dialog.current?.contains(document.activeElement))
      focusable()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={22} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Upload({
  files,
  setFiles,
}: {
  files: Attachment[];
  setFiles: (files: Attachment[]) => void;
}) {
  const [error, setError] = useState("");
  async function read(input: FileList | null) {
    setError("");
    if (!input) return;
    const selected = Array.from(input);
    if (
      selected.length > 3 ||
      selected.reduce((sum, f) => sum + f.size, 0) > 5 * 1024 * 1024
    ) {
      setError("Selecione até 3 arquivos, com no máximo 5 MB no total.");
      return;
    }
    if (
      selected.some(
        (f) => !["application/pdf", "image/jpeg", "image/png"].includes(f.type),
      )
    ) {
      setError("Use arquivos PDF, JPG ou PNG.");
      return;
    }
    try {
      const result = await Promise.all(
        selected.map(
          (file) =>
            new Promise<Attachment>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  name: file.name,
                  type: file.type,
                  data: String(reader.result).split(",")[1],
                });
              reader.onerror = () =>
                reject(new Error("Não foi possível ler o arquivo."));
              reader.readAsDataURL(file);
            }),
        ),
      );
      setFiles(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="upload-area">
      <label className="upload-label">
        <Paperclip size={18} />
        <span>
          <strong>Adicionar documentos</strong>
          <small>PDF, JPG ou PNG · até 3 arquivos · 5 MB no total</small>
        </span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          multiple
          onChange={(e) => void read(e.target.files)}
        />
      </label>
      {files.map((f) => (
        <span className="file-chip" key={f.name}>
          {f.name}
          <button
            type="button"
            aria-label={`Remover ${f.name}`}
            onClick={() => setFiles(files.filter((item) => item !== f))}
          >
            <X size={14} />
          </button>
        </span>
      ))}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}

function NewRequest({
  service,
  onClose,
  onCreated,
}: {
  service: Service;
  onClose: () => void;
  onCreated: (request: Request) => void;
}) {
  const [subject, setSubject] = useState(service.title);
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ request: Request }>("/requests", "POST", {
        service_id: service.id,
        subject,
        description,
        fields,
        attachments: files,
      });
      onCreated(result.request);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Nova solicitação" onClose={busy ? () => {} : onClose}>
      <div className="form-service">
        <span className="eyebrow">{service.group}</span>
        <h3>{service.title}</h3>
        <p>{service.hint}</p>
      </div>
      <form onSubmit={submit} className="request-form">
        <label>
          Assunto
          <input
            autoFocus
            required
            maxLength={160}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        {service.fields.map((field) => (
          <label key={field}>
            {field}
            <input
              required
              maxLength={200}
              placeholder={
                field === "Mês de referência"
                  ? "Ex.: setembro de 2026"
                  : undefined
              }
              value={fields[field] || ""}
              onChange={(e) =>
                setFields({ ...fields, [field]: e.target.value })
              }
            />
          </label>
        ))}
        <label>
          Como podemos ajudar?
          <textarea
            required
            maxLength={10000}
            rows={5}
            placeholder="Conte ao RH o que você precisa…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <Upload files={files} setFiles={setFiles} />
        <p className="form-note">
          <ShieldCheck size={16} />
          Sua solicitação será acessível a você e à equipe de RH.
        </p>
        {error && <Notice>{error}</Notice>}
        <div className="form-actions">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button className="button primary" disabled={busy} type="submit">
            {busy ? "Enviando…" : "Enviar solicitação"}
            <Send size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RequestDetail({
  id,
  user,
  onBack,
  onUpdated,
}: {
  id: string;
  user: User;
  onBack: () => void;
  onUpdated: () => void;
}) {
  const rh = user.role === "rh";
  const [internal, setInternal] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  async function load() {
    try {
      setDetail(await api<Detail>(`/requests/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    // Mensagens novas do WhatsApp aparecem sem recarregar a página.
    const timer = window.setInterval(() => void load(), 20000);
    if (rh)
      api<{ team: typeof team }>("/team")
        .then((r) => setTeam(r.team))
        .catch(() => {});
    return () => window.clearInterval(timer);
  }, [id]);
  const messageCount = detail?.messages.length || 0;
  useEffect(() => {
    // Rola só a caixa da conversa (não a página) até a mensagem mais recente.
    requestAnimationFrame(() => {
      if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    });
  }, [messageCount]);
  async function update(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api(`/requests/${id}`, "PATCH", input);
      await load();
      onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!message.trim() || busy || !detail) return;
    setBusy(true);
    setError("");
    setWarning("");
    try {
      const result = await api<{ warning?: string }>(`/requests/${id}/messages`, "POST", {
        body: message,
        attachments: files,
        internal: rh && internal,
      });
      if (result?.warning) setWarning(result.warning);
      setMessage("");
      setFiles([]);
      // Responder ao colaborador já assume o chamado: um clique a menos para o RH.
      const r = detail.request;
      if (rh && !internal && (!r.assigned_to || r.status === "Recebida"))
        await api(`/requests/${id}`, "PATCH", {
          ...(r.assigned_to ? {} : { assign: true }),
          ...(r.status === "Recebida" ? { status: "Em atendimento" } : {}),
        });
      await load();
      onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!detail)
    return (
      <div className="ticket">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={16} />
          Chamados
        </button>
        {error ? <Notice>{error}</Notice> : <p className="muted">Carregando chamado…</p>}
      </div>
    );
  const request = detail.request;
  const closed = request.status === "Concluída";
  const whatsapp = request.fields?.Origem === "WhatsApp";
  const answered = detail.messages.some((m) => m.role === "rh" && !m.internal);
  const fields = Object.entries(request.fields).filter(([key]) => key !== "Origem");
  // No WhatsApp a primeira mensagem já é a descrição: não repetir o texto.
  const repeated = detail.messages[0]?.body.trim() === request.description.trim();
  const conclude = () => {
    if (
      window.confirm(
        whatsapp
          ? "Concluir o chamado? O colaborador recebe pelo WhatsApp o aviso de que foi atendido."
          : "Concluir o chamado?",
      )
    )
      void update({ status: "Concluída" });
  };
  return (
    <div className="ticket">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} />
        {rh ? "Chamados" : "Minhas solicitações"}
      </button>
      <header className="ticket-head">
        <div className="ticket-title">
          <span className="ticket-protocol">
            {request.protocol}
            <Channel request={request} />
          </span>
          <h1>{request.subject}</h1>
          <p>
            {serviceFor(request.service_id)?.title} · aberto em {formatDate(request.created_at)}
          </p>
        </div>
        <div className="ticket-actions">
          {rh && !closed ? (
            <>
              {request.assigned_to !== user.id && (
                <button className="button secondary" disabled={busy} onClick={() => void update({ assign: true, ...(request.status === "Recebida" ? { status: "Em atendimento" } : {}) })}>
                  <Headphones size={16} />
                  Assumir
                </button>
              )}
              <select
                aria-label="Status do chamado"
                disabled={busy}
                value={request.status}
                onChange={(e) => void update({ status: e.target.value })}
              >
                {statuses
                  .filter((s) => s !== "Concluída")
                  .map((s) => (
                    <option key={s}>{s}</option>
                  ))}
              </select>
              <button
                className="button primary"
                disabled={busy || !answered}
                title={answered ? "" : "Responda ao colaborador antes de concluir."}
                onClick={conclude}
              >
                <CheckCircle2 size={16} />
                Concluir
              </button>
            </>
          ) : rh ? (
            <>
              <Badge status={request.status} />
              <button className="button secondary" disabled={busy} onClick={() => void update({ status: "Em atendimento" })}>
                Reabrir
              </button>
            </>
          ) : (
            <Badge status={request.status} />
          )}
        </div>
      </header>
      {error && <Notice>{error}</Notice>}
      {warning && <Notice>{warning}</Notice>}
      <div className="ticket-grid">
        <section className="ticket-thread" aria-label="Conversa">
          <div className="thread-messages" ref={thread}>
          {(!repeated || fields.length > 0) && (
          <article className="bubble bubble-them bubble-opening">
            <header>
              <strong>{repeated ? "Dados do chamado" : displayName(request)}</strong>
              <small>Abertura · {formatDate(request.created_at)}</small>
            </header>
            {!repeated && <p className="preserve-lines">{request.description}</p>}
            {fields.length > 0 && (
              <dl className="bubble-fields">
                {fields.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </article>
          )}
          {detail.messages.map((m) => (
            <article
              key={m.id}
              className={`bubble ${m.internal ? "bubble-note" : m.role === "rh" ? "bubble-us" : "bubble-them"}`}
            >
              <header>
                <strong>
                  {m.internal ? <ShieldCheck size={13} /> : null}
                  {m.role === "rh" ? m.author : displayName(request)}
                  {m.internal ? " · nota interna" : ""}
                </strong>
                <small>{formatDate(m.created_at)}</small>
              </header>
              <p className="preserve-lines">{m.body}</p>
            </article>
          ))}
          </div>
          {closed ? (
            <div className="thread-closed">
              <CheckCircle2 size={18} />
              {rh
                ? `Chamado concluído em ${request.closed_at ? formatDate(request.closed_at) : "—"}.`
                : "Atendimento concluído. Se precisar de outra ajuda, abra uma nova solicitação."}
            </div>
          ) : (
            <form onSubmit={send} className={`composer ${internal ? "composer-note" : ""}`}>
              {rh && (
                <div className="composer-mode" role="tablist">
                  <button type="button" role="tab" aria-selected={!internal} className={!internal ? "selected" : ""} onClick={() => setInternal(false)}>
                    Responder
                  </button>
                  <button type="button" role="tab" aria-selected={internal} className={internal ? "selected" : ""} onClick={() => setInternal(true)}>
                    Nota interna
                  </button>
                  <span>
                    {internal
                      ? "Só o RH vê esta nota."
                      : whatsapp
                        ? "Vai para o WhatsApp do colaborador."
                        : "O colaborador vê no portal."}
                  </span>
                </div>
              )}
              <textarea
                aria-label={rh ? (internal ? "Nota interna" : "Resposta ao colaborador") : "Mensagem ao RH"}
                required
                rows={3}
                maxLength={10000}
                placeholder={internal ? "Anotação para a equipe…" : "Escreva a resposta…  (Ctrl+Enter envia)"}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
                }}
              />
              <div className="composer-foot">
                <Upload files={files} setFiles={setFiles} />
                <button className="button primary" disabled={busy || !message.trim()}>
                  {busy ? "Enviando…" : internal ? "Salvar nota" : "Enviar"}
                  <Send size={15} />
                </button>
              </div>
            </form>
          )}
        </section>
        <aside className="ticket-side">
          <section className="side-card">
            <div className="person">
              <span className="avatar">{/^\p{L}/u.test(displayName(request)) ? displayName(request)[0] : <UserRound size={18} />}</span>
              <div>
                <strong>{displayName(request)}</strong>
                <small>
                  {[request.department, request.unit].filter((v) => v && v !== "Não informado").join(" · ") || "Setor não informado"}
                </small>
              </div>
            </div>
          </section>
          <section className="side-card">
            <h2>Prazo</h2>
            {closed ? (
              <p className="side-value">Concluído em {request.closed_at ? formatDate(request.closed_at) : "—"}</p>
            ) : (
              <>
                <Deadline request={request} />
                <p className="side-sub">{request.due_at ? `Vence ${formatDate(request.due_at)} · 48h úteis` : "Sem prazo definido"}</p>
              </>
            )}
          </section>
          <section className="side-card">
            <h2>Responsável</h2>
            {rh ? (
              <select
                aria-label="Responsável"
                disabled={busy || closed}
                value={request.assigned_to || ""}
                onChange={(e) => void update({ assigned_to: e.target.value || null })}
              >
                <option value="">Ninguém</option>
                {team.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="side-value">{request.assigned_name || "Aguardando o RH"}</p>
            )}
          </section>
          {detail.attachments.length > 0 && (
            <section className="side-card">
              <h2>Anexos</h2>
              {detail.attachments.map((f) => (
                <a key={f.id} href={`/api/attachments/${f.id}`} className="side-file">
                  <Paperclip size={14} />
                  <span>{f.name}</span>
                  <small>
                    {f.internal ? "interno · " : ""}
                    {Math.ceil(f.size / 1024)} KB
                  </small>
                </a>
              ))}
            </section>
          )}
          <details className="side-card side-history">
            <summary>
              <h2>Histórico</h2>
              <small>{detail.history.length} eventos</small>
            </summary>
            <ol>
              {detail.history.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.event}
                    {item.internal === 1 ? " · interno" : ""}
                  </strong>
                  <small>
                    {item.author} · {formatDate(item.created_at)}
                  </small>
                </li>
              ))}
            </ol>
          </details>
        </aside>
      </div>
    </div>
  );
}

function Help() {
  return (
    <div className="help-page">
      <span className="eyebrow">Estamos aqui para ajudar</span>
      <h1>Dúvidas frequentes</h1>
      <p>Orientações para usar a Central de Relacionamentos.</p>
      <div className="faq-list">
        {faq.map(([q, a]) => (
          <details key={q}>
            <summary>
              {q}
              <Plus size={18} />
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
      <div className="help-banner">
        <MessagesSquare size={28} />
        <div>
          <h3>Seu assunto não está na lista?</h3>
          <p>Use o serviço “Fale com o RH” para registrar sua solicitação.</p>
        </div>
      </div>
    </div>
  );
}

function Activate({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [cpf, setCpf] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmation) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/activate", "POST", { identifier: cpf, code, password });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Criar ou recuperar seu acesso"
      onClose={busy ? () => {} : onClose}
    >
      <div className="form-service">
        <p>
          Solicite seu código de acesso ao RH da sua unidade. Com ele, você
          poderá definir sua senha. O código é pessoal e vale por 24 horas.
        </p>
      </div>
      <form className="request-form" onSubmit={submit}>
        <label>
          CPF
          <input
            required
            inputMode="numeric"
            autoComplete="username"
            value={cpf}
            onChange={(e) => setCpf(maskCpf(e.target.value))}
            placeholder="000.000.000-00"
          />
        </label>
        <label>
          Código recebido do RH
          <input
            required
            maxLength={64}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Nova senha
          <input
            required
            type="password"
            minLength={10}
            maxLength={256}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Pelo menos 10 caracteres"
          />
        </label>
        <label>
          Confirmar senha
          <input
            required
            type="password"
            minLength={10}
            maxLength={256}
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        {error && <Notice>{error}</Notice>}
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar minha senha"}
            <Check size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Employees() {
  const [users, setUsers] = useState<
    {
      id: string;
      name: string;
      cpf_masked: string;
      unit: string;
      department: string;
    }[]
  >([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<{ code: string; name: string } | null>(
    null,
  );
  async function load() {
    try {
      setUsers((await api<{ users: typeof users }>("/users")).users);
      setPage(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function renew(id: string) {
    setBusy(true);
    setError("");
    try {
      setAccess(await api(`/users/${id}/access-code`, "POST", {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = users.filter((user) =>
    `${user.name} ${user.unit} ${user.department} ${user.cpf_masked}`
      .toLocaleLowerCase("pt-BR")
      .includes(query.toLocaleLowerCase("pt-BR")),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Cadastro Senior · RH</span>
          <h1>Colaboradores ativos</h1>
          <p>
            Cadastros identificados pelo CPF da Senior. {users.length}{" "}
            colaboradores disponíveis.
          </p>
        </div>
        <button className="button secondary" onClick={() => void load()}>
          <RefreshCw size={16} />
          Atualizar lista
        </button>
      </div>
      <SeniorSync onSynced={() => void load()} />
      {error && <Notice>{error}</Notice>}
      <div className="search-box employee-search">
        <Search size={17} />
        <input
          placeholder="Buscar nome, filial ou CPF exibido…"
          aria-label="Buscar colaborador"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </div>
      <div className="requests-list">
        {filtered.slice(page * 50, (page + 1) * 50).map((user) => (
          <div className="request-row employee-row" key={user.id}>
            <span className="avatar">{user.name[0]}</span>
            <div className="request-row-main">
              <h3>{user.name}</h3>
              <p>
                {user.cpf_masked} · {user.unit}
                {user.department !== "Não informado"
                  ? ` · ${user.department}`
                  : ""}
              </p>
            </div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void renew(user.id)}
            >
              Gerar código de acesso
              <ArrowRight size={15} />
            </button>
          </div>
        ))}
        {!filtered.length && (
          <div className="empty-state">
            <p>
              {users.length
                ? "Nenhum colaborador encontrado."
                : "Sincronize os ativos da Senior para carregar os colaboradores."}
            </p>
          </div>
        )}
      </div>
      {pages > 1 && (
        <div className="form-actions">
          <button
            className="button secondary"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page + 1} de {pages}
          </span>
          <button
            className="button secondary"
            disabled={page + 1 >= pages}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
      <div className="help-banner">
        <ShieldCheck size={28} />
        <div>
          <h3>Primeiro acesso com validação de identidade</h3>
          <p>
            Gere o código e entregue ao próprio colaborador por um canal
            validado pelo RH. A sincronização não cria uma senha padrão.
          </p>
        </div>
      </div>
      <details>
        <summary>Exportação do histórico cadastral</summary>
        <SeniorExport />
      </details>
      {access && (
        <Modal title="Código de acesso gerado" onClose={() => setAccess(null)}>
          <div className="info-content">
            <p>
              Código pessoal para <strong>{access.name}</strong>. Entregue ao
              colaborador após confirmar a identidade.
            </p>
            <div className="protocol">
              <small>Válido por 24 horas · uso único</small>
              <code className="access-code">{access.code}</code>
            </div>
            <p>
              O colaborador deve abrir “Veja como acessar”, informar CPF e
              código e escolher a senha.
            </p>
            <button className="button primary" onClick={() => setAccess(null)}>
              Concluir
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export default function CentralApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<
    "home" | "requests" | "help" | "users" | "documents"
  >("home");
  const [requests, setRequests] = useState<Request[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState<Service | null>(null);
  const [pending, setPending] = useState<Service | null>(null);
  const [activated, setActivated] = useState(false);
  const [info, setInfo] = useState<"access" | "password" | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Todas");
  const [category, setCategory] = useState("Todos os serviços");
  const [queue, setQueue] = useState<QueueTab>("abertos");
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<Request | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  // Só compara depois da primeira carga real da fila (antes dela a lista está vazia).
  const ticketAlerts = useTicketAlerts(requests, user?.role === "rh" && syncedAt !== null);
  const [whatsappHealth, setWhatsappHealth] = useState<WhatsappHealth | null>(null);
  async function refresh() {
    try {
      const result = await api<{ requests: Request[] }>("/requests");
      setRequests(result.requests);
      setSyncedAt(new Date());
      if (user?.role === "rh")
        api<WhatsappHealth>("/whatsapp/status")
          .then(setWhatsappHealth)
          .catch(() => setWhatsappHealth(null));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    api<{ user: User }>("/me")
      .then((r) => {
        setUser(r.user);
        if (r.user.role === "rh") setView("requests");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    const expire = () => {
      setUser(null);
      setRequests([]);
      setActive(null);
      setSyncedAt(null);
      setError("Sua sessão terminou. Entre novamente.");
    };
    window.addEventListener("frizelo-session-expired", expire);
    return () => window.removeEventListener("frizelo-session-expired", expire);
  }, []);
  useEffect(() => {
    if (user) {
      void refresh();
      // RH: fila a cada 20s para os avisos de chamado novo/crítico saírem rápido.
      const timer = window.setInterval(() => void refresh(), user.role === "rh" ? 20000 : 30000);
      return () => window.clearInterval(timer);
    }
  }, [user?.id]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User }>("/login", "POST", {
        identifier: cpf,
        password,
      });
      setUser(result.user);
      setPassword("");
      setView(result.user.role === "rh" ? "requests" : "home");
      setActive(null);
      setQueue("abertos");
      setFilter("Todas");
      setCategory("Todos os serviços");
      setSearch("");
      if (pending && result.user.role === "colaborador") {
        setSelected(pending);
        setPending(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/logout", "POST", {});
      setUser(null);
      setRequests([]);
      setSyncedAt(null);
      setActive(null);
      setView("home");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(
    next:
      "home" | "requests" | "help" | "users" | "documents",
  ) {
    setView(next);
    setActive(null);
    setSearch("");
    setError("");
  }
  function choose(service: Service) {
    if (user?.role === "colaborador") setSelected(service);
    else {
      setPending(service);
      document.getElementById("cpf")?.focus();
      document
        .getElementById("access")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  const visibleServices = services.filter((s) =>
    `${s.title} ${s.description} ${s.group}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const visibleRequests = requests
    .filter(
      (r) =>
        (filter === "Todas" || r.status === filter) &&
        (category === "Todos os serviços" || r.service_id === category) &&
        `${r.protocol} ${r.subject}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const openCount = requests.filter((r) => r.status !== "Concluída").length;
  if (loading)
    return (
      <div className="loading-screen">
        <Brand />
        <p>Preparando sua Central de Relacionamentos…</p>
      </div>
    );
  return (
    <div className="central">
      <AlertToasts
        alerts={ticketAlerts.alerts}
        dismiss={ticketAlerts.dismiss}
        onOpen={(id) => {
          setView("requests");
          setActive(id);
        }}
      />
      <div className="topline">
        <span>Um canal para cuidar de quem faz a Frizelo.</span>
        <span>
          <ShieldCheck size={13} />
          Ambiente de homologação
        </span>
      </div>
      <header className="site-header">
        <div className="shell header-inner">
          <button
            className="brand-button"
            onClick={() => navigate("home")}
            aria-label="Página inicial"
          >
            <Brand />
          </button>
          <div className="header-label">
            Central de
            <br />
            <strong>Relacionamentos</strong>
          </div>
          <nav aria-label="Navegação principal">
            {user?.role === "rh" ? (
              <>
                <button
                  className={view === "requests" || active ? "nav-active" : ""}
                  onClick={() => navigate("requests")}
                >
                  Chamados
                  {openCount > 0 && <span className="nav-count">{openCount}</span>}
                </button>
                <button
                  className={view === "home" && !active ? "nav-active" : ""}
                  onClick={() => navigate("home")}
                >
                  Indicadores
                </button>
                <button
                  className={view === "users" ? "nav-active" : ""}
                  onClick={() => navigate("users")}
                >
                  Colaboradores
                </button>
              </>
            ) : (
              <>
                <button
                  className={view === "home" && !active ? "nav-active" : ""}
                  onClick={() => navigate("home")}
                >
                  Início
                </button>
                {user && (
                  <button
                    className={view === "requests" || active ? "nav-active" : ""}
                    onClick={() => navigate("requests")}
                  >
                    Minhas solicitações
                  </button>
                )}
                {user && (
                  <button
                    className={view === "documents" ? "nav-active" : ""}
                    onClick={() => navigate("documents")}
                  >
                    Consultas
                  </button>
                )}
                {!user && (
                  <button
                    className={view === "help" ? "nav-active" : ""}
                    onClick={() => navigate("help")}
                  >
                    Ajuda
                  </button>
                )}
              </>
            )}
          </nav>
          {user ? (
            <div className="header-user">
              <span className="avatar">{user.name[0]}</span>
              <div>
                <strong>{user.name.split(" ")[0]}</strong>
                <small>
                  {user.role === "rh" ? "Equipe de RH" : "Colaborador"}
                </small>
              </div>
              <button
                className="icon-button"
                title="Sair"
                aria-label="Sair"
                disabled={busy}
                onClick={() => void logout()}
              >
                <LogOut size={19} />
              </button>
            </div>
          ) : (
            <button
              className="button header-access"
              onClick={() => {
                navigate("home");
                requestAnimationFrame(() =>
                  document
                    .getElementById("access")
                    ?.scrollIntoView({ behavior: "smooth" }),
                );
              }}
            >
              Acessar meu portal
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </header>
      <main className="shell main-shell">
        {active && user ? (
          <RequestDetail
            key={active}
            id={active}
            user={user}
            onBack={() => {
              setActive(null);
              setView("requests");
            }}
            onUpdated={() => void refresh()}
          />
        ) : view === "documents" && user ? (
          <SeniorDocuments />
        ) : view === "users" && user?.role === "rh" ? (
          <Employees />
        ) : view === "help" ? (
          <Help />
        ) : view === "requests" && user?.role === "rh" ? (
          <RhQueue
            requests={requests}
            userId={user.id}
            tab={queue}
            setTab={setQueue}
            onOpen={setActive}
            onRefresh={() => void refresh()}
            syncedAt={syncedAt}
            error={error}
            tools={<AlertSettings sound={ticketAlerts.sound} toggleSound={ticketAlerts.toggleSound} />}
            banner={<WhatsappBanner health={whatsappHealth} />}
          />
        ) : view === "requests" && user ? (
          <section className="requests-page">
            <div className="page-heading">
              <div>
                <span className="eyebrow">Seu atendimento, do início ao fim</span>
                <h1>Minhas solicitações</h1>
                <p>Acompanhe os protocolos e converse com o RH.</p>
              </div>
              <button
                className="button secondary"
                onClick={() => void refresh()}
              >
                <RefreshCw size={16} />
                Atualizar
              </button>
            </div>
            {error && <Notice>{error}</Notice>}
            <div className="request-filters">
              <div className="search-box">
                <Search size={18} />
                <input
                  aria-label="Buscar solicitação"
                  placeholder="Buscar por protocolo ou assunto…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                aria-label="Filtrar por status"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option>Todas</option>
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <select
                aria-label="Filtrar por serviço"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option>Todos os serviços</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="requests-list">
              {visibleRequests.length === 0 ? (
                <div className="empty-state">
                  <MessagesSquare size={36} />
                  <h3>
                    {requests.length
                      ? "Nenhuma solicitação com esses filtros"
                      : "Tudo pronto para começar"}
                  </h3>
                  <p>Escolha um serviço para abrir sua primeira solicitação.</p>
                  <button
                    className="button primary"
                    onClick={() => navigate("home")}
                  >
                    Ver serviços
                    <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                visibleRequests.map((r) => (
                  <button
                    className="request-row"
                    key={r.id}
                    onClick={() => setActive(r.id)}
                  >
                    <span className="request-row-icon">
                      <FileText size={22} />
                    </span>
                    <div className="request-row-main">
                      <small>
                        {r.protocol} · {serviceFor(r.service_id)?.title}
                      </small>
                      <h3>{r.subject}</h3>
                      <p>{formatDate(r.created_at)}</p>
                    </div>
                    <div className="row-status">
                      <Badge status={r.status} />
                    </div>
                    <ChevronRight size={20} />
                  </button>
                ))
              )}
            </div>
          </section>
        ) : user?.role === "rh" ? (
          <section className="indicators-page">
            {error && <Notice>{error}</Notice>}
            <Management
              onQueue={(tab) => {
                setQueue(tab as QueueTab);
                navigate("requests");
              }}
            />
          </section>
        ) : (
          <>
            <section className={`hero ${user ? "hero-signed" : ""}`}>
              <div className="hero-copy">
                <span className="eyebrow">
                  <span className="live-dot" />
                  Portal do colaborador
                </span>
                <h1>
                  {user ? (
                    <>
                      Olá, {user.name.split(" ")[0]}.<br />
                      Como podemos ajudar?
                    </>
                  ) : (
                    <>
                      Mais perto de você.
                      <br />
                      <em>Mais simples para todos.</em>
                    </>
                  )}
                </h1>
                <p>
                  {user
                    ? "Escolha um serviço, acompanhe suas solicitações e fale com o RH em um só lugar."
                    : "Sua conexão com o RH da Frizelo. Solicite documentos, tire dúvidas e acompanhe seu atendimento sem precisar ir até o balcão."}
                </p>
                <div className="hero-points">
                  <span>
                    <CheckCircle2 size={17} />
                    Solicite com facilidade
                  </span>
                  <span>
                    <Clock3 size={17} />
                    Acompanhe cada etapa
                  </span>
                  <span>
                    <ShieldCheck size={17} />
                    Atendimento individual
                  </span>
                </div>
                {!user && (
                  <a className="text-button" href="#services">
                    Conheça os serviços
                    <ArrowRight size={18} />
                  </a>
                )}
              </div>
              {user ? (
                <div className="welcome-card">
                  <div className="welcome-icon">
                    <MessagesSquare size={29} />
                  </div>
                  <span className="eyebrow">Seu RH, a um clique</span>
                  <h2>Vamos acompanhar?</h2>
                  <p>
                    Você tem{" "}
                    <strong>
                      {openCount}{" "}
                      {openCount === 1
                        ? "solicitação em aberto"
                        : "solicitações em aberto"}
                    </strong>
                    .
                  </p>
                  <button
                    className="button primary"
                    onClick={() => {
                      setFilter("Todas");
                      navigate("requests");
                    }}
                  >
                    Minhas solicitações
                    <ArrowRight size={17} />
                  </button>
                  <small>
                    {user.unit} · {user.department}
                  </small>
                </div>
              ) : (
                <section className="login-card" id="access">
                  <div className="login-heading">
                    <span className="login-icon">
                      <UserRound size={23} />
                    </span>
                    <div>
                      <h2>Acesse seu portal</h2>
                      <p>Bem-vindo à sua Central de Relacionamentos.</p>
                    </div>
                  </div>
                  {activated && (
                    <div className="pending-service">
                      Senha definida. Entre com seu CPF e a nova senha.
                    </div>
                  )}
                  {pending && (
                    <div className="pending-service">
                      Entre para solicitar: <strong>{pending.title}</strong>
                    </div>
                  )}
                  <form onSubmit={login}>
                    <label htmlFor="cpf">
                      CPF
                      <input
                        id="cpf"
                        inputMode="numeric"
                        autoComplete="username"
                        required
                        pattern="\d{3}\.\d{3}\.\d{3}-\d{2}"
                        placeholder="000.000.000-00"
                        value={cpf}
                        onChange={(e) => setCpf(maskCpf(e.target.value))}
                      />
                    </label>
                    <label htmlFor="password">
                      Senha
                      <div className="password-field">
                        <input
                          id="password"
                          autoComplete="current-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Digite sua senha"
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          aria-label={
                            showPassword ? "Ocultar senha" : "Mostrar senha"
                          }
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff size={18} />
                          ) : (
                            <Eye size={18} />
                          )}
                        </button>
                      </div>
                    </label>
                    <button
                      className="forgot"
                      type="button"
                      onClick={() => setInfo("password")}
                    >
                      Esqueci minha senha
                    </button>
                    {error && <Notice>{error}</Notice>}
                    <button
                      className="button primary login-submit"
                      disabled={busy}
                    >
                      {busy ? "Entrando…" : "Entrar"}
                      <ArrowRight size={17} />
                    </button>
                  </form>
                  <div className="first-access">
                    É seu primeiro acesso?
                    <button onClick={() => setInfo("access")}>
                      Veja como acessar
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </section>
              )}
            </section>
            <section className="quick-strip">
              <div>
                <span className="quick-icon">
                  <Headphones size={25} />
                </span>
                <div>
                  <strong>O RH está com você</strong>
                  <p>Um canal para suas necessidades do dia a dia.</p>
                </div>
              </div>
              <button onClick={() => choose(services[0])}>
                <ReceiptText size={20} />
                <span>Solicitar holerite</span>
                <ArrowRight size={17} />
              </button>
              <button
                onClick={() =>
                  user
                    ? (setFilter("Todas"), navigate("requests"))
                    : document.getElementById("cpf")?.focus()
                }
              >
                <MessagesSquare size={20} />
                <span>Acompanhar solicitação</span>
                <ArrowRight size={17} />
              </button>
            </section>
            <section id="services" className="services-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Serviços do RH</span>
                  <h2>O que você precisa hoje?</h2>
                  <p>Escolha o assunto. A gente ajuda com o próximo passo.</p>
                </div>
                <div className="search-box">
                  <Search size={18} />
                  <input
                    aria-label="Buscar serviço"
                    placeholder="Busque um serviço…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="service-grid">
                {visibleServices.map((service, index) => {
                  const Icon = icons[service.icon as keyof typeof icons];
                  return (
                    <button
                      className="service-card"
                      key={service.id}
                      onClick={() => choose(service)}
                    >
                      <div className="service-card-top">
                        <span className={`service-icon icon-${index % 4}`}>
                          <Icon size={24} />
                        </span>
                        <ArrowRight size={19} className="card-arrow" />
                      </div>
                      <h3>{service.title}</h3>
                      <p>{service.description}</p>
                      <small>{service.group}</small>
                    </button>
                  );
                })}
              </div>
              {!visibleServices.length && (
                <div className="empty-state">
                  <Search size={30} />
                  <h3>Nenhum serviço encontrado</h3>
                  <p>Tente outro termo ou use “Fale com o RH”.</p>
                  <button
                    className="button secondary"
                    onClick={() => choose(services[7])}
                  >
                    Fale com o RH
                  </button>
                </div>
              )}
            </section>
            <section className="how-section">
              <div>
                <span className="eyebrow">Simples, do começo ao fim</span>
                <h2>
                  Menos deslocamento.
                  <br />
                  Mais acompanhamento.
                </h2>
                <p>
                  Seu pedido fica registrado e você acompanha tudo pelo portal.
                </p>
              </div>
              <ol>
                <li>
                  <span>01</span>
                  <div>
                    <h3>Escolha o serviço</h3>
                    <p>Encontre o assunto que você precisa tratar com o RH.</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <h3>Conte o que precisa</h3>
                    <p>
                      Preencha os detalhes e anexe documentos, se necessário.
                    </p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <h3>Acompanhe pelo protocolo</h3>
                    <p>Veja as respostas e converse com a equipe no portal.</p>
                  </div>
                </li>
              </ol>
            </section>
            <section className="help-banner">
              <CircleHelp size={30} />
              <div>
                <h3>Precisa de uma orientação?</h3>
                <p>
                  Veja como acessar o portal, enviar documentos e acompanhar seu
                  pedido.
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => navigate("help")}
              >
                Dúvidas frequentes
                <ArrowRight size={16} />
              </button>
            </section>
          </>
        )}
      </main>
      <footer className="site-footer">
        <div className="shell">
          <Brand />
          <p>
            Central de Relacionamentos
            <br />
            <span>Conectando pessoas. Cuidando de cada atendimento.</span>
          </p>
          <button className="text-button" onClick={() => navigate("help")}>
            Ajuda
          </button>
          <small>
            Frizelo Frigoríficos · {new Date().getFullYear()}
            <br />
            Homologação local
          </small>
        </div>
      </footer>
      {selected && (
        <NewRequest
          service={selected}
          onClose={() => setSelected(null)}
          onCreated={(request) => {
            setSelected(null);
            setSuccess(request);
            void refresh();
          }}
        />
      )}
      {success && (
        <Modal title="Solicitação recebida" onClose={() => setSuccess(null)}>
          <div className="success-content">
            <span className="success-icon">
              <Check size={34} />
            </span>
            <h3>Pronto! Seu pedido foi registrado.</h3>
            <p>
              Guarde o protocolo e acompanhe as respostas do RH pelo portal.
            </p>
            <div className="protocol">
              <small>Seu protocolo</small>
              <strong>{success.protocol}</strong>
            </div>
            <button
              className="button primary"
              onClick={() => {
                setActive(success.id);
                setSuccess(null);
              }}
            >
              Acompanhar solicitação
              <ArrowRight size={17} />
            </button>
          </div>
        </Modal>
      )}
      {info && (
        <Activate
          onClose={() => setInfo(null)}
          onDone={() => {
            setInfo(null);
            setActivated(true);
            setPassword("");
          }}
        />
      )}
    </div>
  );
}
