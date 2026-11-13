import React, { useEffect, useRef, useState } from "react";
import { Bell, BellOff, X, AlertTriangle, Inbox, WifiOff } from "lucide-react";
import { displayName, remaining, type QueueRequest } from "./RhQueue";

type Alert = { key: string; id: string; kind: "novo" | "laranja" | "vermelho"; title: string; body: string };
const RANK = { verde: 0, amarelo: 1, laranja: 2, vermelho: 3 } as const;
const SOUND_KEY = "central-alert-sound";

function beep(urgent: boolean) {
  try {
    const ctx = new AudioContext();
    const notes = urgent ? [880, 660, 880] : [660, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.start(t);
      osc.stop(t + 0.15);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    /* sem áudio disponível */
  }
}

/** Compara cada atualização da fila com a anterior e gera avisos de chamado novo e de prazo crítico. */
export function useTicketAlerts(requests: QueueRequest[], active: boolean) {
  const seen = useRef<Map<string, number> | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (!active) {
      seen.current = null;
      return;
    }
    const open = requests.filter((r) => r.status !== "Concluída");
    const level = (r: QueueRequest) => (r.sla ? RANK[r.sla.level] : -1);
    // Primeira carga (ou recarga da página): só memoriza, sem avisar do que já estava na fila.
    if (!seen.current) {
      seen.current = new Map(open.map((r) => [r.id, level(r)]));
      return;
    }
    const fresh: Alert[] = [];
    for (const r of open) {
      const before = seen.current.get(r.id);
      const now = level(r);
      if (before === undefined)
        fresh.push({
          key: `${r.id}-novo`,
          id: r.id,
          kind: "novo",
          title: `Novo chamado ${r.protocol}`,
          body: `${r.subject} · ${displayName(r)}`,
        });
      else if (now >= RANK.laranja && now > before)
        fresh.push({
          key: `${r.id}-${now}`,
          id: r.id,
          kind: now === RANK.vermelho ? "vermelho" : "laranja",
          title: now === RANK.vermelho ? `Prazo estourado: ${r.protocol}` : `Prazo perto do fim: ${r.protocol}`,
          body: `${r.subject} · ${r.due_at ? remaining(r.due_at) : ""}`,
        });
      seen.current.set(r.id, now);
    }
    if (!fresh.length) return;
    setAlerts((current) => [...fresh, ...current.filter((a) => !fresh.some((f) => f.key === a.key))].slice(0, 5));
    if (sound) beep(fresh.some((a) => a.kind === "vermelho"));
    if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible")
      for (const a of fresh) new Notification(a.title, { body: a.body, tag: a.key, icon: "/brand/frizelo-logo.png" });
  }, [requests, active]);
  // Título da aba: quantos chamados chegaram e ninguém pegou ainda.
  useEffect(() => {
    const base = "Central de Relacionamentos | Frizelo Frigoríficos";
    const waiting = active ? requests.filter((r) => r.status === "Recebida" && !r.assigned_to).length : 0;
    document.title = waiting ? `(${waiting}) ${base}` : base;
  }, [requests, active]);
  const toggleSound = () => {
    setSound((on) => {
      try {
        localStorage.setItem(SOUND_KEY, on ? "off" : "on");
      } catch {
        /* preferência só nesta sessão */
      }
      return !on;
    });
  };
  const dismiss = (key: string) => setAlerts((current) => current.filter((a) => a.key !== key));
  return { alerts, dismiss, sound, toggleSound };
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
              onOpen(a.id);
            }}
          >
            {a.kind === "novo" ? <Inbox size={18} /> : <AlertTriangle size={18} />}
            <span>
              <strong>{a.title}</strong>
              <small>{a.body}</small>
            </span>
          </button>
          <button className="toast-close" aria-label="Dispensar aviso" onClick={() => dismiss(a.key)}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Botão da fila: liga as notificações do Windows e o som dos avisos. */
export function AlertSettings({ sound, toggleSound }: { sound: boolean; toggleSound: () => void }) {
  const supported = "Notification" in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
  return (
    <div className="alert-settings">
      {supported && permission === "default" && (
        <button
          className="icon-text"
          onClick={() => void Notification.requestPermission().then(setPermission)}
          title="Mostrar avisos do Windows mesmo com a central em segundo plano"
        >
          <Bell size={15} />
          Ativar notificações
        </button>
      )}
      <button className="icon-text" onClick={toggleSound} title={sound ? "Silenciar o som dos avisos" : "Ligar o som dos avisos"}>
        {sound ? <Bell size={15} /> : <BellOff size={15} />}
        {sound ? "Som ligado" : "Som desligado"}
      </button>
    </div>
  );
}

export type WhatsappHealth = { enabled: boolean; health: string; lastRestart: string | null; lastReason: string | null };
/** Faixa na fila quando o WhatsApp do RH não está recebendo mensagens. */
export function WhatsappBanner({ health }: { health: WhatsappHealth | null }) {
  if (!health?.enabled) return null;
  const text: Record<string, string> = {
    waha_offline: "O serviço do WhatsApp (WAHA) não está respondendo. Mensagens dos colaboradores não estão chegando.",
    qr: "O WhatsApp do RH foi desconectado. É preciso ler o QR code no painel do WAHA para reconectar.",
    sem_conexao: "O WhatsApp do RH está sem conexão. Tentando reconectar automaticamente…",
    reconectando: "Reconectando o WhatsApp do RH automaticamente…",
  };
  if (!text[health.health]) return null;
  const serious = health.health === "qr" || health.health === "waha_offline";
  return (
    <div className={`wa-banner ${serious ? "wa-banner-serious" : ""}`} role="alert">
      <WifiOff size={17} />
      <span>{text[health.health]}</span>
    </div>
  );
}
