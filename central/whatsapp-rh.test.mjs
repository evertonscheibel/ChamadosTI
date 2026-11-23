import assert from "node:assert/strict";
import { test } from "node:test";
import {
  digestDay,
  businessDeadline,
  businessElapsed,
  slaStatus,
  parseOption,
  nextStep,
  validCpf,
  sameName,
  parseCompetence,
  phoneAllowed,
  whatsappConfig,
  menuText,
  withinOfficeHours,
  ticketOpenedText,
  ticketClosedText,
  statusText,
  formatLocal,
  ticketsClosedText,
  chatwootTicket,
} from "./whatsapp-rh.mjs";

const ms = (iso) => Date.parse(iso);

test("48h úteis pulam o fim de semana (fuso de MS)", () => {
  // sexta 15h (UTC-4) -> terça 15h
  assert.equal(new Date(businessDeadline(ms("2026-11-13T15:00:00-04:00"), 48)).toISOString(), "2026-11-17T19:00:00.000Z");
  // segunda 09h -> quarta 09h
  assert.equal(new Date(businessDeadline(ms("2026-11-16T09:00:00-04:00"), 48)).toISOString(), "2026-11-18T13:00:00.000Z");
  // aberto no sábado: começa a contar na segunda 00h
  assert.equal(new Date(businessDeadline(ms("2026-11-14T10:00:00-04:00"), 48)).toISOString(), "2026-11-18T04:00:00.000Z");
});

test("feriado também não conta", () => {
  const due = businessDeadline(ms("2026-11-19T10:00:00-04:00"), 24, ["2026-11-20"]);
  assert.equal(new Date(due).toISOString(), "2026-11-23T14:00:00.000Z"); // qui 10h -> seg 10h
});

test("tempo útil decorrido ignora o fim de semana", () => {
  assert.equal(businessElapsed(ms("2026-11-13T12:00:00-04:00"), ms("2026-11-16T12:00:00-04:00")), 24 * 3600000);
});

test("criticidade: verde, amarelo, laranja e vermelho", () => {
  const created = "2026-11-16T09:00:00-04:00";
  const due = "2026-11-18T09:00:00-04:00";
  const at = (iso) => slaStatus(created, due, ms(iso));
  assert.deepEqual(at("2026-11-16T21:00:00-04:00"), { percent: 25, level: "verde" });
  assert.deepEqual(at("2026-11-17T12:00:00-04:00"), { percent: 56, level: "amarelo" });
  assert.deepEqual(at("2026-11-17T23:00:00-04:00"), { percent: 79, level: "laranja" });
  assert.deepEqual(at("2026-11-18T10:00:00-04:00"), { percent: 100, level: "vermelho" });
  assert.equal(slaStatus(created, null), null);
});

test("opções do menu por número ou palavra", () => {
  assert.deepEqual(
    ["1", "2.", "opção 3", "4)", "0", "10", "15", "16", "esqueci de bater o ponto", "quero meu holerite", "espelho", "ok"].map(parseOption),
    [1, 2, 3, 4, 0, 10, 15, null, 3, 1, 2, null],
  );
});

test("temas mais pedidos no WhatsApp do RH caem na opção certa pela palavra", () => {
  assert.deepEqual(
    [
      "meu filho nasceu, licença paternidade",
      "incluir dependente no plano de saúde",
      "quem vai pegar o sacolão",
      "preciso remarcar o exame",
      "sou da corretora do plano",
      "ele está internado, sofreu acidente",
      "atualizar meu pix",
    ].map(parseOption),
    [9, 6, 7, 10, 15, 4, 12],
  );
});

test("fluxo: menu, opção inválida, assunto e abertura do chamado", () => {
  let step = nextStep(null, "oi");
  assert.equal(step.reply, menuText());
  step = nextStep(step.state, "quero saber");
  assert.match(step.reply, /Não entendi/);
  step = nextStep(step.state, "8");
  assert.match(step.reply, /Férias/);
  assert.deepEqual(step.state, { stage: "tema", theme: 8, invalid: 0, data: {} });
  step = nextStep(step.state, "Everton, TI. 10/11 entrada 07:00");
  assert.equal(step.open, true);
  assert.equal(step.state.stage, "chamado");
  assert.equal(nextStep(step.state, "mais uma coisa").append, true);
  assert.equal(nextStep({ stage: "encerrado" }, "oi").reply, menuText());
});

test("cumprimento no lugar dos dados repete o pedido e não abre chamado", () => {
  const state = { stage: "tema", theme: 14, invalid: 0 };
  for (const t of ["oi", "Olá!", "bom dia", "ok"]) {
    const step = nextStep(state, t);
    assert.equal(step.open, undefined, t);
    assert.match(step.reply, /Para eu registrar o seu chamado, sobre \*\*Vagas e currículo\*\*/);
  }
  assert.equal(nextStep(state, "oi", { hasAttachment: true }).open, true);
  assert.equal(nextStep(state, "Everton, vaga de faqueiro").open, true);
});

test("duas respostas fora do menu seguem como outros assuntos", () => {
  const step = nextStep({ stage: "menu", invalid: 1 }, "xyz");
  assert.equal(step.state.theme, 0);
});

test("modo teste filtra pelo telefone; 'todos' libera", () => {
  const config = whatsappConfig({ WHATSAPP_RH_TELEFONES_TESTE: "98969836" });
  assert.equal(phoneAllowed("+5567998969836", config), true);
  assert.equal(phoneAllowed("+5567991234567", config), false);
  assert.equal(phoneAllowed("+5567991234567", whatsappConfig({ WHATSAPP_RH_TELEFONES_TESTE: "todos" })), true);
});

test("menu: holerite e espelho em PDF são as opções 1 e 2, direto para a identificação", () => {
  const menu = menuText();
  assert.match(menu, /Receber agora, em PDF\*\*\n1️⃣ Holerite\n2️⃣ Espelho de ponto/);
  assert.match(menu, /6️⃣ Plano de saúde/);
  assert.match(menu, /9️⃣ Licenças/);
  assert.match(menu, /🔟 Agendar ou remarcar/);
  assert.match(menu, /1️⃣4️⃣ Vagas e currículo/);
  assert.match(menu, /1️⃣5️⃣ Empresa parceira/);
  assert.match(menu, /\*\*status\*\*/);
  for (const [option, theme] of [["1", 1], ["2", 2]]) {
    const step = nextStep({ stage: "menu" }, option);
    assert.equal(step.state.stage, "doc_cpf");
    assert.equal(step.state.theme, theme);
    assert.equal(step.identity, true);
  }
  assert.equal(nextStep({ stage: "menu" }, "5").state.stage, "tema");
  // conversa antiga parada na pergunta "PDF ou falar com o RH" volta ao menu
  assert.equal(nextStep({ stage: "doc_opcao", theme: 3 }, "1").reply, menuText());
});

test("documento: CPF, matrícula e nome antes de verificar; depois o mês", () => {
  let state = { stage: "doc_cpf", theme: 1, invalid: 0, data: { attempts: 0 } };
  assert.match(nextStep(state, "123").reply, /11 números/);
  let step = nextStep(state, "529.982.247-25");
  assert.equal(step.state.stage, "doc_matricula");
  assert.equal(step.state.data.cpf, "52998224725");
  step = nextStep(step.state, "mat 1234");
  assert.equal(step.state.data.matricula, "1234");
  step = nextStep(step.state, "Maria da Silva");
  assert.deepEqual(step.verify, { cpf: "52998224725", matricula: "1234", name: "Maria da Silva" });
  state = { stage: "doc_mes", theme: 2, data: {} };
  assert.deepEqual(nextStep(state, "10/2026").deliver, { kind: "ponto", month: "2026-10" });
  assert.match(nextStep(state, "ontem").reply, /10\/2026/);
  assert.equal(nextStep(state, "menu").state.stage, "menu");
});

test("CPF, nome e mês", () => {
  assert.deepEqual(["52998224725", "11111111111", "52998224724", "123"].map(validCpf), [true, false, false, false]);
  assert.equal(sameName("João  da Silva", "JOAO DA SILVA"), true);
  assert.equal(sameName("João Silva", "JOAO DA SILVA"), false);
  assert.deepEqual(["10/2026", "1-2026", "2026-09", "outubro de 2026", "março/2026", "13/2026"].map(parseCompetence), ["2026-10", "2026-01", "2026-09", "2026-10", "2026-03", null]);
});

test("com chamado aberto: 'menu' abre outro assunto e 'oi' recebe lembrete", () => {
  const state = { stage: "chamado", theme: 8, data: {} };
  assert.equal(nextStep(state, "menu").state.stage, "menu");
  assert.equal(nextStep(state, "oi").remind, true);
  assert.equal(nextStep(state, "Olá!").remind, true);
  assert.deepEqual(nextStep(state, "segue meu currículo atualizado"), { state, append: true });
  assert.deepEqual(nextStep(state, "oi", { hasAttachment: true }), { state, append: true });
});

test("'status' lista os chamados em qualquer ponto, menos no meio dos dados pessoais", () => {
  assert.equal(nextStep(null, "status").status, true);
  assert.equal(nextStep(null, "status").state.stage, "menu");
  const chamado = { stage: "chamado", theme: 4, data: {} };
  assert.deepEqual(nextStep(chamado, "Meus chamados"), { state: chamado, status: true });
  assert.equal(nextStep({ stage: "encerrado" }, "status").state.stage, "menu");
  assert.equal(nextStep({ stage: "doc_nome", theme: 1, data: { cpf: "1", matricula: "2" } }, "status").verify.name, "status");
});

test("situação dos chamados em texto para o WhatsApp", () => {
  assert.match(statusText([]), /não tem chamados/);
  const text = statusText([
    { protocol: "FRZ-1", subject: "Férias", status: "Aguardando colaborador", due_at: "2026-11-17T19:00:00Z", closed_at: null },
    { protocol: "FRZ-2", subject: "Atestado", status: "Concluída", due_at: null, closed_at: "2026-11-10T15:00:00Z" },
  ]);
  assert.match(text, /\*\*FRZ-1\*\* · Férias\n {3}\*\*aguardando a sua resposta\*\* · resposta até ter, 17\/11 às 15h/);
  assert.match(text, /FRZ-2\*\* · Atestado\n {3}concluído \(ter, 10\/11\)/);
  assert.match(text, /esperando uma informação sua/);
});

test("pesquisa ao concluir: nota de 1 a 5; outra coisa volta ao menu", () => {
  assert.match(ticketClosedText("FRZ-9", { survey: true }), /nota de \*\*1\*\* a \*\*5\*\*/);
  assert.doesNotMatch(ticketClosedText("FRZ-9"), /nota/);
  const state = { stage: "pesquisa", theme: 4, data: {} };
  for (const [text, rate] of [["5", 5], ["1", 1], ["4 estrelas", 4], ["3/5", 3]]) {
    const step = nextStep(state, text);
    assert.equal(step.rate, rate, text);
    assert.equal(step.state.stage, "encerrado");
  }
  assert.equal(nextStep(state, "6").reply, menuText());
  assert.equal(nextStep(state, "oi, preciso de outra coisa").reply, menuText());
  assert.match(ticketClosedText("FRZ-9", { survey: true }), /envie \*\*sair\*\*/);
});

test("comandos para encerrar a conversa: sair, tchau, fim, só isso", () => {
  assert.match(menuText(), /\*\*sair\*\* encerra a conversa/);
  for (const stage of [null, "menu", "encerrado", "pesquisa", "doc_opcao", "doc_cpf", "doc_mes"])
    for (const text of ["sair", "Sair", "tchau!", "fim", "encerrar", "encerrar conversa", "finalizar atendimento", "só isso", "era so isso", "não, obrigado", "até mais"]) {
      const step = nextStep({ stage, theme: 1, data: {} }, text);
      assert.equal(step.goodbye, true, `${stage}: ${text}`);
      assert.equal(step.ended, true, `${stage}: ${text}`);
      assert.equal(step.state.stage, "encerrado");
      assert.equal(step.reply, undefined);
    }
  assert.equal(nextStep({ stage: "menu", data: {} }, "obrigado").goodbye, true);
  // Com chamado aberto, "encerrar" continua sendo cancelar e "tchau" entra no chamado.
  assert.equal(nextStep({ stage: "chamado", theme: 3, data: {} }, "encerrar").confirmCancel, true);
  assert.notEqual(nextStep({ stage: "chamado", theme: 3, data: {} }, "tchau").goodbye, true);
  assert.notEqual(nextStep({ stage: "cancelar", theme: 3, data: {} }, "sair").ended, true);
  // "menu" continua voltando ao menu, inclusive no meio dos documentos.
  assert.equal(nextStep({ stage: "doc_cpf", theme: 1, data: {} }, "menu").reply, menuText());
});

test("horário do RH: dia útil, das 7h às 17h no fuso de MS", () => {
  const office = { officeHours: [7 * 60, 17 * 60], holidays: ["2026-11-20"] };
  assert.equal(withinOfficeHours(ms("2026-11-16T07:00:00-04:00"), office), true);
  assert.equal(withinOfficeHours(ms("2026-11-16T16:59:00-04:00"), office), true);
  assert.equal(withinOfficeHours(ms("2026-11-16T17:00:00-04:00"), office), false);
  assert.equal(withinOfficeHours(ms("2026-11-16T06:30:00-04:00"), office), false);
  assert.equal(withinOfficeHours(ms("2026-11-14T10:00:00-04:00"), office), false); // sábado
  assert.equal(withinOfficeHours(ms("2026-11-20T10:00:00-04:00"), office), false); // feriado
  assert.deepEqual(whatsappConfig({ WHATSAPP_RH_EXPEDIENTE: "07:30-17:48" }).officeHours, [450, 1068]);
  assert.deepEqual(whatsappConfig({}).officeHours, [420, 1020]);
});

test("confirmação do chamado mostra o prazo e avisa fora do expediente", () => {
  const dueMs = ms("2026-11-17T15:30:00-04:00");
  assert.equal(formatLocal(dueMs), "ter, 17/11 às 15h30");
  const inside = ticketOpenedText("FRZ-3", 4, { dueMs });
  assert.match(inside, /até \*\*ter, 17\/11 às 15h30\*\*/);
  assert.doesNotMatch(inside, /fora do horário/);
  assert.match(ticketOpenedText("FRZ-3", 4, { dueMs, offHours: true }), /fora do horário de atendimento \(segunda a sexta, das 7h às 17h\)/);
});

test("1ª resposta: relógio só corre no expediente (7h–17h, dias úteis)", async () => {
  const { officeDeadline, officeElapsed, firstResponseStatus } = await import("./whatsapp-rh.mjs");
  const office = { officeHours: [7 * 60, 17 * 60], holidays: ["2026-11-20"] };
  const iso = (t) => new Date(t).toISOString();
  // segunda 10h + 4h = 14h
  assert.equal(iso(officeDeadline(ms("2026-11-16T10:00:00-04:00"), 4, office)), "2026-11-16T18:00:00.000Z");
  // segunda 15h + 4h = 2h na segunda + 2h na terça -> terça 9h
  assert.equal(iso(officeDeadline(ms("2026-11-16T15:00:00-04:00"), 4, office)), "2026-11-17T13:00:00.000Z");
  // segunda 22h (fora do expediente) -> terça 11h
  assert.equal(iso(officeDeadline(ms("2026-11-16T22:00:00-04:00"), 4, office)), "2026-11-17T15:00:00.000Z");
  // quinta 16h, sexta é feriado -> segunda 10h
  assert.equal(iso(officeDeadline(ms("2026-11-19T16:00:00-04:00"), 4, office)), "2026-11-23T14:00:00.000Z");
  assert.equal(officeElapsed(ms("2026-11-16T16:00:00-04:00"), ms("2026-11-17T08:00:00-04:00"), office), 2 * 3600000);
  const created = "2026-11-16T10:00:00-04:00";
  const at = (now, answered = null) => firstResponseStatus(created, answered, ms(now), { hours: 4, ...office });
  assert.equal(at("2026-11-16T11:00:00-04:00").level, "ok");
  assert.equal(at("2026-11-16T13:30:00-04:00").level, "perto");
  assert.equal(at("2026-11-16T14:00:00-04:00").level, "atrasado");
  assert.deepEqual(at("2026-11-16T15:00:00-04:00", "2026-11-16T13:00:00-04:00"), { due_at: "2026-11-16T18:00:00.000Z", level: "respondido", late: false });
  assert.equal(at("2026-11-16T15:00:00-04:00", "2026-11-16T14:30:00-04:00").late, true);
});

test("chamado no Chatwoot: prioridade acompanha a cor do prazo", () => {
  const base = { protocol: "FRZ-2026-000010", subject: "Atestado / afastamento", status: "Recebida",
    created_at: "2026-11-16T12:00:00.000Z", due_at: "2026-11-18T12:00:00.000Z" };
  const inicio = chatwootTicket(base, ms("2026-11-16T13:00:00.000Z"));
  assert.equal(inicio.priority, "low");
  assert.equal(inicio.attributes.chamado, "FRZ-2026-000010");
  assert.equal(inicio.attributes.chamado_assunto, "Atestado / afastamento");
  assert.equal(inicio.attributes.chamado_status, "Recebida");
  assert.match(inicio.attributes.chamado_prazo, /18\/11/);
  assert.equal(chatwootTicket(base, ms("2026-11-17T13:00:00.000Z")).priority, "medium");
  assert.equal(chatwootTicket(base, ms("2026-11-18T00:00:00.000Z")).priority, "high");
  assert.equal(chatwootTicket(base, ms("2026-11-18T12:00:00.000Z")).priority, "urgent");
});

test("chamado concluído ou sem prazo fica sem prioridade no Chatwoot", () => {
  const base = { protocol: "P", subject: "S", created_at: "2026-11-16T12:00:00.000Z", due_at: "2026-11-18T12:00:00.000Z" };
  const fim = chatwootTicket({ ...base, status: "Concluída" }, ms("2026-11-20T12:00:00.000Z"));
  assert.equal(fim.priority, null);
  assert.equal(fim.attributes.chamado_status, "Concluída");
  const semPrazo = chatwootTicket({ ...base, status: "Em atendimento", due_at: null });
  assert.equal(semPrazo.priority, null);
  assert.equal(semPrazo.attributes.chamado_prazo, "sem prazo");
});

test("pedir atendente no menu vira 'outros assuntos', sem passar na frente de um assunto citado", () => {
  assert.equal(parseOption("atendente"), 0);
  assert.equal(parseOption("quero falar com uma pessoa"), 0);
  assert.equal(parseOption("atendente sobre férias"), 8);
  assert.equal(parseOption("3"), 3);
});

test("com chamado aberto, 'ok/obrigado' recebe confirmação curta no máximo 1 vez por hora", () => {
  const t0 = ms("2026-11-16T15:00:00.000Z");
  const chamado = { stage: "chamado", theme: 3, invalid: 0, data: {} };
  const a = nextStep(chamado, "ok", { now: t0 });
  assert.equal(a.ack, true);
  assert.ok(!a.append && !a.remind);
  const b = nextStep(a.state, "obrigado!", { now: t0 + 60000 });
  assert.equal(b.silent, true, "segundo 'obrigado' em menos de 1 h não responde");
  assert.equal(nextStep(b.state, "👍", { now: t0 + 2 * 3600000 }).ack, true);
  assert.equal(nextStep(chamado, "ok, muito obrigado 🙏", { now: t0 }).ack, true);
  assert.equal(nextStep(chamado, "ok, mas faltou o dia 11", { now: t0 }).append, true, "frase com conteúdo entra no chamado");
});

test("cumprimento com chamado aberto: lembrete completo 1 vez por dia, depois confirmação curta", () => {
  const t0 = ms("2026-11-16T15:00:00.000Z");
  const a = nextStep({ stage: "chamado", data: {} }, "oi", { now: t0 });
  assert.equal(a.remind, true);
  const b = nextStep(a.state, "bom dia", { now: t0 + 3600000 });
  assert.equal(b.ack, true);
  assert.equal(nextStep(b.state, "oi", { now: t0 + 25 * 3600000 }).remind, true);
});

test("'obrigado' depois de encerrado ou na pesquisa é despedida, sem menu", () => {
  for (const stage of ["encerrado", "pesquisa"]) {
    const r = nextStep({ stage, data: {} }, "obrigada");
    assert.equal(r.goodbye, true, stage);
    assert.equal(r.state.stage, "encerrado");
    assert.equal(r.reply, undefined);
  }
  assert.equal(nextStep({ stage: "pesquisa", data: {} }, "5").rate, 5);
  assert.match(nextStep({ stage: "encerrado", data: {} }, "preciso de ajuda").reply, /Responda com o \*\*número\*\*/);
});

test("'ok' no meio do assunto não vira chamado", () => {
  const r = nextStep({ stage: "tema", theme: 3, data: {} }, "ok");
  assert.ok(!r.open);
  assert.match(r.reply, /Para eu registrar/);
});

test("colaborador cancela o chamado com confirmação", () => {
  const chamado = { stage: "chamado", theme: 3, invalid: 0, data: {} };
  const ask = nextStep(chamado, "cancelar chamado");
  assert.equal(ask.confirmCancel, true);
  assert.equal(ask.state.stage, "cancelar");
  const yes = nextStep(ask.state, "sim");
  assert.equal(yes.cancel, true);
  assert.equal(yes.state.stage, "encerrado");
  const no = nextStep(ask.state, "não");
  assert.equal(no.kept, true);
  assert.equal(no.state.stage, "chamado");
  const other = nextStep(ask.state, "na verdade quero mandar o atestado");
  assert.equal(other.append, true);
  assert.equal(other.state.stage, "chamado");
});

test("vários chamados concluídos de uma vez viram uma mensagem só", () => {
  assert.equal(ticketsClosedText(["FRZ-1"]), ticketClosedText("FRZ-1"));
  const t = ticketsClosedText(["FRZ-1", "FRZ-2", "FRZ-3"], { survey: true });
  assert.match(t, /chamados nº \*\*FRZ-1\*\*, \*\*FRZ-2\*\* e \*\*FRZ-3\*\* foram atendidos/);
  assert.match(t, /nota de \*\*1\*\* a \*\*5\*\*/);
});

test("áudio no começo, no menu ou depois de encerrado vira chamado com o áudio", () => {
  for (const state of [null, { stage: "menu", data: {} }, { stage: "encerrado", data: {} }, { stage: "pesquisa", data: {} }]) {
    const r = nextStep(state, "", { hasAttachment: true, hasAudio: true });
    assert.equal(r.open, true, state?.stage ?? "início");
    assert.equal(r.state.theme, 0);
  }
  assert.equal(nextStep({ stage: "pesquisa", data: {} }, "5", { hasAttachment: false }).rate, 5);
});

test("áudio nos dados pessoais pede para digitar, sem perder a etapa", () => {
  const state = { stage: "doc_cpf", theme: 1, data: { attempts: 0 } };
  const r = nextStep(state, "", { hasAttachment: true, hasAudio: true });
  assert.equal(r.state.stage, "doc_cpf");
  assert.match(r.reply, /digite\*\* o seu \*\*CPF/);
  assert.match(nextStep({ stage: "doc_mes", theme: 2, data: {} }, "", { hasAttachment: true, hasAudio: true }).reply, /mês/);
});

test("áudio no meio do chamado entra no chamado", () => {
  assert.equal(nextStep({ stage: "chamado", data: {} }, "", { hasAttachment: true, hasAudio: true }).append, true);
  assert.equal(nextStep({ stage: "tema", theme: 3, data: {} }, "", { hasAttachment: true, hasAudio: true }).open, true);
});

test("resumo diário: dia útil, depois da hora, uma vez por dia", () => {
  const at = (iso) => Date.parse(iso);
  // Sexta, 20/11/2026, 07:59 em MS (UTC-4): ainda não.
  assert.equal(digestDay(at("2026-11-20T11:59:00Z")), null);
  assert.equal(digestDay(at("2026-11-20T12:00:00Z")), "2026-11-20");
  assert.equal(digestDay(at("2026-11-20T18:00:00Z"), { lastDay: "2026-11-20" }), null);
  // Sábado e feriado: não sai.
  assert.equal(digestDay(at("2026-11-21T13:00:00Z")), null);
  assert.equal(digestDay(at("2026-11-20T13:00:00Z"), { holidays: ["2026-11-20"] }), null);
  // 23h em MS ainda é o mesmo dia local (03h UTC do dia seguinte).
  assert.equal(digestDay(at("2026-11-20T03:30:00Z"), { lastDay: "2026-11-19" }), null);
  assert.equal(digestDay(at("2026-11-21T02:30:00Z"), { lastDay: "2026-11-19" }), "2026-11-20");
});
