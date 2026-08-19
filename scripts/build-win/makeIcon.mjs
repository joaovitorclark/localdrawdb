// Gera o .ico placeholder da aplicação sem dependência externa: monta PNGs
// RGBA na mão (zlib built-in) e embrulha num container ICO. Roda uma vez —
// o resultado é commitado em public/favicon.ico, não gerado a cada build.
//
// Uso: node scripts/build-win/makeIcon.mjs [caminho-de-saida]
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// 16/32 para barra de tarefas e Explorer; 48 para ícones grandes; 256 para
// a visualização extra-grande. Menos que isso faz o Windows escalar um
// bitmap pequeno e o resultado fica borrado.
const SIZES = [16, 32, 48, 256];

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

// Glifo: quadrado escuro de cantos arredondados com três "linhas de tabela"
// — cabeçalho cheio em ciano e duas linhas com a coluna-chave destacada,
// evocando o diagrama de entidades que o app edita.
function pixel(x, y, size) {
  const u = x / size;
  const v = y / size;
  const BG = [17, 24, 39, 255];
  const FG = [56, 189, 248, 255];
  const DIM = [30, 41, 59, 255];

  const r = 0.18;
  const dx = Math.min(u, 1 - u);
  const dy = Math.min(v, 1 - v);
  if (dx < r && dy < r && Math.hypot(r - dx, r - dy) > r) return [0, 0, 0, 0];

  const bars = [
    [0.18, 0.34],
    [0.42, 0.58],
    [0.66, 0.82],
  ];
  for (const [top, bottom] of bars) {
    if (v >= top && v <= bottom && u >= 0.18 && u <= 0.82) {
      return top < 0.2 ? FG : u < 0.34 ? FG : DIM;
    }
  }
  return BG;
}

function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filtro None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profundidade de bit
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function makeIco(sizes = SIZES) {
  const images = sizes.map(makePng);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map((png, i) => {
    const size = sizes[i];
    const e = Buffer.alloc(16);
    // 256 é representado por 0 no campo de 1 byte (limite do formato ICO).
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images]);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outPath = process.argv[2] ?? path.join(ROOT, 'public', 'favicon.ico');
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, makeIco());
console.log(`Ícone gerado: ${outPath}`);
