import React, { useEffect, useState } from "react";
import { api } from "./api";

type Link = {
  id: string;
  source_system: string;
  source_id: string;
  source_protocol: string;
  ats_instance: string;
  ats_vacancy_id: string;
  created_at: string;
};
type VacancyState = { status: string; publicarCarreiras: boolean };
type Applications = {
  total: number;
  etapas: Record<string, number>;
  ultimaInscricaoEm: string | null;
};
const initial = {
  sourceSystem: "portal-lider-isolado",
  sourceId: "",
  sourceProtocol: "",
  atsInstance: "ats-recrutamento-local",
  atsVacancyId: "",
};
export default function IntegrationLinks() {
  const [links, setLinks] = useState<Link[]>([]);
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<
    Record<string, { text: string; vacancy?: VacancyState }>
  >({});
  const [publishing, setPublishing] = useState<string | null>(null);
  const [applications, setApplications] = useState<
    Record<string, Applications>
  >({});
  async function refreshApplications(id: string) {
    try {
      const result = await api<Applications>(
        `/integration-links/${id}/applications`,
      );
      setApplications((current) => ({ ...current, [id]: result }));
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Falha ao consultar candidaturas.",
      );
    }
  }
  async function refreshStatus(id: string) {
    try {
      const result = await api<{
        state: string;
        vacancy?: { status: string; publicarCarreiras: boolean };
      }>(`/integration-links/${id}/status`);
      setStatuses((current) => ({
        ...current,
        [id]:
          result.state === "ok" && result.vacancy
            ? {
                text: `${result.vacancy.status} · divulgação ${result.vacancy.publicarCarreiras ? "autorizada" : "não autorizada"}`,
                vacancy: result.vacancy,
              }
            : {
                text:
                  result.state === "unconfigured"
                    ? "Consulta ao ATS não configurada"
                    : "ATS indisponível",
              },
      }));
    } catch (e) {
      setStatuses((current) => ({
        ...current,
        [id]: { text: e instanceof Error ? e.message : "Falha na consulta" },
      }));
    }
  }
  async function changePublication(link: Link, publish: boolean) {
    if (
      publish &&
      !window.confirm(
        `Autorizar divulgação da vaga ${link.source_protocol} no site de carreiras?`,
      )
    )
      return;
    setPublishing(link.id);
    setMessage("");
    try {
      await api(`/integration-links/${link.id}/publication`, "PATCH", {
        publish,
      });
      await refreshStatus(link.id);
      setMessage(
        publish
          ? "Divulgação autorizada no site."
          : "Divulgação retirada do site.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Falha ao atualizar divulgação.",
      );
      await refreshStatus(link.id);
    } finally {
      setPublishing(null);
    }
  }
  async function load() {
    const result = await api<{ links: Link[] }>("/integration-links");
    setLinks(result.links);
    return result.links;
  }
  useEffect(() => {
    const reload = () => {
      void load()
        .then((current) => {
          if (current[0]) void refreshStatus(current[0].id);
        })
        .catch((e) => setMessage(e.message));
    };
    reload();
    window.addEventListener("frizelo-vacancy-linked", reload);
    return () => window.removeEventListener("frizelo-vacancy-linked", reload);
  }, []);
  return (
    <section className="management" aria-label="Vínculos de recrutamento">
      <div className="section-heading">
        <div>
          <h2>Vagas no ATS e divulgação</h2>
          <p>
            Consulte o andamento e autorize ou retire a divulgação no site sem
            sair da Central.
          </p>
        </div>
      </div>
      <details>
        <summary>Vincular manualmente uma vaga legada</summary>
        <p>
          Use apenas para corrigir registros anteriores à integração automática.
          Confira os IDs no Portal e no ATS.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              const result = await api<{ created: boolean }>(
                "/integration-links",
                "POST",
                form,
              );
              await load();
              setForm(initial);
              setMessage(
                result.created
                  ? "Vínculo registrado."
                  : "Este vínculo já estava registrado.",
              );
            } catch (e) {
              setMessage(
                e instanceof Error ? e.message : "Falha ao registrar.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Origem
            <select
              value={form.sourceSystem}
              onChange={(e) =>
                setForm({ ...form, sourceSystem: e.target.value })
              }
            >
              <option value="portal-lider-isolado">
                Portal do Líder isolado
              </option>
              <option value="portal-lider-conector">
                Portal do Líder no conector
              </option>
            </select>
          </label>
          {(
            [
              ["sourceId", "ID da solicitação"],
              ["sourceProtocol", "Protocolo de origem"],
              ["atsInstance", "Base ATS (padrão: ats-recrutamento-local)"],
              ["atsVacancyId", "ID da vaga no ATS"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required
                maxLength={160}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <button type="submit" disabled={busy}>
            {busy ? "Registrando…" : "Registrar vínculo"}
          </button>
        </form>
      </details>
      {message && <p role="status">{message}</p>}
      {links.length ? (
        <ul>
          {links.map((link) => (
            <li key={link.id}>
              <strong>{link.source_protocol}</strong> · {link.source_system} /{" "}
              {link.source_id} → {link.ats_instance} / vaga{" "}
              {link.ats_vacancy_id} ·{" "}
              {new Date(link.created_at).toLocaleString("pt-BR", {
                timeZone: "America/Cuiaba",
              })}{" "}
              <button type="button" onClick={() => void refreshStatus(link.id)}>
                Consultar ATS
              </button>{" "}
              <button
                type="button"
                onClick={() => void refreshApplications(link.id)}
              >
                Ver candidaturas
              </button>{" "}
              {statuses[link.id]?.text}{" "}
              {applications[link.id] ? (
                <span>
                  {applications[link.id].total} candidatura(s)
                  {Object.entries(applications[link.id].etapas).map(
                    ([stage, count]) => ` · ${stage}: ${count}`,
                  )}
                  {applications[link.id].ultimaInscricaoEm
                    ? ` · última inscrição: ${new Date(applications[link.id].ultimaInscricaoEm!).toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })}`
                    : ""}
                </span>
              ) : null}{" "}
              {statuses[link.id]?.vacancy?.status === "EM_ABERTO" &&
              !statuses[link.id]?.vacancy?.publicarCarreiras ? (
                <button
                  type="button"
                  disabled={publishing === link.id}
                  onClick={() => void changePublication(link, true)}
                >
                  {publishing === link.id
                    ? "Atualizando…"
                    : "Autorizar divulgação no site"}
                </button>
              ) : null}
              {statuses[link.id]?.vacancy?.publicarCarreiras ? (
                <button
                  type="button"
                  disabled={publishing === link.id}
                  onClick={() => void changePublication(link, false)}
                >
                  {publishing === link.id ? "Atualizando…" : "Retirar do site"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>Nenhum vínculo registrado.</p>
      )}
    </section>
  );
}
