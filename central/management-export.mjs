const cell = (value) => {
  let text = String(value ?? "");
  if (/^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function managementCsv(report, { days = 30, includeDemo = false } = {}) {
  const rows = [
    ["Indicadores de gestão RH"],
    ["Gerado em", report.generatedAt],
    ["Período", days === 0 ? "Todo o histórico" : "Últimos " + days + " dias"],
    ["Inclui demonstração", includeDemo ? "Sim" : "Não"],
    [
      "Escopo",
      "Entradas e conclusões no período; fila e atrasos atuais. Tempos em horas corridas. Apenas respostas públicas do RH.",
    ],
    [],
    ["Indicador", "Valor", "Amostra"],
    ["Recebidas no período", report.received],
    ["Concluídas no período", report.closed],
    ["Em aberto agora", report.backlog],
    ["Não atribuídas", report.unassigned],
    ["Prazo ultrapassado", report.overdue],
    ["Aguardando colaborador", report.awaitingEmployee],
    ["Sem primeira resposta", report.awaitingFirstReply],
    [
      "Primeira resposta média (horas)",
      report.firstReplyMs === null
        ? "Sem amostra"
        : report.firstReplyMs / 3600000,
      report.firstReplySample,
    ],
    [
      "Resolução média (horas)",
      report.resolutionMs === null
        ? "Sem amostra"
        : report.resolutionMs / 3600000,
      report.resolutionSample,
    ],
    [
      "Concluídas dentro do prazo",
      report.withinDeadline,
      report.deadlineSample,
    ],
    ["Concluídas sem data conhecida", report.missingClosedDate],
    [],
    [
      "Serviço",
      "Recebidas no período",
      "Em aberto agora",
      "Concluídas no período",
    ],
    ...report.services.map((r) => [r.name, r.received, r.open, r.closed]),
    [],
    ["Responsável RH", "Em aberto agora", "Prazo ultrapassado"],
    ...report.owners.map((r) => [r.name, r.open, r.overdue]),
    [],
    ["Idade da fila atual", "Quantidade"],
    ...report.aging.map((r) => [r.label, r.count]),
    [],
    ["Dia (America/Cuiaba)", "Recebidas", "Concluídas"],
    ...report.trend.map((r) => [r.day, r.received, r.closed]),
  ];
  return (
    "\uFEFF" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n"
  );
}
