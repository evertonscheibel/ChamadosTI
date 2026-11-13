// Gerador mínimo de PDF (A4, texto e linhas), sem dependências.
// Fontes padrão Helvetica/Helvetica-Bold com WinAnsiEncoding (acentos do português).
// Coordenadas em pontos com origem no canto SUPERIOR esquerdo (y cresce para baixo).

export const A4 = { width: 595.28, height: 841.89 };

// Larguras Helvetica (1/1000 em) dos caracteres mais usados; o resto usa a média.
const WIDTHS = {
  " ": 278, ".": 278, ",": 278, ":": 278, ";": 278, "-": 333, "/": 278, "(": 333, ")": 333,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  "R": 722, "$": 556, "%": 889, "º": 365, "ª": 370,
  i: 222, l: 222, j: 222, f: 278, t: 278, r: 333, I: 278, m: 833, w: 722, M: 833, W: 944,
};
export function textWidth(text, size) {
  let units = 0;
  for (const ch of String(text)) units += WIDTHS[ch] ?? (ch === ch.toUpperCase() && /\p{L}/u.test(ch) ? 667 : 556);
  return (units * size) / 1000;
}

// Unicode -> byte WinAnsi (cp1252). Latin-1 passa direto; alguns sinais têm posição própria.
const CP1252 = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97 };
function encode(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const code = CP1252[ch] ?? ch.codePointAt(0);
    const byte = CP1252[ch] ?? (code < 256 ? code : 0x3f);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c);
    bytes.push(byte);
  }
  return Buffer.from(bytes).toString("latin1");
}

export class Pdf {
  constructor() {
    this.pages = [];
    this.addPage();
  }
  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
    return this;
  }
  /** Texto com y = linha de base, medido do topo. align: left | right | center. */
  text(x, y, value, { size = 10, bold = false, align = "left", gray = 0 } = {}) {
    const w = textWidth(value, size);
    const left = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    this.ops.push(`${gray} g BT /${bold ? "F2" : "F1"} ${size} Tf ${left.toFixed(2)} ${(A4.height - y).toFixed(2)} Td (${encode(value)}) Tj ET`);
    return this;
  }
  line(x1, y1, x2, y2, { width = 0.5, gray = 0.6 } = {}) {
    this.ops.push(`${gray} G ${width} w ${x1.toFixed(2)} ${(A4.height - y1).toFixed(2)} m ${x2.toFixed(2)} ${(A4.height - y2).toFixed(2)} l S`);
    return this;
  }
  rect(x, y, w, h, { fill = 0.93 } = {}) {
    this.ops.push(`${fill} g ${x.toFixed(2)} ${(A4.height - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    return this;
  }
  /** Quebra um texto em linhas que caibam em `width`. */
  static wrap(value, width, size) {
    const lines = [];
    let current = "";
    for (const word of String(value).split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (textWidth(next, size) <= width || !current) current = next;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
  toBuffer({ title = "Documento" } = {}) {
    const objects = [];
    const add = (body) => objects.push(body) && objects.length;
    const catalog = add(null);
    const pagesId = add(null);
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const info = add(`<< /Title (${encode(title)}) /Producer (Central de Relacionamento Frizelo) >>`);
    const kids = [];
    for (const ops of this.pages) {
      const stream = ops.join("\n");
      const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
        ),
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}
