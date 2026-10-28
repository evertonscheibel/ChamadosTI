import React, { useEffect, useState } from "react";

import { api, downloadFile } from "./api";
type Status = {
  state: string;
  count?: number;
  queries?: number;
  error?: string;
  completedAt?: string;
};

export default function SeniorExport() {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setStatus(await api<Status>("/senior/employees"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!["running", "busy", "complete"].includes(status.state)) return;
    const timer = setInterval(
      () => void refresh(),
      status.state === "complete" ? 30000 : 3000,
    );
    return () => clearInterval(timer);
  }, [status.state]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      await api("/senior/employees", "POST", {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    setError("");
    try {
      await downloadFile("/senior/employees.csv", "colaboradores-senior.csv");
    } catch (e) {
      await refresh();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="help-banner">
      <div>
        <h3>Extrair colaboradores da Senior</h3>
        <p>
          Todos os vínculos da empresa configurada, incluindo desligados. CSV
          com empresa, tipo, matrícula, nome, CPF, filial, admissão e código da
          situação. A extração não cria contas no portal.
        </p>
        <button
          className="button secondary"
          disabled={busy || ["running", "busy"].includes(status.state)}
          onClick={() => void start()}
        >
          {status.state === "running" ? "Extraindo…" : "Extrair base completa"}
        </button>
        {status.state === "running" && (
          <p>
            {status.count || 0} vínculos lidos · {status.queries || 0}{" "}
            consultas. Aguarde a conclusão.
          </p>
        )}
        {status.state === "complete" && (
          <p>
            {status.count} vínculos extraídos.{" "}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void download()}
            >
              Baixar CSV
            </button>{" "}
            · Disponível por 15 minutos.
          </p>
        )}
        {(error || status.error) && <p role="alert">{error || status.error}</p>}
        {status.state === "busy" && (
          <p>Outra extração está em andamento. Aguarde para iniciar a sua.</p>
        )}
        {status.state === "expired" && (
          <p>A extração expirou. Execute novamente.</p>
        )}
      </div>
    </div>
  );
}
