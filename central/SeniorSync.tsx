import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
type Status = {
  state: string;
  count?: number;
  error?: string;
  completedAt?: string;
  result?: {
    validCpfs: number;
    created: number;
    updated: number;
    deactivated: number;
    invalidCpf: number;
    missingName: number;
    roleConflicts: number;
    deactivationDeferred: boolean;
  };
};
export default function SeniorSync({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const completed = useRef("");
  const callback = useRef(onSynced);
  callback.current = onSynced;
  async function refresh() {
    try {
      setStatus(await api<Status>("/senior/synchronize"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (status.state !== "running") return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [status.state]);
  useEffect(() => {
    if (
      status.state === "complete" &&
      status.completedAt &&
      completed.current !== status.completedAt
    ) {
      completed.current = status.completedAt;
      callback.current();
    }
  }, [status.state, status.completedAt]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      await api("/senior/synchronize", "POST", {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const result = status.result;
  return (
    <div className="help-banner">
      <div>
        <h3>Cadastro de ativos da Senior</h3>
        <p>
          Importe empregados com vínculo ativo e CPF válido. Férias e
          afastamentos não excluem o colaborador. Senhas existentes são
          preservadas; novos acessos precisam de código individual.
        </p>
        <button
          className="button primary"
          disabled={busy || status.state === "running"}
          onClick={() => void start()}
        >
          {status.state === "running" ? "Sincronizando…" : "Sincronizar ativos"}
        </button>
        {status.state === "running" && (
          <p role="status">
            {status.count || 0} vínculos lidos. Aguarde a conclusão.
          </p>
        )}
        {result && status.state === "complete" && (
          <p role="status">
            {result.validCpfs} CPFs válidos · {result.created} novos ·{" "}
            {result.updated} atualizados · {result.deactivated} desativados.
            {result.invalidCpf > 0 &&
              ` ${result.invalidCpf} vínculos com CPF inválido não importados.`}
            {result.missingName > 0 &&
              ` ${result.missingName} vínculos sem nome não importados.`}
            {result.roleConflicts > 0 &&
              ` ${result.roleConflicts} conflitos de perfil preservados.`}
            {result.deactivationDeferred &&
              " Desativações adiadas: há pendências cadastrais na origem."}
          </p>
        )}
        {(error || status.error) && <p role="alert">{error || status.error}</p>}
      </div>
    </div>
  );
}
