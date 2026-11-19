import React, { useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  BellRing,
  X,
  Inbox,
  WifiOff,
  ArrowRightLeft,
} from "lucide-react";
import { MessageSquareText } from "lucide-react";
import { displayName, type QueueRequest } from "./RhQueue";

// Avisos na tela só para o que é novo: chamado novo, mensagem nova do colaborador e
// chamado transferido para quem está usando a central.
// Prazo não gera aviso nem som: fica em destaque na fila (aba Atrasados e cores do
// prazo) e vai no resumo diário por e-mail.
type Alert = {
  key: string;
  id: string;
  kind: "novo" | "mensagem" | "transferido";
  title: string;
  body: string;
};
type Seen = { last: string; transfer: number };
const SOUND_KEY = "central-alert-sound";
const BASE_TITLE = "Central de Relacionamentos | Frizelo Frigoríficos";

function beep(urgent: boolean) {
  try {
    const ctx = new AudioContext();
    const notes = urgent ? [880, 660, 880, 660] : [660, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.start(t);
      osc.stop(t + 0.15);
    });
    window.setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* sem áudio disponível */
  }
}

/** Pop-up do Windows quando a central não está em foco (outra janela ou outra aba na frente). */
function popup(
  title: string,
  body: string,
  tag: string,
  sticky: boolean,
  onClick?: () => void,
) {
  if (
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    document.hasFocus()
  )
    return;
  try {
    const n = new Notification(title, {
      body,
      tag,
      icon: "/brand/frizelo-logo.png",
      requireInteraction: sticky,
    });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* navegador sem suporte a notificação fora de service worker */
  }
}

const stored = (key: string) => {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
};
const store = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    /* preferência só nesta sessão */
  }
};

/**
 * Compara cada atualização da fila com a anterior e avisa uma vez de chamado
 * novo e de mensagem nova do colaborador: aviso na tela, som, pop-up do Windows
 * e título piscando. Não repete: o que continua pendente fica em destaque na
 * fila e no título da aba (quantos chamados estão sem responsável).
 */
export function useTicketAlerts(
  requests: QueueRequest[],
  active: boolean,
  onOpen?: (id: string) => void,
  userId?: string,
) {
  const seen = useRef<Map<string, Seen> | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sound, setSound] = useState(() => stored(SOUND_KEY));
  const [flash, setFlash] = useState<string | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const waitingCount = active
    ? requests.filter((r) => r.status === "Recebida" && !r.assigned_to).length
    : 0;

  useEffect(() => {
    if (!active) {
      seen.current = null;
      return;
    }
    const open = requests.filter((r) => r.status !== "Concluída");
    const snapshot = (r: QueueRequest): Seen => ({
      last: r.last_message_at || "",
      transfer: r.transfer?.id ?? 0,
    });
    // Primeira carga (ou recarga da página): só memoriza, sem avisar do que já estava na fila.
    if (!seen.current) {
      seen.current = new Map(open.map((r) => [r.id, snapshot(r)]));
      return;
    }
    const fresh: Alert[] = [];
    for (const r of open) {
      const previous = seen.current.get(r.id);
      const current = snapshot(r);
      if (!previous)
        fresh.push({
          key: `${r.id}-novo`,
          id: r.id,
          kind: "novo",
          title: `Novo chamado ${r.protocol}`,
          body: `${r.subject} · ${displayName(r)}`,
        });
      else if (
        // Alguém transferiu o chamado para mim.
        userId &&
        r.transfer &&
        current.transfer > previous.transfer &&
        r.assigned_to === userId &&
        r.transfer.by_id !== userId
      )
        fresh.push({
          key: `${r.id}-transfer-${current.transfer}`,
          id: r.id,
          kind: "transferido",
          title: `Chamado transferido para você: ${r.protocol}`,
          body: `${r.subject} · por ${r.transfer.by_name}`,
        });
      else if (r.needs_reply && current.last > previous.last)
        // Colaborador escreveu de novo num chamado que já existia.
        fresh.push({
          key: `${r.id}-msg-${current.last}`,
          id: r.id,
          kind: "mensagem",
          title: `Nova mensagem: ${r.protocol}`,
          body: `${displayName(r)} · ${r.subject}`,
        });
      seen.current.set(r.id, current);
    }
    if (!fresh.length) return;
    setAlerts((current) =>
      [
        ...fresh,
        ...current.filter((a) => !fresh.some((f) => f.key === a.key)),
      ].slice(0, 5),
    );
    if (sound) beep(false);
    for (const a of fresh)
      popup(a.title, a.body, a.key, a.kind !== "mensagem", () =>
        openRef.current?.(a.id),
      );
    if (!document.hasFocus())
      setFlash(
        { novo: "🔔 Novo chamado", mensagem: "💬 Nova mensagem", transferido: "↪ Chamado transferido" }[fresh[0].kind],
      );
  }, [requests, active, userId]);

  // Título da aba: quantos chamados chegaram e ninguém pegou; pisca enquanto a central está sem foco.
  useEffect(() => {
    const base = waitingCount ? `(${waitingCount}) ${BASE_TITLE}` : BASE_TITLE;
    if (!flash) {
      document.title = base;
      return;
    }
    let on = true;
    const timer = window.setInterval(() => {
      document.title = on ? flash : base;
      on = !on;
    }, 1000);
    const stop = () => setFlash(null);
    window.addEventListener("focus", stop);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", stop);
      document.title = base;
    };
  }, [flash, waitingCount]);

  const toggleSound = () => {
    store(SOUND_KEY, !sound);
    setSound(!sound);
  };
  const dismiss = (key: string) =>
    setAlerts((current) => current.filter((a) => a.key !== key));
  const test = () => {
    beep(false);
    setAlerts((current) =>
      [
        {
          key: `teste-${Date.now()}`,
          id: "",
          kind: "novo" as const,
          title: "Aviso de teste",
          body: "É assim que um chamado novo aparece.",
        },
        ...current,
      ].slice(0, 5),
    );
  };
  return { alerts, dismiss, sound, toggleSound, test };
}

export function AlertToasts({
  alerts,
  dismiss,
  onOpen,
}: {
  alerts: Alert[];
  dismiss: (key: string) => void;
  onOpen: (id: string) => void;
}) {
  if (!alerts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {alerts.map((a) => (
        <div key={a.key} className={`toast toast-${a.kind}`}>
          <button
            className="toast-body"
            onClick={() => {
              dismiss(a.key);
              if (a.id) onOpen(a.id);
            }}
          >
            {a.kind === "novo" ? (
              <Inbox size={18} />
            ) : a.kind === "transferido" ? (
              <ArrowRightLeft size={18} />
            ) : (
              <MessageSquareText size={18} />
            )}
            <span>
              <strong>{a.title}</strong>
              <small>{a.body}</small>
            </span>
          </button>
          <button
            className="toast-close"
            aria-label="Dispensar aviso"
            onClick={() => dismiss(a.key)}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Configuração dos avisos, no topo da fila. */
export function AlertSettings({
  sound,
  toggleSound,
  test,
}: {
  sound: boolean;
  toggleSound: () => void;
  test: () => void;
}) {
  const supported = "Notification" in window;
  const [permission, setPermission] = useState(
    supported ? Notification.permission : "denied",
  );
  return (
    <div className="alert-settings">
      {supported && permission === "default" && (
        <button
          className="icon-text icon-text-strong"
          onClick={() =>
            void Notification.requestPermission().then(setPermission)
          }
          title="Mostrar avisos do Windows quando a central estiver atrás de outra janela"
        >
          <BellRing size={15} />
          Ativar pop-up do Windows
        </button>
      )}
      <button
        className="icon-text"
        onClick={toggleSound}
        title={sound ? "Silenciar o som dos avisos" : "Ligar o som dos avisos"}
      >
        {sound ? <Bell size={15} /> : <BellOff size={15} />}
        {sound ? "Som ligado" : "Som desligado"}
      </button>
      <button
        className="icon-text"
        onClick={test}
        title="Tocar o som e mostrar um aviso de exemplo"
      >
        Testar
      </button>
    </div>
  );
}

export type WhatsappHealth = {
  enabled: boolean;
  health: string;
  lastRestart: string | null;
  lastReason: string | null;
  recovery?: {
    enabled: boolean;
    lastRun: string | null;
    lastError: string | null;
  };
  delivery?: { since: string; escalated: number; waiting: number };
};
const WAHA_TEXT: Record<string, string> = {
  waha_offline:
    "O serviço do WhatsApp (WAHA) não está respondendo. Mensagens dos colaboradores não estão chegando.",
  qr: "O WhatsApp do RH foi desconectado. É preciso ler o QR code no painel do WAHA para reconectar.",
  sem_conexao:
    "O WhatsApp do RH está sem conexão. Tentando reconectar automaticamente…",
  reconectando: "Reconectando o WhatsApp do RH automaticamente…",
};
/** Avisos da faixa: WhatsApp fora, central sem falar com o Chatwoot, mensagens esperando. */
export function whatsappWarnings(
  health: WhatsappHealth | null,
): { text: string; serious: boolean }[] {
  if (!health) return [];
  const warnings: { text: string; serious: boolean }[] = [];
  if (health.enabled && WAHA_TEXT[health.health])
    warnings.push({
      text: WAHA_TEXT[health.health],
      serious: health.health === "qr" || health.health === "waha_offline",
    });
  const waiting = health.delivery?.waiting ?? 0;
  if (waiting > 0)
    warnings.push({
      text: `${waiting} ${waiting === 1 ? "mensagem do WhatsApp não pôde" : "mensagens do WhatsApp não puderam"} ser tratada${waiting === 1 ? "" : "s"} nem passada${waiting === 1 ? "" : "s"} para uma atendente. A central tenta de novo a cada 5 minutos; confira as conversas no Chatwoot.`,
      serious: true,
    });
  else if (health.recovery?.enabled && health.recovery.lastError)
    warnings.push({
      text: "A central não está conseguindo falar com o Chatwoot. Mensagens novas podem demorar a ser tratadas; elas serão recuperadas quando a conexão voltar.",
      serious: true,
    });
  return warnings;
}
/** Faixa na fila quando o WhatsApp do RH não está recebendo ou tratando mensagens. */
export function WhatsappBanner({ health }: { health: WhatsappHealth | null }) {
  const warnings = whatsappWarnings(health);
  if (!warnings.length) return null;
  return (
    <>
      {warnings.map((w) => (
        <div
          key={w.text}
          className={`wa-banner ${w.serious ? "wa-banner-serious" : ""}`}
          role="alert"
        >
          <WifiOff size={17} />
          <span>{w.text}</span>
        </div>
      ))}
    </>
  );
}
