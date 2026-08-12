# Pacote portátil Windows (Spec B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `npm run build:win`, que gera `dist-win/LocalDrawDB-win.zip` — um pacote portátil Windows (Node embutido + servidor bundlado + build do Vite + launcher `.exe` real) que roda sem instalador e sem admin, conforme a [Spec B](../specs/2026-08-04-windows-portable-package-design.md).

**Architecture:** Um script de build (`scripts/build-win/build.mjs`) orquestra quatro etapas independentes — baixar/cachear o Node.js portátil win-x64, bundlar `server/index.ts` com esbuild (código próprio bundlado, dependências de `node_modules` mantidas externas e copiadas à parte — decisão validada empiricamente, ver "Descobertas técnicas"), buildar o launcher (bundlado e depois transformado num `.exe` Windows via Node Single Executable Applications + `postject`, o que funciona cross-platform a partir do macOS/Linux), e montar/zipar a estrutura final. `gitAvailable` em `/api/meta` já existe (Spec A, Task 6) — nada a fazer ali.

**Tech Stack:** Node.js 22 (mesma versão do `.nvmrc`), esbuild (novo devDependency — já presente transitivamente via Vite, mas precisa ser explícito e ter CLI estável), `extract-zip` (novo devDependency, extração de zip pura-JS), `postject` (novo devDependency, injeção de binário para SEA), `archiver` (novo devDependency, para zipar o pacote final).

## Global Constraints

- Todos os testes automatizados devem rodar em **qualquer SO de dev** (não dependem de Windows) — só o binário `.exe` final não pode ser *executado* fora do Windows; tudo antes disso (bundling, geração do blob SEA, injeção via `postject`) é verificável no Mac/Linux.
- `npm test` e `npm run typecheck` continuam verdes do início ao fim (suíte atual: 84 arquivos / 614 testes).
- Reaproveitar `scripts/devPorts.mjs` (`findFreePort`, `waitForPort`) no launcher — não duplicar essa lógica.
- Não modificar nenhum arquivo de `server/`, `src/` além do necessário para o `README.md`. `gitAvailable` em `/api/meta` já existe — não recriar.
- Node.js portátil embutido: versão pinada **22.11.0** (LTS) — não "latest", para builds reprodutíveis (revisar/atualizar periodicamente é um risco documentado, não um bug).
- Todo path de build usa `node:path`; nenhum `/` hardcoded.

## Descobertas técnicas (validadas empiricamente antes deste plano — não re-investigar)

1. **Bundlar `server/index.ts` com esbuild em `--format=esm` puro (bundlando tudo, inclusive `node_modules`) QUEBRA em runtime**: `fastify`/`avvio` fazem um `require()` dinâmico de módulos internos do Node que o shim de `require` gerado pelo esbuild para saída ESM não resolve — erro real reproduzido: `Dynamic require of "node:events" is not supported`.
2. **Bundlar em `--format=cjs` também QUEBRA**: o código-fonte do projeto usa `import.meta.url` (em `server/paths.ts`) para calcular `ROOT` — em saída CJS isso vira `createRequire(import.meta.url)` com `import.meta.url` **undefined**, e o boot falha com `ERR_INVALID_ARG_VALUE`.
3. **A combinação que funciona, validada rodando o bundle de verdade e batendo `/api/meta`/`/api/domains` com sucesso (200 nos dois)**: `esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=<out>/app/server.bundle.mjs`. `--packages=external` faz o esbuild bundlar **só o código próprio** (`server/`, que só importa outros arquivos de `server/` e módulos built-in do Node) e deixar todo `import` de pacote de terceiro (`fastify`, `@fastify/static`, `@dbml/core`, etc.) como `import` real, resolvido pelo Node em runtime contra um `node_modules/` real que precisa existir ao lado do bundle. Resultado: bundle de **~137KB** (vs. 25MB tentando bundlar tudo), sem os erros acima.
4. **`ROOT` (calculado em `server/paths.ts` via `import.meta.url`) resolve para o diretório UM NÍVEL ACIMA de onde o arquivo bundlado fisicamente está.** Se o bundle mora em `<pasta-do-launcher>/app/server.bundle.mjs`, `ROOT` vira `<pasta-do-launcher>/`. Por isso `dist/` (a build do Vite) precisa ficar em `<pasta-do-launcher>/dist/` — **não** dentro de `app/` como o diagrama da Spec B sugeria. Isso preserva "reaproveita `server/` sem reescrever nada" (zero mudança em `server/paths.ts`/`server/index.ts`), então este plano ajusta o layout do pacote em relação ao diagrama da spec (mesmos critérios de aceite, estrutura interna ligeiramente diferente).
5. **Node Single Executable Applications (SEA) + `postject` permite gerar um `.exe` Windows de verdade rodando o build no macOS/Linux** (`postject` só manipula o formato binário PE, não precisa executá-lo). Fluxo: `node --experimental-sea-config sea-config.json` gera um blob; copia-se o `node.exe` Windows baixado (Task 1) para o nome final; `postject <exe> NODE_SEA_BLOB <blob> --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` injeta o blob. **Importante:** `useCodeCache`/`useSnapshot` devem ficar `false` no `sea-config.json` — são incompatíveis entre plataformas (documentação oficial do Node).

## Layout final do pacote (ajustado conforme descoberta #4)

```
dist-win/LocalDrawDB-win/
  node/                      # Node.js portátil win-x64 baixado (Task 1)
  app/
    server.bundle.mjs        # server/ bundlado, deps externas (Task 2)
    node_modules/            # só "dependencies" do package.json, sem devDeps (Task 2)
  dist/                      # build do Vite, copiada aqui (Task 2)
  LocalDrawDB.exe            # launcher SEA (Tasks 3+4)
  data/                      # vazia — criada no primeiro uso pelo boot do servidor
```

---

## Dependency Graph (para execução em paralelo)

```
Camada 0 (paralelo entre si):
  Task 1 — scripts/build-win/fetchNode.mjs (baixa/cacheia Node portátil win-x64)
  Task 2 — scripts/build-win/bundleServer.mjs (esbuild + vite build + node_modules de produção)
  Task 3 — scripts/build-win/launcher.mjs + bundle CJS do launcher

Camada 1 (depende da Camada 0):
  Task 4 — scripts/build-win/buildLauncher.mjs (SEA: blob + postject) — depende de Task 1 (node.exe base) + Task 3 (launcher.cjs bundlado)

Camada 2 (sequencial, depende de tudo):
  Task 5 — scripts/build-win/build.mjs (orquestra tudo, monta a pasta, zipa) + npm run build:win + docs
```

---

### Task 1: `scripts/build-win/fetchNode.mjs` — Node.js portátil win-x64

**Files:**
- Create: `scripts/build-win/fetchNode.mjs`
- Test: `scripts/build-win/__tests__/fetchNode.test.mjs`
- Modify: `package.json` (adicionar `extract-zip` a `devDependencies`)

**Interfaces:**
- Consumes: nada (módulo raiz).
- Produces:
  ```js
  export const NODE_VERSION = '22.11.0';
  export function nodeDownloadUrl(version = NODE_VERSION): string;
  export async function ensureNodePortable({
    version = NODE_VERSION,
    cacheDir,           // string — diretório de cache (ex: .cache/build-win/)
    fetchImpl = fetch,  // injetável para teste
    extractImpl,        // injetável para teste — (zipPath, destDir) => Promise<void>
  }): Promise<string>;  // retorna o caminho da pasta node/ extraída (contém node.exe)
  ```

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// scripts/build-win/__tests__/fetchNode.test.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_VERSION, nodeDownloadUrl, ensureNodePortable } from '../fetchNode.mjs';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-fetchnode-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('nodeDownloadUrl', () => {
  it('monta a URL oficial do nodejs.org para win-x64', () => {
    expect(nodeDownloadUrl('22.11.0')).toBe(
      'https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip',
    );
  });

  it('usa NODE_VERSION por padrão', () => {
    expect(nodeDownloadUrl()).toBe(`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`);
  });
});

describe('ensureNodePortable', () => {
  it('baixa e extrai quando não há cache', async () => {
    const cacheDir = path.join(tmpDir, 'cache');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    const extractImpl = vi.fn().mockImplementation(async (_zipPath, destDir) => {
      const nodeSubdir = path.join(destDir, `node-v22.11.0-win-x64`);
      await fs.mkdir(nodeSubdir, { recursive: true });
      await fs.writeFile(path.join(nodeSubdir, 'node.exe'), 'fake-binary');
    });

    const nodeDir = await ensureNodePortable({ version: '22.11.0', cacheDir, fetchImpl, extractImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip',
    );
    expect(extractImpl).toHaveBeenCalledTimes(1);
    const exists = await fs.stat(path.join(nodeDir, 'node.exe')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('reusa o cache e não baixa de novo na segunda chamada', async () => {
    const cacheDir = path.join(tmpDir, 'cache');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    const extractImpl = vi.fn().mockImplementation(async (_zipPath, destDir) => {
      const nodeSubdir = path.join(destDir, `node-v22.11.0-win-x64`);
      await fs.mkdir(nodeSubdir, { recursive: true });
      await fs.writeFile(path.join(nodeSubdir, 'node.exe'), 'fake-binary');
    });

    await ensureNodePortable({ version: '22.11.0', cacheDir, fetchImpl, extractImpl });
    fetchImpl.mockClear();
    extractImpl.mockClear();
    const nodeDir2 = await ensureNodePortable({ version: '22.11.0', cacheDir, fetchImpl, extractImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(extractImpl).not.toHaveBeenCalled();
    const exists = await fs.stat(path.join(nodeDir2, 'node.exe')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('lança erro claro se o download falhar (ok: false)', async () => {
    const cacheDir = path.join(tmpDir, 'cache');
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(
      ensureNodePortable({ version: '22.11.0', cacheDir, fetchImpl, extractImpl: vi.fn() }),
    ).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run scripts/build-win/__tests__/fetchNode.test.mjs`
Expected: FAIL — `Cannot find module '../fetchNode.mjs'`.

- [ ] **Step 3: Adicionar `extract-zip` como devDependency**

Run: `npm install --save-dev extract-zip`

- [ ] **Step 4: Implementar `scripts/build-win/fetchNode.mjs`**

```js
// scripts/build-win/fetchNode.mjs
// Baixa e cacheia o Node.js portátil win-x64 — o runtime embutido no pacote
// Windows. Cache local (gitignored) evita rebaixar em cada `npm run build:win`.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import extractZipDefault from 'extract-zip';

export const NODE_VERSION = '22.11.0';

export function nodeDownloadUrl(version = NODE_VERSION) {
  return `https://nodejs.org/dist/v${version}/node-v${version}-win-x64.zip`;
}

async function pathExists(p) {
  return fs.stat(p).then(() => true).catch(() => false);
}

/**
 * Garante que o Node.js portátil win-x64 esteja extraído em cacheDir.
 * Retorna o caminho da pasta que contém node.exe.
 */
export async function ensureNodePortable({
  version = NODE_VERSION,
  cacheDir,
  fetchImpl = fetch,
  extractImpl = extractZipDefault,
} = {}) {
  if (!cacheDir) throw new Error('ensureNodePortable: cacheDir é obrigatório');

  const nodeDirName = `node-v${version}-win-x64`;
  const nodeDir = path.join(cacheDir, nodeDirName);
  const nodeExe = path.join(nodeDir, 'node.exe');

  if (await pathExists(nodeExe)) {
    return nodeDir;
  }

  await fs.mkdir(cacheDir, { recursive: true });

  const url = nodeDownloadUrl(version);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Falha ao baixar Node portátil (${res.status}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  const zipPath = path.join(cacheDir, `${nodeDirName}.zip`);
  await fs.writeFile(zipPath, buf);

  await extractImpl(zipPath, { dir: cacheDir });
  await fs.rm(zipPath, { force: true });

  if (!(await pathExists(nodeExe))) {
    throw new Error(`Extração não produziu node.exe em ${nodeExe}`);
  }
  return nodeDir;
}
```

Note: a assinatura de `extractImpl` no código real (`extractZipDefault(zipPath, { dir })`) é a API real do pacote `extract-zip`; o `extractImpl` injetado nos testes acima usa `(zipPath, destDir)` — **ajuste o teste OU a implementação para casarem exatamente**. Ao implementar, padronize `extractImpl(zipPath, opts)` onde `opts = { dir: cacheDir }`, e ajuste os mocks do Step 1 de acordo (`extractImpl: vi.fn().mockImplementation(async (_zipPath, { dir }) => { ... })`) antes de rodar — isso é uma correção esperada de consistência entre teste e implementação, não um desvio de plano.

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `npx vitest run scripts/build-win/__tests__/fetchNode.test.mjs`
Expected: PASS em todos os testes.

- [ ] **Step 6: Adicionar `.cache/` ao `.gitignore`**

Adicione a linha `.cache/` ao `.gitignore` (verifique antes se já existe algo parecido; se `.cache` já estiver coberto por um padrão existente, pule este step).

- [ ] **Step 7: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-win/fetchNode.mjs scripts/build-win/__tests__/fetchNode.test.mjs package.json package-lock.json .gitignore
git commit -m "feat(build-win): baixa e cacheia Node.js portátil win-x64"
```

---

### Task 2: `scripts/build-win/bundleServer.mjs` — bundle do servidor + build do Vite

**Files:**
- Create: `scripts/build-win/bundleServer.mjs`
- Test: `scripts/build-win/__tests__/bundleServer.test.mjs`
- Modify: `package.json` (adicionar `esbuild` explícito a `devDependencies` — hoje só está presente transitivamente via Vite)

**Interfaces:**
- Consumes: nada de outras tasks deste plano.
- Produces:
  ```js
  export async function bundleServer({ outDir, execImpl }): Promise<void>;
  // Produz: <outDir>/app/server.bundle.mjs, <outDir>/app/node_modules/ (só "dependencies"), <outDir>/dist/
  ```

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// scripts/build-win/__tests__/bundleServer.test.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundleServer } from '../bundleServer.mjs';

let outDir;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-bundleserver-'));
});

afterEach(async () => {
  await fs.rm(outDir, { recursive: true, force: true });
});

// Este teste roda o esbuild/vite/npm de VERDADE (sem mock) — é o que garante,
// de fato, que o bundle funciona (é exatamente o que pegou os dois bugs reais
// documentados em "Descobertas técnicas" no início do plano). Mais lento
// (~10-20s), mas é a única forma de saber se o bundle sobe.
describe('bundleServer', () => {
  it('gera server.bundle.mjs válido, node_modules de produção e dist/, e o bundle sobe e responde', async () => {
    await bundleServer({ outDir });

    const bundlePath = path.join(outDir, 'app', 'server.bundle.mjs');
    const bundleExists = await fs.stat(bundlePath).then((s) => s.isFile()).catch(() => false);
    expect(bundleExists).toBe(true);

    const nodeModulesFastify = path.join(outDir, 'app', 'node_modules', 'fastify');
    const fastifyExists = await fs.stat(nodeModulesFastify).then((s) => s.isDirectory()).catch(() => false);
    expect(fastifyExists).toBe(true);

    // devDependencies NÃO devem estar presentes (só "dependencies")
    const viteInNodeModules = await fs
      .stat(path.join(outDir, 'app', 'node_modules', 'vite'))
      .then(() => true)
      .catch(() => false);
    expect(viteInNodeModules).toBe(false);

    const distIndexPath = path.join(outDir, 'dist', 'index.html');
    const distExists = await fs.stat(distIndexPath).then((s) => s.isFile()).catch(() => false);
    expect(distExists).toBe(true);

    // Smoke test real: sobe o bundle com o Node local e confere que responde.
    // ROOT resolve para `outDir` (um nível acima de app/server.bundle.mjs) —
    // por isso dist/ tem que estar em outDir/dist, não outDir/app/dist.
    const { spawn } = await import('node:child_process');
    const testDataDir = path.join(outDir, 'testdata');
    await fs.mkdir(testDataDir, { recursive: true });
    const port = 58999 + Math.floor(Math.random() * 500);

    const child = spawn(process.execPath, [bundlePath], {
      cwd: outDir,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        LOCALDRAWDB_DATA_DIR: testDataDir,
      },
      stdio: 'pipe',
    });

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout esperando o servidor subir')), 15_000);
        const tryConnect = async () => {
          try {
            const res = await fetch(`http://127.0.0.1:${port}/api/meta`);
            if (res.ok) {
              clearTimeout(timer);
              resolve(await res.json());
            } else {
              setTimeout(tryConnect, 300);
            }
          } catch {
            setTimeout(tryConnect, 300);
          }
        };
        tryConnect();
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/meta`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toHaveProperty('gitAvailable');
      expect(body.dataDir).toBe(testDataDir);
    } finally {
      child.kill();
    }
  }, 60_000);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run scripts/build-win/__tests__/bundleServer.test.mjs`
Expected: FAIL — `Cannot find module '../bundleServer.mjs'`.

- [ ] **Step 3: Adicionar `esbuild` explícito como devDependency**

Run: `npm install --save-dev esbuild@0.24.0`

(Ajuste a versão exata pro que `npm ls esbuild` reportar como já instalado transitivamente, pra não introduzir uma segunda versão em paralelo — rode `npm ls esbuild` antes de instalar e use essa versão.)

- [ ] **Step 4: Implementar `scripts/build-win/bundleServer.mjs`**

```js
// scripts/build-win/bundleServer.mjs
// Bundla server/index.ts com esbuild (código próprio bundlado, dependências
// de terceiro mantidas externas — ver "Descobertas técnicas" no plano: bundlar
// tudo quebra em runtime, tanto em ESM quanto em CJS) e builda o frontend com
// Vite. Produz a estrutura app/ + dist/ que o pacote Windows final usa.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

const execFile = promisify(execFileCb);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function pathExists(p) {
  return fs.stat(p).then(() => true).catch(() => false);
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

export async function bundleServer({ outDir, execImpl = execFile } = {}) {
  if (!outDir) throw new Error('bundleServer: outDir é obrigatório');

  const appDir = path.join(outDir, 'app');
  await fs.mkdir(appDir, { recursive: true });

  // 1) Bundle do servidor — só código próprio, deps de terceiro externas.
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'server', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: path.join(appDir, 'server.bundle.mjs'),
    logLevel: 'warning',
  });

  // 2) node_modules de produção (só "dependencies", sem devDependencies).
  //    Copia package.json + package-lock.json pra um dir isolado e roda
  //    `npm ci --omit=dev` lá, depois move o node_modules resultante.
  const stageDir = path.join(outDir, '.npm-stage');
  await fs.mkdir(stageDir, { recursive: true });
  const pkgRaw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const prodPkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: pkg.type,
    dependencies: pkg.dependencies,
  };
  await fs.writeFile(path.join(stageDir, 'package.json'), JSON.stringify(prodPkg, null, 2));
  await fs.copyFile(path.join(ROOT, 'package-lock.json'), path.join(stageDir, 'package-lock.json'));
  await execImpl('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stageDir });
  await fs.rename(path.join(stageDir, 'node_modules'), path.join(appDir, 'node_modules'));
  await fs.rm(stageDir, { recursive: true, force: true });

  // 3) Build do Vite (dist/) — reusa o build normal do projeto, depois copia
  //    pra fora de app/ (ROOT do bundle resolve um nível acima de app/, ver
  //    "Descobertas técnicas" no topo do plano).
  await execImpl('npx', ['vite', 'build'], { cwd: ROOT });
  const builtDist = path.join(ROOT, 'dist');
  if (!(await pathExists(builtDist))) {
    throw new Error(`vite build não produziu ${builtDist}`);
  }
  await copyDir(builtDist, path.join(outDir, 'dist'));
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `npx vitest run scripts/build-win/__tests__/bundleServer.test.mjs`
Expected: PASS (pode levar ~10-20s — sobe `npm install`, `vite build` e um servidor real).

- [ ] **Step 6: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-win/bundleServer.mjs scripts/build-win/__tests__/bundleServer.test.mjs package.json package-lock.json
git commit -m "feat(build-win): bundla servidor (esbuild, deps externas) + build do Vite"
```

---

### Task 3: Launcher (fonte + bundle CJS)

**Files:**
- Create: `scripts/build-win/launcherSrc.mjs`
- Create: `scripts/build-win/launcherPaths.mjs` (lógica pura, testável, extraída do launcher)
- Create: `scripts/build-win/bundleLauncher.mjs`
- Test: `scripts/build-win/__tests__/launcherPaths.test.mjs`
- Test: `scripts/build-win/__tests__/bundleLauncher.test.mjs`

**Interfaces:**
- Consumes: `findFreePort`, `waitForPort` de `../devPorts.mjs` (já existente, não modificado).
- Produces:
  ```js
  // launcherPaths.mjs
  export function resolveLauncherPaths(launcherDir: string): {
    nodeExe: string; serverScript: string; dataDir: string;
  };
  // bundleLauncher.mjs
  export async function bundleLauncher({ outDir }): Promise<string>; // caminho do .cjs gerado
  ```

**Por que a lógica de paths é extraída:** não dá pra "rodar" o launcher de ponta a ponta fora do Windows (ele spawna um `node.exe` que é um binário PE, inexecutável em outro SO) — mas a lógica de ONDE ele procura cada coisa (relativa à sua própria localização) é pura e 100% testável, e é justamente onde um bug de path quebraria o pacote inteiro silenciosamente. Isolar isso numa função pura testada cobre o risco real; o resto (spawn + abrir browser) é smoke test manual em Windows, como a Spec B já previa.

- [ ] **Step 1: Escrever o teste de `launcherPaths` (falhando)**

```js
// scripts/build-win/__tests__/launcherPaths.test.mjs
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLauncherPaths } from '../launcherPaths.mjs';

describe('resolveLauncherPaths', () => {
  it('resolve node.exe, server.bundle.mjs e data/ relativos à pasta do launcher', () => {
    const launcherDir = path.join('C:', 'Users', 'ana', 'Downloads', 'LocalDrawDB-win');
    const paths = resolveLauncherPaths(launcherDir);
    expect(paths.nodeExe).toBe(path.join(launcherDir, 'node', 'node.exe'));
    expect(paths.serverScript).toBe(path.join(launcherDir, 'app', 'server.bundle.mjs'));
    expect(paths.dataDir).toBe(path.join(launcherDir, 'data'));
  });

  it('funciona com launcherDir contendo espaços (caminho comum no Windows: Downloads, Desktop)', () => {
    const launcherDir = path.join('C:', 'Users', 'Ana Clara', 'Desktop', 'LocalDrawDB-win');
    const paths = resolveLauncherPaths(launcherDir);
    expect(paths.nodeExe).toContain('Ana Clara');
    expect(paths.dataDir).toBe(path.join(launcherDir, 'data'));
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run scripts/build-win/__tests__/launcherPaths.test.mjs`
Expected: FAIL — `Cannot find module '../launcherPaths.mjs'`.

- [ ] **Step 3: Implementar `scripts/build-win/launcherPaths.mjs`**

```js
// scripts/build-win/launcherPaths.mjs
// Lógica pura de resolução de paths do launcher — separada do launcherSrc.mjs
// justamente pra ser testável fora do Windows (o resto do launcher spawna um
// binário PE, que só roda no Windows).
import path from 'node:path';

export function resolveLauncherPaths(launcherDir) {
  return {
    nodeExe: path.join(launcherDir, 'node', 'node.exe'),
    serverScript: path.join(launcherDir, 'app', 'server.bundle.mjs'),
    dataDir: path.join(launcherDir, 'data'),
  };
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run scripts/build-win/__tests__/launcherPaths.test.mjs`
Expected: PASS.

- [ ] **Step 5: Implementar `scripts/build-win/launcherSrc.mjs`**

```js
// scripts/build-win/launcherSrc.mjs
// Fonte do launcher — bundlado (Step 7) e depois transformado num .exe
// Windows via Node SEA (Task 4). Sobe o servidor local, espera responder, e
// abre o navegador padrão. Fechar o processo encerra o servidor filho.
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { resolveLauncherPaths } from './launcherPaths.mjs';
import { findFreePort, waitForPort } from '../devPorts.mjs';

async function main() {
  // process.execPath é o caminho real do .exe em execução — não __dirname
  // (que, num binário SEA, reflete o momento do build, não onde o usuário
  // extraiu o zip).
  const launcherDir = process.env.LOCALDRAWDB_LAUNCHER_DIR
    ?? path.dirname(process.execPath);
  const { nodeExe, serverScript, dataDir } = resolveLauncherPaths(launcherDir);

  const port = await findFreePort(5174, '127.0.0.1');

  const child = spawn(nodeExe, [serverScript], {
    cwd: launcherDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      LOCALDRAWDB_DATA_DIR: dataDir,
    },
    stdio: 'inherit',
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', (code) => {
    if (!shuttingDown) process.exit(code ?? 0);
  });

  try {
    await waitForPort(port, '127.0.0.1', 30_000);
  } catch (err) {
    console.error('LocalDrawDB não respondeu a tempo:', err.message);
    shutdown();
    return;
  }

  exec(`start "" "http://127.0.0.1:${port}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Nota: `LOCALDRAWDB_LAUNCHER_DIR` existe como escape hatch pra smoke test manual (Step 8) — permite rodar o `.cjs` bundlado localmente apontando pra uma pasta de teste, sem precisar de um `.exe` de verdade. Não é usado em produção (o launcher real sempre resolve a própria pasta via `process.execPath`).

- [ ] **Step 6: Escrever o teste de `bundleLauncher` (falhando)**

```js
// scripts/build-win/__tests__/bundleLauncher.test.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundleLauncher } from '../bundleLauncher.mjs';

let outDir;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-bundlelauncher-'));
});

afterEach(async () => {
  await fs.rm(outDir, { recursive: true, force: true });
});

describe('bundleLauncher', () => {
  it('gera um único arquivo .cjs válido e carregável (require)', async () => {
    const cjsPath = await bundleLauncher({ outDir });

    const exists = await fs.stat(cjsPath).then((s) => s.isFile()).catch(() => false);
    expect(exists).toBe(true);
    expect(cjsPath.endsWith('.cjs')).toBe(true);

    const content = await fs.readFile(cjsPath, 'utf8');
    // Confirma que não sobrou nenhum "import"/"export" de nível de módulo —
    // bundle CJS de verdade, sem depender de node_modules externo (SEA não
    // tem acesso a filesystem pra resolver require de terceiros).
    expect(content).not.toMatch(/^import /m);
    expect(content).not.toMatch(/^export /m);

    // Carregável como CJS puro, sem erro de sintaxe/resolução.
    delete require.cache[require.resolve(cjsPath)];
    expect(() => require(cjsPath)).not.toThrow();
  });
});
```

- [ ] **Step 7: Rodar e confirmar falha**

Run: `npx vitest run scripts/build-win/__tests__/bundleLauncher.test.mjs`
Expected: FAIL — `Cannot find module '../bundleLauncher.mjs'`.

- [ ] **Step 8: Implementar `scripts/build-win/bundleLauncher.mjs`**

```js
// scripts/build-win/bundleLauncher.mjs
// Bundla launcherSrc.mjs num único .cjs — Node SEA (Task 4) exige um arquivo
// só, sem acesso a filesystem pra resolver imports/requires de terceiros em
// runtime. launcherSrc.mjs só usa módulos built-in do Node (child_process,
// path) + devPorts.mjs (também sem deps de terceiro), então bundlar pra CJS
// não hita o problema de "Dynamic require" documentado em bundleServer.mjs
// (esse problema vinha de fastify/avvio, que não entram aqui).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function bundleLauncher({ outDir } = {}) {
  if (!outDir) throw new Error('bundleLauncher: outDir é obrigatório');

  const outfile = path.join(outDir, 'launcher.cjs');
  await esbuild.build({
    entryPoints: [path.join(HERE, 'launcherSrc.mjs')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'warning',
  });
  return outfile;
}
```

- [ ] **Step 9: Rodar e confirmar sucesso**

Run: `npx vitest run scripts/build-win/__tests__/launcherPaths.test.mjs scripts/build-win/__tests__/bundleLauncher.test.mjs`
Expected: PASS em todos.

- [ ] **Step 10: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add scripts/build-win/launcherPaths.mjs scripts/build-win/launcherSrc.mjs scripts/build-win/bundleLauncher.mjs scripts/build-win/__tests__/launcherPaths.test.mjs scripts/build-win/__tests__/bundleLauncher.test.mjs
git commit -m "feat(build-win): launcher (fonte + bundle CJS) — sobe servidor, espera, abre navegador"
```

---

### Task 4: `scripts/build-win/buildLauncher.mjs` — gera `LocalDrawDB.exe` via Node SEA

**Depends on:** Task 1 (`ensureNodePortable` — precisa do `node.exe` Windows como base pra injeção), Task 3 (`bundleLauncher` — precisa do `.cjs` bundlado).

**Files:**
- Create: `scripts/build-win/buildLauncher.mjs`
- Test: `scripts/build-win/__tests__/buildLauncher.test.mjs`
- Modify: `package.json` (adicionar `postject` a `devDependencies`)

**Interfaces:**
- Consumes: `bundleLauncher` de `./bundleLauncher.mjs` (Task 3, real, não mockada no teste — o objetivo é testar a integração de verdade); um `node.exe` de entrada (no teste, um binário PE mínimo fake, não o real de 100MB+ — ver Step 1).
- Produces:
  ```js
  export async function buildExeLauncher({ outDir, nodeExePath, execImpl }): Promise<string>; // caminho do .exe final
  ```

**Nota sobre o que dá pra testar sem Windows:** o `.exe` final não pode ser *executado* fora do Windows (formato PE nativo), mas a **injeção em si** (`postject`) é só manipulação de bytes do arquivo — isso roda e é verificável em qualquer SO. O teste confirma que o arquivo final (a) existe, (b) cresceu em relação ao binário base (o blob foi injetado), (c) ainda começa com o cabeçalho PE (`MZ`) — ou seja, a injeção não corrompeu o binário. Rodar o `.exe` de verdade fica pro checklist manual em Windows (Task 5 cria esse checklist).

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// scripts/build-win/__tests__/buildLauncher.test.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildExeLauncher } from '../buildLauncher.mjs';

let outDir;
let fakeNodeExe;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-buildlauncher-'));
  // Binário PE mínimo fake: cabeçalho "MZ" (assinatura DOS/PE) + padding.
  // Não é um Windows node.exe de verdade (não roda), mas basta pro postject
  // reconhecer o formato do arquivo e injetar o blob.
  fakeNodeExe = path.join(outDir, 'fake-node.exe');
  const fakeBinary = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 0)]);
  await fs.writeFile(fakeNodeExe, fakeBinary);
});

afterEach(async () => {
  await fs.rm(outDir, { recursive: true, force: true });
});

describe('buildExeLauncher', () => {
  it('gera um .exe maior que o binário base, com o header PE intacto', async () => {
    const exePath = await buildExeLauncher({ outDir, nodeExePath: fakeNodeExe });

    const exists = await fs.stat(exePath).then((s) => s.isFile()).catch(() => false);
    expect(exists).toBe(true);
    expect(exePath.endsWith('.exe')).toBe(true);

    const baseSize = (await fs.stat(fakeNodeExe)).size;
    const finalSize = (await fs.stat(exePath)).size;
    expect(finalSize).toBeGreaterThan(baseSize);

    const header = await fs.readFile(exePath);
    expect(header.subarray(0, 2).toString('ascii')).toBe('MZ');
  }, 30_000);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run scripts/build-win/__tests__/buildLauncher.test.mjs`
Expected: FAIL — `Cannot find module '../buildLauncher.mjs'`.

- [ ] **Step 3: Adicionar `postject` como devDependency**

Run: `npm install --save-dev postject`

- [ ] **Step 4: Implementar `scripts/build-win/buildLauncher.mjs`**

```js
// scripts/build-win/buildLauncher.mjs
// Gera LocalDrawDB.exe via Node Single Executable Applications (SEA): gera um
// blob a partir do launcher bundlado (Task 3), copia o node.exe Windows
// baixado (Task 1) pro nome final, e injeta o blob com postject. Funciona
// rodando em macOS/Linux — postject só manipula o formato binário PE, não
// precisa executar o .exe (ver "Descobertas técnicas" no topo do plano).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { bundleLauncher } from './bundleLauncher.mjs';

const execFile = promisify(execFileCb);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

export async function buildExeLauncher({ outDir, nodeExePath, execImpl = execFile } = {}) {
  if (!outDir) throw new Error('buildExeLauncher: outDir é obrigatório');
  if (!nodeExePath) throw new Error('buildExeLauncher: nodeExePath é obrigatório');

  const buildDir = path.join(outDir, '.sea-build');
  await fs.mkdir(buildDir, { recursive: true });

  // 1) Bundle do launcher (Task 3).
  const launcherCjs = await bundleLauncher({ outDir: buildDir });

  // 2) Config do SEA. useCodeCache/useSnapshot=false: obrigatório para build
  //    cross-platform (ver "Descobertas técnicas").
  const blobPath = path.join(buildDir, 'sea-prep.blob');
  const seaConfigPath = path.join(buildDir, 'sea-config.json');
  await fs.writeFile(
    seaConfigPath,
    JSON.stringify(
      {
        main: launcherCjs,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    ),
  );

  // 3) Gera o blob.
  await execImpl(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  // 4) Copia o node.exe base pro nome final.
  const exePath = path.join(outDir, 'LocalDrawDB.exe');
  await fs.copyFile(nodeExePath, exePath);

  // 5) Injeta o blob com postject.
  const postjectBin = path.join(HERE, '..', '..', 'node_modules', '.bin', 'postject');
  await execImpl(postjectBin, [
    exePath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    SEA_FUSE,
  ]);

  await fs.rm(buildDir, { recursive: true, force: true });
  return exePath;
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `npx vitest run scripts/build-win/__tests__/buildLauncher.test.mjs`
Expected: PASS. Se o `postject` rejeitar o binário fake por não parecer um PE válido de verdade (header `MZ` sozinho pode não bastar — `postject` pode validar mais campos do formato PE), ajuste o fixture do Step 1 pra incluir um cabeçalho PE mínimo mais completo (pesquise a estrutura mínima aceita pelo `postject` nesse momento, já que isso depende da versão instalada) — documente no relatório da task qualquer ajuste necessário aqui, com a razão.

- [ ] **Step 6: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-win/buildLauncher.mjs scripts/build-win/__tests__/buildLauncher.test.mjs package.json package-lock.json
git commit -m "feat(build-win): gera LocalDrawDB.exe via Node SEA + postject"
```

---

### Task 5: `scripts/build-win/build.mjs` — orquestrador, `npm run build:win`, docs

**Depends on:** Tasks 1, 2, 3, 4.

**Files:**
- Create: `scripts/build-win/build.mjs`
- Create: `scripts/build-win/README.md` (checklist manual)
- Test: `scripts/build-win/__tests__/build.test.mjs`
- Modify: `package.json` (script `build:win`, adicionar `archiver` a `devDependencies`)
- Modify: `README.md` (seção de distribuição Windows + nota de WSL)

**Interfaces:**
- Consumes: `ensureNodePortable` (Task 1), `bundleServer` (Task 2), `buildExeLauncher` (Task 4, que já inclui `bundleLauncher` da Task 3 internamente).
- Produces: `npm run build:win` → `dist-win/LocalDrawDB-win.zip`.

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// scripts/build-win/__tests__/build.test.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWindowsPackage } from '../build.mjs';

let outDir;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-build-win-'));
});

afterEach(async () => {
  await fs.rm(outDir, { recursive: true, force: true });
});

describe('buildWindowsPackage', () => {
  it('monta a estrutura completa e zipa, chamando cada etapa uma vez', async () => {
    const calls = [];
    const fakeEnsureNodePortable = vi.fn().mockImplementation(async ({ cacheDir }) => {
      calls.push('ensureNodePortable');
      const nodeDir = path.join(cacheDir, 'fake-node');
      await fs.mkdir(nodeDir, { recursive: true });
      await fs.writeFile(path.join(nodeDir, 'node.exe'), 'fake-node-binary');
      return nodeDir;
    });
    const fakeBundleServer = vi.fn().mockImplementation(async ({ outDir: dest }) => {
      calls.push('bundleServer');
      await fs.mkdir(path.join(dest, 'app'), { recursive: true });
      await fs.writeFile(path.join(dest, 'app', 'server.bundle.mjs'), '// fake');
      await fs.mkdir(path.join(dest, 'app', 'node_modules'), { recursive: true });
      await fs.mkdir(path.join(dest, 'dist'), { recursive: true });
      await fs.writeFile(path.join(dest, 'dist', 'index.html'), '<html></html>');
    });
    const fakeBuildExeLauncher = vi.fn().mockImplementation(async ({ outDir: dest }) => {
      calls.push('buildExeLauncher');
      const exePath = path.join(dest, 'LocalDrawDB.exe');
      await fs.writeFile(exePath, 'fake-exe');
      return exePath;
    });

    const zipPath = await buildWindowsPackage({
      workDir: outDir,
      ensureNodePortableImpl: fakeEnsureNodePortable,
      bundleServerImpl: fakeBundleServer,
      buildExeLauncherImpl: fakeBuildExeLauncher,
    });

    expect(calls).toEqual(['ensureNodePortable', 'bundleServer', 'buildExeLauncher']);

    const zipExists = await fs.stat(zipPath).then((s) => s.isFile()).catch(() => false);
    expect(zipExists).toBe(true);
    expect(zipPath.endsWith('LocalDrawDB-win.zip')).toBe(true);

    const packageDir = path.join(outDir, 'LocalDrawDB-win');
    const dataDir = path.join(packageDir, 'data');
    const dataDirExists = await fs.stat(dataDir).then((s) => s.isDirectory()).catch(() => false);
    expect(dataDirExists).toBe(true);
    // data/ precisa nascer vazia — o app cria domains.json/domains/ sozinho no primeiro boot.
    const dataDirContents = await fs.readdir(dataDir);
    expect(dataDirContents).toEqual([]);

    const nodeExeInPackage = await fs
      .stat(path.join(packageDir, 'node', 'node.exe'))
      .then(() => true)
      .catch(() => false);
    expect(nodeExeInPackage).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run scripts/build-win/__tests__/build.test.mjs`
Expected: FAIL — `Cannot find module '../build.mjs'`.

- [ ] **Step 3: Adicionar `archiver` como devDependency**

Run: `npm install --save-dev archiver`

- [ ] **Step 4: Implementar `scripts/build-win/build.mjs`**

```js
// scripts/build-win/build.mjs
// Orquestrador: baixa o Node portátil, bundla servidor+frontend, gera o
// launcher .exe, monta dist-win/LocalDrawDB-win/ e zipa em
// dist-win/LocalDrawDB-win.zip.
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import { ensureNodePortable } from './fetchNode.mjs';
import { bundleServer } from './bundleServer.mjs';
import { buildExeLauncher } from './buildLauncher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

function zipDir(sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, path.basename(sourceDir));
    archive.finalize();
  });
}

export async function buildWindowsPackage({
  workDir = path.join(ROOT, 'dist-win'),
  ensureNodePortableImpl = ensureNodePortable,
  bundleServerImpl = bundleServer,
  buildExeLauncherImpl = buildExeLauncher,
} = {}) {
  const packageDir = path.join(workDir, 'LocalDrawDB-win');
  await fs.rm(packageDir, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });

  // 1) Node portátil (cache fora de workDir, sobrevive entre builds).
  const cacheDir = path.join(ROOT, '.cache', 'build-win');
  const nodeDir = await ensureNodePortableImpl({ cacheDir });
  await copyDir(nodeDir, path.join(packageDir, 'node'));

  // 2) Servidor bundlado + node_modules de produção + dist/ do Vite.
  await bundleServerImpl({ outDir: packageDir });

  // 3) Launcher .exe (SEA), usando o node.exe recém-copiado como base.
  await buildExeLauncherImpl({
    outDir: packageDir,
    nodeExePath: path.join(packageDir, 'node', 'node.exe'),
  });

  // 4) data/ vazia — o app cria domains.json/domains/ sozinho no primeiro boot.
  await fs.mkdir(path.join(packageDir, 'data'), { recursive: true });

  // 5) Zip final.
  const zipPath = path.join(workDir, 'LocalDrawDB-win.zip');
  await fs.rm(zipPath, { force: true });
  await zipDir(packageDir, zipPath);

  return zipPath;
}

// Permite `node scripts/build-win/build.mjs` direto, além de `npm run build:win`.
if (import.meta.url === `file://${process.argv[1]}`) {
  buildWindowsPackage()
    .then((zipPath) => {
      console.log(`Pacote gerado: ${zipPath}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `npx vitest run scripts/build-win/__tests__/build.test.mjs`
Expected: PASS.

- [ ] **Step 6: Adicionar o script `build:win` ao `package.json`**

Em `package.json`, dentro de `"scripts"`, adicione:

```json
"build:win": "node scripts/build-win/build.mjs",
```

- [ ] **Step 7: Adicionar `dist-win/` e `.cache/` ao `.gitignore`**

Confirme que `.cache/` já foi adicionado na Task 1; adicione `dist-win/` se ainda não estiver coberto por um padrão existente no `.gitignore`.

- [ ] **Step 8: Criar `scripts/build-win/README.md` com o checklist manual**

```markdown
# Build do pacote Windows

`npm run build:win` gera `dist-win/LocalDrawDB-win.zip` — Node.js portátil +
servidor bundlado + build do Vite + launcher `.exe`, sem instalador, sem admin.

Baixa e cacheia o Node.js portátil win-x64 em `.cache/build-win/` na primeira
vez (não versionado); builds seguintes reusam o cache.

## Checklist manual (rodar numa VM/máquina Windows real antes de cada release)

Extraia `dist-win/LocalDrawDB-win.zip` numa pasta qualquer (idealmente numa
máquina **sem** Node.js e **sem** privilégio de administrador) e confirme:

1. [ ] Dar duplo-clique em `LocalDrawDB.exe` abre o navegador padrão na tela
   de escolha de domínio/projeto (não pede elevação de privilégio).
2. [ ] Criar um domínio local, criar um projeto, editar o modelo e salvar —
   funciona igual ao `npm run dev` local.
3. [ ] Numa máquina com `git` instalado: clonar um domínio, ver status,
   fazer pull, commit e push funcionam pela UI.
4. [ ] Numa máquina **sem** `git`: as ações de git mostram aviso com link
   pra instalar o Git for Windows; o resto do app funciona normalmente.
5. [ ] Mover a pasta `LocalDrawDB-win` inteira pra outro local (ex: de
   Downloads pra um pendrive) e rodar `LocalDrawDB.exe` de novo continua
   funcionando, com os dados preservados.
6. [ ] Nenhuma etapa (extrair o zip, rodar o exe, criar domínio/projeto
   local) mostra o prompt de UAC (elevação de administrador).
7. [ ] Fechar a janela do `LocalDrawDB.exe` encerra o processo do servidor
   (confira no Gerenciador de Tarefas que não sobra `node.exe` órfão).

Se qualquer item falhar, não publique o release — abra uma issue com o item
que falhou antes de investigar a causa.

## Sobre WSL

Se você já usa WSL (Windows Subsystem for Linux), é Linux por baixo — pode
simplesmente rodar o fluxo normal (`npm install && npm run dev` / `./ldb`)
dentro dele, sem precisar deste pacote.
```

- [ ] **Step 9: Adicionar seção de distribuição Windows ao `README.md` principal**

No `README.md` do projeto (raiz), adicione uma seção nova (posição sugerida: logo após "## Rodando", antes de "## Como usar" — ajuste conforme a estrutura real do arquivo no momento da implementação):

```markdown
## Distribuição Windows (sem instalar Node)

Pra usuários Windows que não querem instalar Node.js: baixe o pacote
portátil (`LocalDrawDB-win.zip`), extraia numa pasta qualquer e dê duplo-
clique em `LocalDrawDB.exe` — sem instalador, sem precisar de administrador.

Para gerar o pacote (mantenedores do projeto): `npm run build:win` — detalhes
em [`scripts/build-win/README.md`](scripts/build-win/README.md).
```

- [ ] **Step 10: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 11: Smoke test manual do orquestrador completo (não mockado)**

Este é o único ponto do plano em que vale rodar `npm run build:win` de verdade, ponta a ponta (as tasks anteriores testaram cada peça isolada ou com mocks nas bordas do orquestrador) — inclui baixar o Node.js portátil de verdade (~30-50MB, só na primeira vez) e rodar o `postject` de verdade sobre o `node.exe` Windows real.

Run: `npm run build:win`
Expected: termina sem erro, imprime `Pacote gerado: <path>/dist-win/LocalDrawDB-win.zip`.

Depois, confirme a estrutura:

Run: `unzip -l dist-win/LocalDrawDB-win.zip | head -20`
Expected: lista `LocalDrawDB-win/node/node.exe`, `LocalDrawDB-win/app/server.bundle.mjs`, `LocalDrawDB-win/app/node_modules/`, `LocalDrawDB-win/dist/index.html`, `LocalDrawDB-win/LocalDrawDB.exe`, `LocalDrawDB-win/data/` (vazia).

Documente no relatório da task o tamanho final do zip e quanto tempo o build levou — não é um critério de aceite numérico definido na spec, mas é informação útil pra quem for revisar.

- [ ] **Step 12: Commit**

```bash
git add scripts/build-win/build.mjs scripts/build-win/README.md scripts/build-win/__tests__/build.test.mjs package.json package-lock.json .gitignore README.md
git commit -m "feat(build-win): orquestrador npm run build:win + docs + checklist manual"
```

---

## Self-Review

**1. Cobertura da Spec B:**
- `npm run build:win` gera o zip ✅ (Task 5).
- Launcher: porta livre, sobe servidor, espera responder, abre navegador, encerra ao fechar ✅ (Task 3, reusa `devPorts.mjs` como a spec pedia).
- Dados ao lado do launcher, portátil de verdade ✅ (`launcherPaths.mjs` resolve `data/` relativo à pasta do exe, não a um caminho fixo do perfil do usuário — decisão já tomada na spec).
- Detecção de git sem embutir ✅ (`gitAvailable` em `/api/meta` já existe desde a Spec A — nada a fazer, só documentado aqui pra não ser esquecido).
- Nota de WSL sem trabalho de engenharia ✅ (Task 5, Step 8, só documentação).
- Critérios de aceitação 1, 2, 6, 7 da spec (build funciona, exe abre no picker, portabilidade, sem elevação) ✅ cobertos pelo checklist manual (Task 5, Step 8) — não são automatizáveis sem uma VM Windows, exatamente como a própria spec já previa em "Testes".
- Critérios 3, 4, 5 (fluxo local sem Node/git, git funcionando, git ausente com aviso) — 3 e 5 já são cobertos pelos testes automatizados da Spec A (domínio local funciona sem git, `gitAvailable:false` mostra aviso); 4 depende de `git` estar instalado na máquina de build/teste, então fica no checklist manual.

**2. Placeholders:** nenhum `TBD`/`TODO` — todo step tem código completo. A única ressalva explícita (Task 1, Step 4, sobre a assinatura de `extractImpl`) é uma nota de consistência entre teste e implementação, documentada com a correção exata a fazer — não é um buraco no plano.

**3. Consistência de tipos:** `resolveLauncherPaths` (Task 3) é usado só por `launcherSrc.mjs` (mesma task); `bundleLauncher` (Task 3) é consumido por `buildLauncher.mjs` (Task 4) com a mesma assinatura (`{ outDir }` → retorna caminho do `.cjs`); `ensureNodePortable`, `bundleServer`, `buildExeLauncher` são consumidos por `build.mjs` (Task 5) com os nomes e parâmetros exatamente como definidos nas Tasks 1/2/4.

**Risco mais alto do plano:** Task 4 (SEA + postject) é a peça mais nova/menos testada em produção por este projeto. Mitigado por: pesquisa técnica prévia validada com fontes oficiais (Node.js docs) antes de escrever o plano; teste automatizado que verifica a integridade estrutural do binário gerado (cresce, mantém header PE) sem depender de executá-lo; checklist manual explícito cobrindo o caminho que só é verificável num Windows real.
