import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
    ["1", "2.", "opção 3", "4)", "0", "10", "11", "12", "esqueci de bater o ponto", "quero meu holerite", "espelho", "ok"].map(parseOption),
    [1, 2, 3, 4, 0, 10, 11, null, 3, 1, 2, null],
  );
});

test("fluxo: menu, opção inválida, assunto e abertura do chamado", () => {
  let step = nextStep(null, "oi");
  assert.equal(step.reply, menuText());
  step = nextStep(step.state, "quero saber");
  assert.match(step.reply, /Não entendi/);
  step = nextStep(step.state, "7");
  assert.match(step.reply, /Férias/);
  assert.deepEqual(step.state, { stage: "tema", theme: 7, invalid: 0, data: {} });
  step = nextStep(step.state, "Everton, TI. 10/11 entrada 07:00");
  assert.equal(step.open, true);
  assert.equal(step.state.stage, "chamado");
  assert.equal(nextStep(step.state, "mais uma coisa").append, true);
  assert.equal(nextStep({ stage: "encerrado" }, "oi").reply, menuText());
});

test("cumprimento no lugar dos dados repete o pedido e não abre chamado", () => {
  const state = { stage: "tema", theme: 11, invalid: 0 };
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
  assert.match(menu, /🔟 Rescisão/);
  assert.match(menu, /1️⃣1️⃣ Vagas e currículo/);
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
  assert.deepEqual(nextStep(state, "oi"), { state, remind: true });
  assert.deepEqual(nextStep(state, "Olá!"), { state, remind: true });
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
