import React, { useEffect, useRef, useState } from "react";
import { Bell, BellOff, BellRing, X, AlertTriangle, Inbox, WifiOff, Repeat } from "lucide-react";
import { MessageSquareText } from "lucide-react";
import { displayName, remaining, type QueueRequest } from "./RhQueue";

type Alert = { key: string; id: string; kind: "novo" | "mensagem" | "laranja" | "vermelho"; title: string; body: string };
type Seen = { level: number; last: string; late: boolean };
const RANK = { verde: 0, amarelo: 1, laranja: 2, vermelho: 3 } as const;
const SOUND_KEY = "central-alert-sound";
const REMINDER_KEY = "central-alert-reminder";
const REMINDER_MS = 2 * 60000;
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
function popup(title: string, body: string, tag: string, sticky: boolean, onClick?: () => void) {
  if (!("Notification" in window) || Notification.permission !== "granted" || document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, tag, icon: "/brand/frizelo-logo.png", requireInteraction: sticky });
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
 * Compara cada atualização da fila com a anterior e gera avisos de chamado novo
 * e de prazo crítico: aviso na tela, som, pop-up do Windows e título piscando.
 * Enquanto houver chamado recebido sem ninguém, lembra a cada 2 minutos.
 */
export function useTicketAlerts(requests: QueueRequest[], active: boolean, onOpen?: (id: string) => void) {
  const seen = useRef<Map<string, Seen> | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sound, setSound] = useState(() => stored(SOUND_KEY));
  const [reminder, setReminder] = useState(() => stored(REMINDER_KEY));
  const [flash, setFlash] = useState<string | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const waiting = active ? requests.filter((r) => r.status === "Recebida" && !r.assigned_to) : [];

  useEffect(() => {
    if (!active) {
      seen.current = null;
      return;
    }
    const open = requests.filter((r) => r.status !== "Concluída");
    const level = (r: QueueRequest) => (r.sla ? RANK[r.sla.level] : -1);
    const snapshot = (r: QueueRequest): Seen => ({
      level: level(r),
      last: r.last_message_at || "",
      late: r.first_response?.level === "atrasado",
    });
    // Primeira carga (ou recarga da página): só memoriza, sem avisar do que já estava na fila.
    if (!seen.current) {
      seen.current = new Map(open.map((r) => [r.id, snapshot(r)]));
      return;
    }
    const fresh: Alert[] = [];
    for (const r of open) {
      const previous = seen.current.get(r.id);
      const before = previous?.level;
      const now = level(r);
      const current = snapshot(r);
      if (previous && r.needs_reply && current.last > previous.last)
        // Colaborador escreveu de novo num chamado que já existia.
        fresh.push({
          key: `${r.id}-msg-${current.last}`,
          id: r.id,
          kind: "mensagem",
          title: `Nova mensagem: ${r.protocol}`,
          body: `${displayName(r)} · ${r.subject}`,
        });
      if (previous && current.late && !previous.late)
        fresh.push({
          key: `${r.id}-primeira`,
          id: r.id,
          kind: "vermelho",
          title: `1ª resposta atrasada: ${r.protocol}`,
          body: `${r.subject} · ${displayName(r)} ainda não recebeu resposta`,
        });
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
      seen.current.set(r.id, current);
    }
    if (!fresh.length) return;
    setAlerts((current) => [...fresh, ...current.filter((a) => !fresh.some((f) => f.key === a.key))].slice(0, 5));
    if (sound) beep(fresh.some((a) => a.kind === "vermelho"));
    for (const a of fresh) popup(a.title, a.body, a.key, a.kind !== "laranja", () => openRef.current?.(a.id));
    if (!document.hasFocus())
      setFlash({ novo: "🔔 Novo chamado", mensagem: "💬 Nova mensagem", laranja: "⚠️ Prazo crítico", vermelho: "⚠️ Prazo crítico" }[fresh[0].kind]);
  }, [requests, active]);

  // Lembrete: chamado recebido e ninguém assumiu. Repete a cada 2 minutos até alguém pegar.
  const waitingCount = waiting.length;
  useEffect(() => {
    if (!active || !reminder || !waitingCount) return;
    const timer = window.setInterval(() => {
      if (sound) beep(false);
      popup(
        waitingCount === 1 ? "1 chamado aguardando alguém assumir" : `${waitingCount} chamados aguardando alguém assumir`,
        "Abra a central para assumir.",
        "lembrete-fila",
        false,
      );
      if (!document.hasFocus()) setFlash(`🔔 ${waitingCount} sem responsável`);
    }, REMINDER_MS);
    return () => window.clearInterval(timer);
  }, [active, reminder, sound, waitingCount]);

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
  const toggleReminder = () => {
    store(REMINDER_KEY, !reminder);
    setReminder(!reminder);
  };
  const dismiss = (key: string) => setAlerts((current) => current.filter((a) => a.key !== key));
  const test = () => {
    beep(false);
    setAlerts((current) => [
      { key: `teste-${Date.now()}`, id: "", kind: "novo" as const, title: "Aviso de teste", body: "É assim que um chamado novo aparece." },
      ...current,
    ].slice(0, 5));
  };
  return { alerts, dismiss, sound, toggleSound, reminder, toggleReminder, test };
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
            {a.kind === "novo" ? <Inbox size={18} /> : a.kind === "mensagem" ? <MessageSquareText size={18} /> : <AlertTriangle size={18} />}
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

/** Configuração dos avisos, no topo da fila. */
export function AlertSettings({
  sound,
  toggleSound,
  reminder,
  toggleReminder,
  test,
}: {
  sound: boolean;
  toggleSound: () => void;
  reminder: boolean;
  toggleReminder: () => void;
  test: () => void;
}) {
  const supported = "Notification" in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
  return (
    <div className="alert-settings">
      {supported && permission === "default" && (
        <button
          className="icon-text icon-text-strong"
          onClick={() => void Notification.requestPermission().then(setPermission)}
          title="Mostrar avisos do Windows quando a central estiver atrás de outra janela"
        >
          <BellRing size={15} />
          Ativar pop-up do Windows
        </button>
      )}
      <button className="icon-text" onClick={toggleSound} title={sound ? "Silenciar o som dos avisos" : "Ligar o som dos avisos"}>
        {sound ? <Bell size={15} /> : <BellOff size={15} />}
        {sound ? "Som ligado" : "Som desligado"}
      </button>
      <button
        className="icon-text"
        onClick={toggleReminder}
        title="Enquanto houver chamado recebido sem responsável, avisa de novo a cada 2 minutos"
      >
        <Repeat size={15} />
        {reminder ? "Lembrete a cada 2 min" : "Lembrete desligado"}
      </button>
      <button className="icon-text" onClick={test} title="Tocar o som e mostrar um aviso de exemplo">
        Testar
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
