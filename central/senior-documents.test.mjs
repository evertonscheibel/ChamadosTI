import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { holeritePdf, espelhoPdf, hhmm } from "./senior-documents.mjs";
import { textWidth } from "./pdf.mjs";

const person = { NOMFUN: "MARIA DA SILVA EXEMPLO", NUMCAD: "1234" };
const holerite = {
  events: [
    { code: "1", description: "Horas Normais", type: 1, reference: "220.00", cents: 250000 },
    { code: "250", description: "Horas Extras 50%", type: 1, reference: "10.5", cents: 17890 },
    { code: "900", description: "INSS", type: 3, reference: "9.00", cents: 22500 },
    { code: "910", description: "Vale Transporte", type: 3, reference: "6.00", cents: 15000 },
    { code: "990", description: "Base FGTS", type: 4, reference: "", cents: 267890 },
  ],
  totals: { earnings: 267890, deductions: 37500, net: 230390 },
  paymentDate: "05/11/2026",
};
const ponto = {
  marks: [
    { DATAPU: "03/11/2026", HORACC: "420" },
    { DATAPU: "03/11/2026", HORACC: "1020" },
    { DATAPU: "03/11/2026", HORACC: "720" },
    { DATAPU: "03/11/2026", HORACC: "780" },
  ],
  situations: [
    { DATAPU: "03/11/2026", CODSIT: "1", QTDHOR: "528" },
    { DATAPU: "04/11/2026", CODSIT: "401", QTDHOR: "30" },
    { DATAPU: "04/11/2026", CODSIT: "1", QTDHOR: "498" },
  ],
};

test("holerite em PDF válido, com nome, eventos e líquido", () => {
  const pdf = holeritePdf(holerite, person, "2026-10");
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.match(text, /MARIA DA SILVA EXEMPLO/);
  assert.match(text, /L\xedquido a receber/); // "í" em WinAnsi
  assert.match(text, /R\$\s2\.303,90/);
  if (process.env.PDF_SAMPLE_DIR) writeFileSync(`${process.env.PDF_SAMPLE_DIR}/holerite-exemplo.pdf`, pdf);
});

test("espelho em PDF agrupa por dia, converte minutos e usa a descrição da situação", () => {
  const pdf = espelhoPdf(ponto, person, "2026-11", { 1: "Trabalhando", 401: "Banco de Horas Débito" });
  const text = pdf.toString("latin1");
  assert.match(text, /07:00  12:00  13:00  17:00/);
  assert.match(text, /Banco de Horas D\xe9bito 00:30/);
  if (process.env.PDF_SAMPLE_DIR) writeFileSync(`${process.env.PDF_SAMPLE_DIR}/espelho-exemplo.pdf`, pdf);
});

test("muitos dias quebram em mais de uma página", () => {
  const situations = Array.from({ length: 60 }, (_, i) => ({
    DATAPU: `${String((i % 28) + 1).padStart(2, "0")}/${i < 28 ? "09" : i < 56 ? "10" : "11"}/2026`,
    CODSIT: String(i),
    QTDHOR: "60",
  }));
  const text = espelhoPdf({ marks: [], situations }, person, "2026-10").toString("latin1");
  assert.match(text, /\/Count [2-9]/);
});

test("minutos viram HH:MM", () => {
  assert.deepEqual(["420", "1020", "5", "07:30", "x"].map(hhmm), ["07:00", "17:00", "00:05", "07:30", "x"]);
  assert.ok(textWidth("1234", 10) > 0);
});
