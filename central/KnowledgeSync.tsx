import React, { useState } from "react";
import { api } from "./api";

type Result = {
  files: string[];
  eventCount: number;
  seniorError: string | null;
};

export default function KnowledgeSync() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function sync() {
    setBusy(true);
    setError("");
    try {
      setResult(await api<Result>("/knowledge/sync", "POST", {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="help-banner">
      <div>
        <h3>Base de conhecimento da IA (RAG)</h3>
        <p>
          Gera documentos a partir do catálogo de serviços, das dúvidas
          frequentes e do catálogo de eventos de folha da Senior, para a IA usar
          como referência nas respostas. Políticas exportadas manualmente
          (SharePoint/Drive) continuam em <code>data/policies/</code>e não são
          afetadas.
        </p>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void sync()}
        >
          {busy ? "Sincronizando…" : "Sincronizar base de conhecimento"}
        </button>
        {result && (
          <p role="status">
            {result.files.length} documento(s) gerado(s)
            {result.eventCount > 0
              ? ` · ${result.eventCount} eventos de folha da Senior.`
              : "."}
            {result.seniorError &&
              ` Catálogo de eventos da Senior não sincronizado: ${result.seniorError}.`}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
