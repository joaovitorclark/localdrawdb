# Modo app (Edge) e atalho de Desktop no pacote Windows — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o `LocalDrawDB.exe` do pacote Windows abrir a UI numa janela do Edge em modo app (sem barra de endereço/abas, com ícone próprio) e criar um atalho de Desktop na primeira execução — sem instalação nova e sem admin.

**Architecture:** Um módulo novo (`scripts/build-win/edgeAppMode.mjs`) concentra três responsabilidades puras e testáveis fora do Windows: localizar o `msedge.exe`, montar/disparar a janela em modo app (com fallback pro navegador padrão), e garantir o atalho `.lnk` via PowerShell. O `launcherSrc.mjs` troca a única linha que hoje faz `exec('start ...')` por chamadas a esse módulo. Nada em `server/` ou `src/` muda — a única alteração fora de `scripts/build-win/` é uma tag `<link rel="icon">` em `index.html`.

**Tech Stack:** Node.js (ESM, só built-ins: `child_process`, `fs`, `path`, `zlib`), Vitest, PowerShell/`WScript.Shell` COM (runtime Windows), esbuild + Node SEA (pipeline de build já existente).

---

## Desvios da spec (aprovar ou rejeitar antes de começar)

Dois pontos foram refinados ao aterrissar a spec em código real. Ambos são
melhorias, mas divergem do texto aprovado em
`docs/superpowers/specs/2026-08-13-windows-edge-app-mode-design.md`:

1. **Local do ícone.** A spec previa `scripts/build-win/assets/icon.ico` +
   um passo novo em `build.mjs` copiando o arquivo pro pacote. O plano usa
   **`public/favicon.ico` como fonte única**: o Vite já copia `public/` pra
   `dist/` automaticamente, e o `bundleServer.mjs` já copia `dist/` pro
   pacote — então o ícone chega em `<pacote>/dist/favicon.ico` sem nenhuma
   mudança em `build.mjs` e sem um segundo binário no repositório. O atalho
   aponta pra esse caminho.
2. **Nome/semântica do marcador.** A spec chamava
   `data/.desktop-shortcut-created`. O plano usa
   **`data/.desktop-shortcut-attempted`**, gravado tanto no sucesso quanto na
   falha. Motivo: num ambiente com política de grupo restrita (justamente o
   cenário de risco listado na spec) a criação falha sempre, e um marcador
   só-em-sucesso faria o launcher gastar um spawn de PowerShell (~0,5s) em
   *toda* execução, pra sempre. Trade-off aceito: uma falha transitória não
   é retentada automaticamente — o usuário pode apagar o marcador.

Se qualquer um dos dois for rejeitado, ajustar a Task correspondente antes de
executar.

## Global Constraints

- **Escopo de arquivos:** nenhuma mudança em `server/` nem em `src/`. Só
  `scripts/build-win/`, mais `index.html` e `public/favicon.ico`.
- **Sem dependências novas:** nem em `dependencies` nem em `devDependencies`.
  Só built-ins do Node e ferramentas que já vêm no Windows (`reg`,
  `powershell.exe`).
- **Sem admin:** nenhuma etapa pode exigir elevação de privilégio.
- **Portabilidade:** nada é escrito fora da pasta portátil, exceto o atalho
  `.lnk` na Área de Trabalho.
- **Testes rodam em qualquer SO:** os testes automatizados não podem depender
  de Windows real — toda I/O de plataforma entra por injeção de dependência
  (mesmo padrão de `bundleServer({ execImpl })` e
  `buildWindowsPackage({ ensureNodePortableImpl })`).
- **Caminhos com `path.join`:** nunca `\` hardcoded, inclusive nos testes —
  eles rodam em macOS/Linux no CI de dev.
- **Idioma:** comentários, mensagens de log e nomes de teste em português,
  seguindo o repositório. Comentários explicam o *porquê*, não o *quê*.
- **Falha nunca bloqueia o boot:** erro em detecção de Edge ou criação de
  atalho vira `console.warn`, jamais exceção que derrube o launcher.
- **Baseline:** `npx vitest run scripts/build-win` passa hoje (13 testes).
  Deve continuar passando ao fim de cada task.

---

### Task 1: Ícone placeholder e favicon

Gera um `.ico` multi-resolução sem dependência externa e liga ele à SPA. É a
base das Tasks 4 e 5 (o atalho aponta pra esse arquivo).

**Files:**
- Create: `scripts/build-win/makeIcon.mjs`
- Create: `public/favicon.ico` (gerado pelo script acima, commitado)
- Create: `scripts/build-win/__tests__/appIcon.test.mjs`
- Modify: `index.html:6-7`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: o arquivo `public/favicon.ico`, que o Vite copia pra
  `dist/favicon.ico` e, via `bundleServer.mjs`, pra `<pacote>/dist/favicon.ico`.
  A Task 4 lê esse caminho como `IconLocation` do atalho.

- [ ] **Step 1: Escrever o teste que falha**

Cria `scripts/build-win/__tests__/appIcon.test.mjs`:

```js
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ICON_PATH = path.join(ROOT, 'public', 'favicon.ico');

describe('ícone da aplicação', () => {
  it('public/favicon.ico é um ICO válido com múltiplas resoluções', async () => {
    const buf = await fs.readFile(ICON_PATH);
    // Cabeçalho ICONDIR: reserved=0, type=1 (ícone), count=N.
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(1);
    const count = buf.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(4);

    // Cada ICONDIRENTRY tem 16 bytes; offset+tamanho precisam caber no arquivo,
    // senão o Windows mostra o ícone genérico em vez de falhar visivelmente.
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16;
      const bytes = buf.readUInt32LE(entry + 8);
      const offset = buf.readUInt32LE(entry + 12);
      expect(bytes).toBeGreaterThan(0);
      expect(offset + bytes).toBeLessThanOrEqual(buf.length);
    }
  });

  it('index.html referencia o favicon', async () => {
    const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('/favicon.ico');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run scripts/build-win/__tests__/appIcon.test.mjs`
Expected: FAIL — `ENOENT: no such file or directory ... public/favicon.ico`

- [ ] **Step 3: Escrever o gerador de ícone**

Cria `scripts/build-win/makeIcon.mjs`. Este script roda **uma vez** (não faz
parte do `build:win`); o `.ico` resultante é commitado.

```js
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
```

- [ ] **Step 4: Rodar o gerador**

Run: `node scripts/build-win/makeIcon.mjs`
Expected: imprime `Ícone gerado: .../public/favicon.ico`

Confirmar que o arquivo é um ICO válido:

Run: `file public/favicon.ico`
Expected: `MS Windows icon resource - 4 icons, 16x16 ...`

- [ ] **Step 5: Adicionar o favicon no index.html**

Em `index.html`, logo depois da linha `<meta name="viewport" ...>`, inserir:

```html
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
```

O bloco `<head>` fica assim:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <title>LocalDrawDB — modelador de lakehouse</title>
  </head>
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run scripts/build-win/__tests__/appIcon.test.mjs`
Expected: PASS (2 testes)

- [ ] **Step 7: Commit**

```bash
git add scripts/build-win/makeIcon.mjs public/favicon.ico index.html scripts/build-win/__tests__/appIcon.test.mjs
git commit -m "feat(build-win): ícone placeholder da aplicação + favicon na SPA"
```

---

### Task 2: Detecção do Edge (`findEdgePath`)

Localiza o `msedge.exe` por caminho conhecido e, em último caso, pelo
registro do Windows. Toda I/O entra por injeção, então roda em macOS/Linux.

**Files:**
- Create: `scripts/build-win/edgeAppMode.mjs`
- Create: `scripts/build-win/__tests__/edgeAppMode.test.mjs`

**Interfaces:**
- Consumes: nada da Task 1.
- Produces:
  - `parseRegistryCommand(output: string | null): string | null` — extrai o
    caminho do executável da saída do `reg query`.
  - `findEdgePath(opts?: { env?: object, fileExists?: (p: string) => Promise<boolean>, queryRegistry?: () => Promise<string | null> }): Promise<string | null>`
    — caminho absoluto do `msedge.exe`, ou `null`.

- [ ] **Step 1: Escrever os testes que falham**

Cria `scripts/build-win/__tests__/edgeAppMode.test.mjs`:

```js
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findEdgePath, parseRegistryCommand } from '../edgeAppMode.mjs';

// Caminhos montados com path.join: estes testes rodam em macOS/Linux, onde o
// separador não é `\`.
const PF_X86 = path.join('C:', 'Program Files (x86)');
const PF = path.join('C:', 'Program Files');
const EDGE_SUFFIX = path.join('Microsoft', 'Edge', 'Application', 'msedge.exe');
const EDGE_IN_X86 = path.join(PF_X86, EDGE_SUFFIX);
const EDGE_IN_PF = path.join(PF, EDGE_SUFFIX);

const ENV = { 'ProgramFiles(x86)': PF_X86, ProgramFiles: PF };

describe('parseRegistryCommand', () => {
  it('extrai o caminho entre aspas da saída do reg query', () => {
    const output = [
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Microsoft Edge\\shell\\open\\command',
      '    (Default)    REG_SZ    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
      '',
    ].join('\r\n');
    expect(parseRegistryCommand(output)).toBe(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  });

  it('descarta argumentos que acompanham o executável', () => {
    const output =
      '    (Default)    REG_SZ    "C:\\Edge\\msedge.exe" --single-argument %1';
    expect(parseRegistryCommand(output)).toBe('C:\\Edge\\msedge.exe');
  });

  it('devolve null para saída vazia ou sem REG_SZ', () => {
    expect(parseRegistryCommand(null)).toBeNull();
    expect(parseRegistryCommand('')).toBeNull();
    expect(parseRegistryCommand('ERRO: nao foi possivel encontrar a chave')).toBeNull();
  });
});

describe('findEdgePath', () => {
  it('prefere Program Files (x86) — onde o Edge stable instala mesmo em Windows 64-bit', async () => {
    const fileExists = vi.fn(async (p) => p === EDGE_IN_X86 || p === EDGE_IN_PF);
    const queryRegistry = vi.fn();

    const found = await findEdgePath({ env: ENV, fileExists, queryRegistry });

    expect(found).toBe(EDGE_IN_X86);
    // Achou por caminho conhecido: não paga o custo de consultar o registro.
    expect(queryRegistry).not.toHaveBeenCalled();
  });

  it('cai para Program Files quando não existe em (x86)', async () => {
    const fileExists = vi.fn(async (p) => p === EDGE_IN_PF);
    const found = await findEdgePath({ env: ENV, fileExists, queryRegistry: vi.fn() });
    expect(found).toBe(EDGE_IN_PF);
  });

  it('consulta o registro quando nenhum caminho conhecido existe', async () => {
    const fromRegistry = path.join('D:', 'Edge', 'msedge.exe');
    const fileExists = vi.fn(async (p) => p === fromRegistry);
    const queryRegistry = vi.fn(async () => `    (Default)    REG_SZ    "${fromRegistry}"`);

    const found = await findEdgePath({ env: ENV, fileExists, queryRegistry });

    expect(found).toBe(fromRegistry);
    expect(queryRegistry).toHaveBeenCalledTimes(1);
  });

  it('devolve null quando o registro aponta para um arquivo inexistente', async () => {
    const fileExists = vi.fn(async () => false);
    const queryRegistry = vi.fn(async () => '    (Default)    REG_SZ    "C:\\sumiu\\msedge.exe"');

    expect(await findEdgePath({ env: ENV, fileExists, queryRegistry })).toBeNull();
  });

  it('devolve null sem quebrar quando o ambiente não tem as variáveis do Windows', async () => {
    const fileExists = vi.fn(async () => false);
    const queryRegistry = vi.fn(async () => null);

    expect(await findEdgePath({ env: {}, fileExists, queryRegistry })).toBeNull();
    // env vazio: nenhum candidato conhecido pra testar.
    expect(fileExists).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run scripts/build-win/__tests__/edgeAppMode.test.mjs`
Expected: FAIL — `Failed to load ... edgeAppMode.mjs` (módulo não existe)

- [ ] **Step 3: Implementar a detecção**

Cria `scripts/build-win/edgeAppMode.mjs`:

```js
// Abertura da UI em janela de aplicativo (Edge `--app=`) e atalho de Desktop.
// Só é usado pelo pacote Windows (launcherSrc.mjs) — `npm run dev`, `./ldb` e
// `npm start` não passam por aqui.
//
// Todo acesso a plataforma (filesystem, registro, spawn) entra por injeção de
// dependência, como em bundleServer({ execImpl }): é o que permite testar a
// lógica em macOS/Linux, onde não há Edge nem `reg`.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const EDGE_SUFFIX = path.join('Microsoft', 'Edge', 'Application', 'msedge.exe');
const REGISTRY_KEY =
  'HKLM\\SOFTWARE\\Clients\\StartMenuInternet\\Microsoft Edge\\shell\\open\\command';

async function defaultFileExists(p) {
  return fs
    .stat(p)
    .then((s) => s.isFile())
    .catch(() => false);
}

function defaultQueryRegistry() {
  return new Promise((resolve) => {
    // Nunca rejeita: chave ausente, `reg` fora do PATH ou política restritiva
    // são todos "não achei", não erro fatal — quem chama só quer um caminho
    // ou null.
    execFile('reg', ['query', REGISTRY_KEY, '/ve'], { timeout: 5_000 }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

/**
 * Extrai o executável da saída do `reg query`. A linha de valor vem como
 * `    (Default)    REG_SZ    "C:\...\msedge.exe" --single-argument %1`.
 */
export function parseRegistryCommand(output) {
  if (!output) return null;
  const match = output.match(/REG_SZ\s+(.+)/);
  if (!match) return null;
  const raw = match[1].trim();
  // O caminho vem entre aspas justamente porque contém espaços
  // ("Program Files"); só quando não vier é que dá pra cortar nos argumentos.
  const quoted = raw.match(/^"([^"]+)"/);
  const exe = quoted ? quoted[1] : raw.split(/\s+--/)[0].trim();
  return exe || null;
}

/** Caminho absoluto do msedge.exe, ou null se não houver Edge utilizável. */
export async function findEdgePath({
  env = process.env,
  fileExists = defaultFileExists,
  queryRegistry = defaultQueryRegistry,
} = {}) {
  // (x86) primeiro: o Edge stable instala em "Program Files (x86)" mesmo em
  // Windows 64-bit. LOCALAPPDATA cobre a instalação por usuário (sem admin).
  const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  for (const base of bases) {
    const candidate = path.join(base, EDGE_SUFFIX);
    if (await fileExists(candidate)) return candidate;
  }

  const fromRegistry = parseRegistryCommand(await queryRegistry());
  if (fromRegistry && (await fileExists(fromRegistry))) return fromRegistry;

  return null;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run scripts/build-win/__tests__/edgeAppMode.test.mjs`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-win/edgeAppMode.mjs scripts/build-win/__tests__/edgeAppMode.test.mjs
git commit -m "feat(build-win): detecção do msedge.exe por caminho conhecido e registro"
```

---

### Task 3: Abrir em modo app com fallback (`buildAppModeArgs`, `openApp`)

Dispara a janela do Edge em modo app; sem Edge (ou se o spawn falhar), cai no
comportamento atual de abrir o navegador padrão.

**Files:**
- Modify: `scripts/build-win/edgeAppMode.mjs` (acrescenta ao módulo da Task 2)
- Modify: `scripts/build-win/__tests__/edgeAppMode.test.mjs` (acrescenta blocos)

**Interfaces:**
- Consumes: `findEdgePath` da Task 2.
- Produces:
  - `buildAppModeArgs({ url: string, profileDir: string }): string[]`
  - `openApp(opts): Promise<{ mode: 'edge-app' | 'default-browser', edgePath: string | null }>`
    onde `opts` é `{ url, launcherDir, findEdgePathImpl?, spawnImpl?, fallbackOpen?, logger? }`.
    A Task 5 chama `openApp({ url, launcherDir })`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `scripts/build-win/__tests__/edgeAppMode.test.mjs`.
Atualizar também a linha de import no topo do arquivo para:

```js
import { buildAppModeArgs, findEdgePath, openApp, parseRegistryCommand } from '../edgeAppMode.mjs';
```

Novos blocos:

```js
// Dublê de ChildProcess: registra unref/handlers sem spawnar nada de verdade.
function fakeChild() {
  const handlers = {};
  return {
    unref: vi.fn(),
    on: vi.fn((event, fn) => {
      handlers[event] = fn;
    }),
    emit: (event, arg) => handlers[event]?.(arg),
  };
}

describe('buildAppModeArgs', () => {
  it('monta os argumentos de janela de aplicativo com perfil isolado', () => {
    const profileDir = path.join('C:', 'LocalDrawDB', 'data', 'edge-profile');
    const args = buildAppModeArgs({ url: 'http://127.0.0.1:5174', profileDir });

    expect(args).toEqual([
      '--app=http://127.0.0.1:5174',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ]);
  });
});

describe('openApp', () => {
  const launcherDir = path.join('C:', 'LocalDrawDB');
  const url = 'http://127.0.0.1:5174';

  it('abre o Edge em modo app quando o Edge existe', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const fallbackOpen = vi.fn();

    const result = await openApp({
      url,
      launcherDir,
      findEdgePathImpl: async () => EDGE_IN_X86,
      spawnImpl,
      fallbackOpen,
      logger: { warn: vi.fn() },
    });

    expect(result).toEqual({ mode: 'edge-app', edgePath: EDGE_IN_X86 });
    expect(fallbackOpen).not.toHaveBeenCalled();

    const [exe, args, opts] = spawnImpl.mock.calls[0];
    expect(exe).toBe(EDGE_IN_X86);
    expect(args).toContain(`--app=${url}`);
    // Perfil dentro da pasta portátil: nada em %LOCALAPPDATA%.
    expect(args).toContain(
      `--user-data-dir=${path.join(launcherDir, 'data', 'edge-profile')}`,
    );
    // detached + unref: fechar o launcher não pode arrastar a janela junto.
    expect(opts).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(child.unref).toHaveBeenCalled();
  });

  it('cai no navegador padrão quando não há Edge', async () => {
    const spawnImpl = vi.fn();
    const fallbackOpen = vi.fn();
    const logger = { warn: vi.fn() };

    const result = await openApp({
      url,
      launcherDir,
      findEdgePathImpl: async () => null,
      spawnImpl,
      fallbackOpen,
      logger,
    });

    expect(result).toEqual({ mode: 'default-browser', edgePath: null });
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(fallbackOpen).toHaveBeenCalledWith(url);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('cai no navegador padrão quando o Edge existe mas falha ao subir', async () => {
    const child = fakeChild();
    const fallbackOpen = vi.fn();
    const logger = { warn: vi.fn() };

    await openApp({
      url,
      launcherDir,
      findEdgePathImpl: async () => EDGE_IN_X86,
      spawnImpl: () => child,
      fallbackOpen,
      logger,
    });

    // spawn reporta falha de execução de forma assíncrona, via evento 'error'.
    expect(fallbackOpen).not.toHaveBeenCalled();
    child.emit('error', new Error('EACCES'));
    expect(fallbackOpen).toHaveBeenCalledWith(url);
    expect(logger.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run scripts/build-win/__tests__/edgeAppMode.test.mjs`
Expected: FAIL — `buildAppModeArgs is not a function` / `openApp is not a function`

- [ ] **Step 3: Implementar**

Em `scripts/build-win/edgeAppMode.mjs`, trocar a linha de import de
`child_process` por:

```js
import { exec, execFile, spawn } from 'node:child_process';
```

E acrescentar ao final do arquivo:

```js
function defaultFallbackOpen(url) {
  // Mesmo comando que o launcher usava antes do modo app. As aspas vazias são
  // o *título* que o `start` do cmd.exe exige antes de um alvo entre aspas.
  exec(`start "" "${url}"`);
}

/**
 * Argumentos da janela de aplicativo: sem barra de endereço nem abas, com
 * perfil próprio dentro da pasta portátil (não toca no Edge do usuário) e sem
 * as telas de boas-vindas/navegador padrão, que apareceriam em todo primeiro
 * uso por causa justamente do perfil novo.
 */
export function buildAppModeArgs({ url, profileDir }) {
  return [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

/**
 * Abre a UI em janela de aplicativo do Edge; sem Edge utilizável, abre o
 * navegador padrão (comportamento anterior). Nunca lança: perder o modo app é
 * degradação de experiência, não motivo pra derrubar o launcher.
 */
export async function openApp({
  url,
  launcherDir,
  findEdgePathImpl = findEdgePath,
  spawnImpl = spawn,
  fallbackOpen = defaultFallbackOpen,
  logger = console,
} = {}) {
  const edgePath = await findEdgePathImpl();

  if (!edgePath) {
    logger.warn(
      '[LocalDrawDB] Microsoft Edge não encontrado — abrindo no navegador padrão (sem janela de aplicativo).',
    );
    fallbackOpen(url);
    return { mode: 'default-browser', edgePath: null };
  }

  const profileDir = path.join(launcherDir, 'data', 'edge-profile');
  const child = spawnImpl(edgePath, buildAppModeArgs({ url, profileDir }), {
    detached: true,
    stdio: 'ignore',
  });

  // O Edge pode existir e ainda assim não subir (bloqueio de política, binário
  // corrompido). spawn reporta isso por evento assíncrono — sem este handler
  // seria uncaught exception, e o usuário ficaria sem janela nenhuma.
  child.on?.('error', (err) => {
    logger.warn(
      `[LocalDrawDB] Falha ao abrir o Edge (${err.message}) — abrindo no navegador padrão.`,
    );
    fallbackOpen(url);
  });
  child.unref?.();

  return { mode: 'edge-app', edgePath };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run scripts/build-win/__tests__/edgeAppMode.test.mjs`
Expected: PASS (12 testes)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-win/edgeAppMode.mjs scripts/build-win/__tests__/edgeAppMode.test.mjs
git commit -m "feat(build-win): abre a UI em janela de aplicativo do Edge, com fallback"
```

---

### Task 4: Atalho de Desktop (`ensureDesktopShortcut`)

Cria o `.lnk` na Área de Trabalho uma única vez, via PowerShell. Falha
silenciosa; nunca interrompe o boot.

**Files:**
- Modify: `scripts/build-win/edgeAppMode.mjs`
- Modify: `scripts/build-win/__tests__/edgeAppMode.test.mjs`

**Interfaces:**
- Consumes: o ícone em `<launcherDir>/dist/favicon.ico` (Task 1).
- Produces:
  - `ensureDesktopShortcut(opts): Promise<{ created: boolean, reason?: 'already-attempted' | 'error' }>`
    onde `opts` é `{ launcherDir, exePath?, execImpl?, logger? }`.
    A Task 5 chama `ensureDesktopShortcut({ launcherDir })`.

- [ ] **Step 1: Escrever os testes que falham**

Atualizar o import no topo de
`scripts/build-win/__tests__/edgeAppMode.test.mjs`:

```js
import {
  buildAppModeArgs,
  ensureDesktopShortcut,
  findEdgePath,
  openApp,
  parseRegistryCommand,
} from '../edgeAppMode.mjs';
```

Ainda no topo do arquivo, acrescentar dois imports de built-in e **substituir**
(não duplicar) a linha de import do Vitest, que passa a trazer os hooks de
ciclo de vida:

```js
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
```

E acrescentar ao final do arquivo:

```js
describe('ensureDesktopShortcut', () => {
  let launcherDir;

  beforeEach(async () => {
    // Diretório real em vez de fs mockado: o marcador é o núcleo do
    // comportamento aqui, e testá-lo contra o filesystem de verdade é mais
    // fiel do que espiar chamadas de writeFile.
    launcherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-shortcut-'));
    await fs.mkdir(path.join(launcherDir, 'data'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(launcherDir, { recursive: true, force: true });
  });

  const markerPath = () => path.join(launcherDir, 'data', '.desktop-shortcut-attempted');

  it('cria o atalho na primeira execução e grava o marcador', async () => {
    const execImpl = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const exePath = path.join(launcherDir, 'LocalDrawDB.exe');

    const result = await ensureDesktopShortcut({
      launcherDir,
      exePath,
      execImpl,
      logger: { warn: vi.fn() },
    });

    expect(result).toEqual({ created: true });
    expect(execImpl).toHaveBeenCalledTimes(1);

    const [cmd, args, opts] = execImpl.mock.calls[0];
    expect(cmd).toBe('powershell.exe');
    expect(args).toContain('-NoProfile');
    expect(args).toContain('-NonInteractive');
    // O caminho da Área de Trabalho é resolvido pelo próprio PowerShell —
    // é o que respeita redirecionamento (OneDrive, política de grupo).
    expect(args.at(-1)).toContain("GetFolderPath(\"Desktop\")");
    expect(args.at(-1)).toContain('LocalDrawDB.lnk');
    // Caminhos vão por env, não interpolados no script: evita quebrar (ou pior,
    // injetar) quando o caminho tem aspas, espaços ou `$`.
    expect(opts.env.LDB_TARGET).toBe(exePath);
    expect(opts.env.LDB_WORKDIR).toBe(launcherDir);
    expect(opts.env.LDB_ICON).toBe(path.join(launcherDir, 'dist', 'favicon.ico'));

    const markerExists = await fs.stat(markerPath()).then(() => true).catch(() => false);
    expect(markerExists).toBe(true);
  });

  it('não tenta de novo quando o marcador já existe', async () => {
    await fs.writeFile(markerPath(), 'já tentado', 'utf8');
    const execImpl = vi.fn();

    const result = await ensureDesktopShortcut({
      launcherDir,
      exePath: path.join(launcherDir, 'LocalDrawDB.exe'),
      execImpl,
      logger: { warn: vi.fn() },
    });

    expect(result).toEqual({ created: false, reason: 'already-attempted' });
    expect(execImpl).not.toHaveBeenCalled();
  });

  it('engole a falha do PowerShell, avisa e marca a tentativa', async () => {
    const execImpl = vi.fn(async () => {
      throw new Error('AccessDenied');
    });
    const logger = { warn: vi.fn() };

    const result = await ensureDesktopShortcut({
      launcherDir,
      exePath: path.join(launcherDir, 'LocalDrawDB.exe'),
      execImpl,
      logger,
    });

    expect(result).toEqual({ created: false, reason: 'error' });
    expect(logger.warn).toHaveBeenCalled();
    // Marca mesmo na falha: num Windows com política restritiva a criação
    // falha sempre, e sem o marcador o launcher pagaria um spawn de
    // PowerShell em toda execução, pra sempre.
    const markerExists = await fs.stat(markerPath()).then(() => true).catch(() => false);
    expect(markerExists).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run scripts/build-win/__tests__/edgeAppMode.test.mjs`
Expected: FAIL — `ensureDesktopShortcut is not a function`

- [ ] **Step 3: Implementar**

Em `scripts/build-win/edgeAppMode.mjs`, acrescentar ao topo (junto dos outros
imports):

```js
import { promisify } from 'node:util';
```

E acrescentar ao final do arquivo:

```js
const defaultExecFile = promisify(execFile);

// Criar .lnk exige o COM WScript.Shell — não há API de Node pra isso, e o
// PowerShell já vem em todo Windows (nada a instalar).
//
// Os caminhos chegam por variável de ambiente (`$env:LDB_*`) em vez de
// interpolados no script: caminho de usuário pode conter aspas, espaço ou `$`,
// que quebrariam (ou permitiriam injetar) um script montado por concatenação.
const SHORTCUT_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  // GetFolderPath respeita Área de Trabalho redirecionada (OneDrive, política
  // de grupo); montar o caminho na mão a partir de %USERPROFILE% não respeita.
  '$desktop = [Environment]::GetFolderPath("Desktop")',
  'if (-not $desktop) { throw "Area de Trabalho nao resolvida" }',
  '$lnk = Join-Path $desktop "LocalDrawDB.lnk"',
  '$shell = New-Object -ComObject WScript.Shell',
  '$s = $shell.CreateShortcut($lnk)',
  '$s.TargetPath = $env:LDB_TARGET',
  '$s.WorkingDirectory = $env:LDB_WORKDIR',
  '$s.IconLocation = $env:LDB_ICON',
  '$s.Description = "LocalDrawDB"',
  '$s.Save()',
].join('; ');

/**
 * Garante o atalho na Área de Trabalho, uma única vez por instalação.
 *
 * O marcador é `.desktop-shortcut-attempted` (tentativa), não a existência do
 * .lnk: se olhássemos o .lnk, apagar o atalho de propósito faria ele
 * reaparecer na execução seguinte. Depois da primeira tentativa, quem manda é
 * o usuário.
 */
export async function ensureDesktopShortcut({
  launcherDir,
  // Num binário SEA, process.execPath é o próprio LocalDrawDB.exe — que é
  // exatamente o alvo que o atalho deve apontar.
  exePath = process.execPath,
  execImpl = defaultExecFile,
  logger = console,
} = {}) {
  const dataDir = path.join(launcherDir, 'data');
  const marker = path.join(dataDir, '.desktop-shortcut-attempted');

  const alreadyAttempted = await fs
    .stat(marker)
    .then(() => true)
    .catch(() => false);
  if (alreadyAttempted) return { created: false, reason: 'already-attempted' };

  let result;
  try {
    await execImpl(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHORTCUT_SCRIPT],
      {
        timeout: 20_000,
        env: {
          ...process.env,
          LDB_TARGET: exePath,
          LDB_WORKDIR: launcherDir,
          LDB_ICON: path.join(launcherDir, 'dist', 'favicon.ico'),
        },
      },
    );
    result = { created: true };
  } catch (err) {
    logger.warn(
      `[LocalDrawDB] Não foi possível criar o atalho na Área de Trabalho: ${err.message}. ` +
        'O aplicativo funciona normalmente — se quiser, crie o atalho manualmente a partir de LocalDrawDB.exe.',
    );
    result = { created: false, reason: 'error' };
  }

  // Grava o marcador nos dois desfechos — ver comentário no doc-block.
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(marker, new Date().toISOString(), 'utf8');
  } catch {
    // Nem o marcador conseguiu ser gravado: pasta somente-leitura. Não há o
    // que fazer, e isto não pode virar erro de boot.
  }

  return result;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run scripts/build-win/__tests__/edgeAppMode.test.mjs`
Expected: PASS (15 testes)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-win/edgeAppMode.mjs scripts/build-win/__tests__/edgeAppMode.test.mjs
git commit -m "feat(build-win): atalho de Desktop criado uma vez, com falha silenciosa"
```

---

### Task 5: Ligar no launcher e documentar

Substitui o `exec('start ...')` do launcher e atualiza a documentação
(checklist manual + README principal). É o que torna a feature real.

**Files:**
- Modify: `scripts/build-win/launcherSrc.mjs:1-8` (imports) e `:97`
- Modify: `scripts/build-win/README.md` (checklist manual)
- Modify: `README.md` (seção "Distribuição Windows")

**Interfaces:**
- Consumes: `openApp` (Task 3) e `ensureDesktopShortcut` (Task 4).
- Produces: nada consumido por tasks posteriores (última task).

- [ ] **Step 1: Trocar a abertura do navegador no launcher**

Em `scripts/build-win/launcherSrc.mjs`, acrescentar o import depois da linha
`import { findFreePort, waitForPort } from '../devPorts.mjs';`:

```js
import { ensureDesktopShortcut, openApp } from './edgeAppMode.mjs';
```

Substituir a linha 97, que hoje é:

```js
  exec(`start "" "http://127.0.0.1:${port}"`);
```

por:

```js
  const url = `http://127.0.0.1:${port}`;
  // Janela de aplicativo primeiro: é o que o usuário está esperando ver.
  await openApp({ url, launcherDir });
  // Atalho depois, e só na primeira execução — a janela já está abrindo, então
  // o meio segundo do PowerShell não atrasa nada que o usuário perceba.
  await ensureDesktopShortcut({ launcherDir });
```

Remover `exec` do import de `node:child_process` no topo (linha 5), que passa
a ser:

```js
import { spawn } from 'node:child_process';
```

Atualizar também o comentário de cabeçalho do arquivo (linhas 1-3), que
descreve o comportamento antigo:

```js
// Fonte do launcher — bundlado (bundleLauncher.mjs) e depois transformado num
// .exe Windows via Node SEA (Task 4). Sobe o servidor local, espera responder,
// e abre a UI numa janela de aplicativo do Edge (fallback: navegador padrão).
// Fechar o processo encerra o servidor filho.
```

- [ ] **Step 2: Confirmar que o launcher ainda bundla**

O `edgeAppMode.mjs` só usa built-ins, então o bundle CJS do SEA continua
válido — o teste existente de `bundleLauncher` é quem verifica isso.

Run: `npx vitest run scripts/build-win`
Expected: PASS — os 13 testes originais + os 17 novos das Tasks 1-4

- [ ] **Step 3: Rodar a suíte completa e o typecheck**

Run: `npm test`
Expected: PASS, sem regressão em `server/` nem `src/`

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 4: Atualizar o checklist manual do pacote Windows**

Em `scripts/build-win/README.md`, acrescentar ao final da lista de
verificação manual (renumerando se necessário, e mantendo o estilo dos itens
já existentes):

```markdown
8. [ ] **Modo app (com Edge):** duplo-clique em `LocalDrawDB.exe` abre uma
   janela **sem barra de endereço e sem abas**, com ícone próprio na barra de
   tarefas.
9. [ ] **Fallback (sem Edge):** renomeie temporariamente a pasta
   `Microsoft\Edge\Application` (ou use uma VM sem Edge) e rode de novo — o
   app abre no navegador padrão, numa aba comum, com um aviso no console e
   **sem erro**.
10. [ ] **Atalho na Área de Trabalho:** a primeira execução cria
    `LocalDrawDB.lnk` na Área de Trabalho, com o ícone do app, e o duplo-clique
    nele abre o app igual ao `.exe`.
11. [ ] **Atalho não é recriado:** apague o `.lnk` e rode o app de novo — ele
    **não** reaparece (o marcador `data/.desktop-shortcut-attempted` já existe).
12. [ ] **Sem elevação:** nenhuma das etapas acima exibe prompt de UAC.
```

- [ ] **Step 5: Atualizar o README principal**

Em `README.md`, na seção "Distribuição Windows (sem instalar Node)", logo
depois do parágrafo que termina em "leva tudo junto.", inserir:

```markdown
O app abre numa **janela de aplicativo** (sem barra de endereço nem abas),
usando o Microsoft Edge que já vem no Windows — e cria um atalho na Área de
Trabalho na primeira execução. Se o Edge não estiver disponível, ele abre no
navegador padrão normalmente. Apagar o atalho não o faz voltar; para recriá-lo,
apague `data/.desktop-shortcut-attempted` e abra o app de novo.

A janela usa um perfil próprio do Edge em `data/edge-profile/` (não interfere
no seu Edge do dia a dia). Apagar essa pasta é seguro — ela é recriada no
próximo uso.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/build-win/launcherSrc.mjs scripts/build-win/README.md README.md
git commit -m "feat(build-win): launcher abre em modo app e garante atalho de Desktop"
```

- [ ] **Step 7: Verificação manual em Windows (antes do release)**

Esta etapa **não roda no ambiente de desenvolvimento** — exige VM/máquina
Windows real, como já é o caso do pacote hoje.

Run (em qualquer SO): `npm run build:win`
Expected: `Pacote gerado: .../dist-win/LocalDrawDB-win.zip`

Depois, na máquina Windows: extrair o zip e percorrer os itens 8-12 do
checklist de `scripts/build-win/README.md` acrescentados no Step 4.

---

## Cobertura da spec

| Requisito da spec | Onde é atendido |
|---|---|
| Detecção do `msedge.exe` (caminhos + registro) | Task 2 |
| Janela em modo app com perfil isolado | Task 3 |
| Fallback silencioso sem Edge | Task 3 |
| Falha do Edge ao subir → fallback | Task 3 (handler de `'error'`) |
| Atalho automático na primeira execução | Task 4 |
| Idempotência via marcador | Task 4 |
| Atalho apagado não reaparece | Task 4 (marcador de tentativa) |
| Falha de atalho é silenciosa | Task 4 |
| Ícone placeholder | Task 1 |
| Favicon em `index.html` | Task 1 |
| Nada muda fora do pacote Windows | Global Constraints + Task 5 |
| Checklist manual atualizado | Task 5 Step 4 |
| Critérios de aceitação 1-6 | Task 5 Step 7 (manual, Windows) |
| Critérios de aceitação 7-8 | Task 5 Step 3 (`npm test`, `npm run typecheck`) |
