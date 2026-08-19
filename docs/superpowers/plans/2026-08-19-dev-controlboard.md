# Dev Controlboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run dev` sem argumentos passa a abrir um controlboard (UI dev-only, sem build) que lista todos os domínios (locais e git) e seus projetos; clicar aloca uma instância dedicada (server+vite, porta própria) na hora, e o controlboard vira um dashboard com as instâncias rodando e botão de parar.

**Architecture:** Novo processo `server/controlboard.ts` (Fastify via `tsx`, mesmo padrão de `server/index.ts`) importa `server/domains.ts`/`server/files.ts` diretamente (não o shell-out de `scripts/registry.mjs`) para enxergar todos os domínios, não só `local`. Um `InstanceManager` em memória (`server/controlboardInstances.ts`) rastreia as instâncias lançadas sob demanda, reaproveitando uma função de spawn extraída de `scripts/dev.mjs` para `scripts/instanceLauncher.mjs`. Nenhum código do app em produção (`AppGate`/`DomainPicker`/`App.tsx`) muda.

**Tech Stack:** Node.js (ESM), Fastify, tsx, Vitest. UI: HTML+JS vanilla sem framework/build.

**Spec:** `docs/superpowers/specs/2026-08-19-dev-controlboard-design.md`

## Global Constraints

- Zero regressão: `npm run dev -- <slug>` (multi-mode), `--all`, `--shared`, `--preview`, `--list` continuam com o comportamento exato de hoje — só o default sem argumentos muda de `all` para `board`.
- Nenhuma rota do controlboard chama `activateDomain()`/`seedGitIfNeeded()` para *listar* domínios — essa função dispara `git push` de bootstrap (efeito colateral de rede indesejado numa listagem). Trocar o domínio ativo pra ler projetos usa `setActiveDomainSlug()` + `ensureRegistry()` diretamente.
- Toda leitura multi-domínio (`GET /api/board/domains`) é sequencial (`for` com `await`), nunca paralela — o domínio ativo é estado global do processo (`server/domainContext.ts`), duas leituras concorrentes se pisariam.
- Testes de instância/rotas nunca spawnam processo real — sempre injeção de dependência com fakes (`EventEmitter` + `vi.fn`).
- Suíte de testes completa (`npm run test`) verde ao final de cada task.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `scripts/instanceLauncher.mjs` (novo) | Monta env + spawna/derruba um par server+vite. Usado por `dev.mjs` (modos existentes) e por `server/controlboardInstances.ts`. |
| `scripts/dev.mjs` (modificado) | Perde a lógica de spawn (extraída); ganha o branch `board` que spawna `server/controlboard.ts`. |
| `scripts/devArgs.mjs` (modificado) | Default sem argumentos muda de `'all'` para `'board'`. |
| `server/controlboardInstances.ts` (novo) | `InstanceManager`: registro em memória das instâncias lançadas sob demanda (launch/list/stop/stopByDomain/stopAll). |
| `server/routes/controlboardRoutes.ts` (novo) | Rotas `/api/board/*`: domínios+projetos (listar/criar/clonar/apagar) e instâncias (lançar/listar/parar). |
| `server/controlboardUi.ts` (novo) | HTML+JS autocontido do dashboard. |
| `server/controlboard.ts` (novo) | Entry point: Fastify + `migrateLegacyDomains()` + rotas + UI + `listen()`. |

---

## Task 1: Extrair o spawn de instância pra `scripts/instanceLauncher.mjs`

Refactor puro — nenhum modo existente (`--all`, `--shared`, `--project`, `--preview`) muda de comportamento. Só sai da lógica hardcoded `LOCALDRAWDB_DOMAIN: 'local'` pra aceitar `domainSlug` explícito, o que o controlboard vai precisar (Task 2 em diante) pra lançar instâncias de qualquer domínio, não só `local`.

**Files:**
- Create: `scripts/instanceLauncher.mjs`
- Test: `scripts/__tests__/instanceLauncher.test.mjs`
- Modify: `scripts/dev.mjs`

**Interfaces:**
- Produces: `ROOT: string`, `TSX_CLI: string`, `VITE_CLI: string`, `buildInstanceEnv({ domainSlug?, projectSlug?, apiPort, webPort }, baseEnv?) => NodeJS.ProcessEnv`, `startInstance({ domainSlug?, projectSlug?, apiPort, webPort }) => Promise<{ server: ChildProcess, web: ChildProcess }>`, `startPreviewInstance({ domainSlug?, projectSlug?, port }) => { server: ChildProcess, web: null }`, `stopInstance({ server, web }) => void`.

- [ ] **Step 1: Escrever os testes de `buildInstanceEnv` e `stopInstance` (falhando — o módulo ainda não existe)**

Create `scripts/__tests__/instanceLauncher.test.mjs`:

```js
import { describe, expect, it, vi } from 'vitest';
import { buildInstanceEnv, stopInstance } from '../instanceLauncher.mjs';

describe('buildInstanceEnv', () => {
  it('inclui PORT/API_PORT/VITE_PORT como string', () => {
    const env = buildInstanceEnv({ apiPort: 5174, webPort: 5173 }, {});
    expect(env.PORT).toBe('5174');
    expect(env.API_PORT).toBe('5174');
    expect(env.VITE_PORT).toBe('5173');
  });

  it('sem domainSlug/projectSlug, não pina domínio', () => {
    const env = buildInstanceEnv({ apiPort: 5174, webPort: 5173 }, {});
    expect(env.LOCALDRAWDB_DOMAIN).toBeUndefined();
    expect(env.LOCALDRAWDB_PROJECT).toBeUndefined();
  });

  it('com domainSlug+projectSlug, pina os dois', () => {
    const env = buildInstanceEnv(
      { domainSlug: 'vendas', projectSlug: 'q1', apiPort: 5174, webPort: 5173 },
      {},
    );
    expect(env.LOCALDRAWDB_DOMAIN).toBe('vendas');
    expect(env.LOCALDRAWDB_PROJECT).toBe('q1');
  });

  it('preserva o env base', () => {
    const env = buildInstanceEnv({ apiPort: 1, webPort: 2 }, { PATH: '/usr/bin' });
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('stopInstance', () => {
  it('manda SIGTERM pro server e pro web', () => {
    const server = { kill: vi.fn() };
    const web = { kill: vi.fn() };
    stopInstance({ server, web });
    expect(server.kill).toHaveBeenCalledWith('SIGTERM');
    expect(web.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('funciona sem web (modo preview)', () => {
    const server = { kill: vi.fn() };
    stopInstance({ server, web: null });
    expect(server.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run scripts/__tests__/instanceLauncher.test.mjs`
Expected: FAIL — `Cannot find module '../instanceLauncher.mjs'`

- [ ] **Step 3: Criar `scripts/instanceLauncher.mjs`**

```js
// Spawna e derruba um par server+vite (uma "instância") pinado por
// domínio/projeto via env var. Compartilhado por scripts/dev.mjs (modos
// all/shared/project/preview) e pelo controlboard (server/controlboard.ts),
// que spawna instâncias sob demanda a partir de cliques na UI.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForPort } from './devPorts.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
export const VITE_CLI = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/**
 * Monta o env de uma instância. `domainSlug`+`projectSlug` juntos pinam o
 * domínio/projeto (a instância abre direto, sem tela de escolha); omitidos,
 * a instância sobe "solta" (é a tela de escolha quem decide o domínio).
 * @param {{ domainSlug?: string|null, projectSlug?: string|null, apiPort: number, webPort: number }} opts
 * @param {NodeJS.ProcessEnv} [baseEnv]
 */
export function buildInstanceEnv({ domainSlug, projectSlug, apiPort, webPort }, baseEnv = process.env) {
  return {
    ...baseEnv,
    PORT: String(apiPort),
    API_PORT: String(apiPort),
    VITE_PORT: String(webPort),
    ...(domainSlug && projectSlug ? { LOCALDRAWDB_DOMAIN: domainSlug, LOCALDRAWDB_PROJECT: projectSlug } : {}),
  };
}

/**
 * Sobe um par server+vite. Espera a API responder antes de subir o vite
 * (o front depende da API já estar de pé).
 * @param {{ domainSlug?: string|null, projectSlug?: string|null, apiPort: number, webPort: number }} opts
 * @returns {Promise<{ server: import('node:child_process').ChildProcess, web: import('node:child_process').ChildProcess }>}
 */
export async function startInstance(opts) {
  const env = buildInstanceEnv(opts);

  const server = spawn(process.execPath, [TSX_CLI, 'watch', 'server/index.ts'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  await waitForPort(opts.apiPort);

  const web = spawn(process.execPath, [VITE_CLI, '--port', String(opts.webPort), '--strictPort'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  return { server, web };
}

/**
 * Sobe uma instância de preview (produção estática) — sem vite.
 * @param {{ domainSlug?: string|null, projectSlug?: string|null, port: number }} opts
 * @returns {{ server: import('node:child_process').ChildProcess, web: null }}
 */
export function startPreviewInstance({ domainSlug, projectSlug, port }) {
  const env = {
    ...buildInstanceEnv({ domainSlug, projectSlug, apiPort: port, webPort: port }),
    NODE_ENV: 'production',
  };
  const server = spawn(process.execPath, [TSX_CLI, 'server/index.ts'], { cwd: ROOT, env, stdio: 'inherit' });
  return { server, web: null };
}

/**
 * Derruba uma instância (SIGTERM nos dois processos; `web` pode ser null em preview).
 * @param {{ server: import('node:child_process').ChildProcess, web: import('node:child_process').ChildProcess|null }} handle
 */
export function stopInstance({ server, web }) {
  server.kill('SIGTERM');
  web?.kill('SIGTERM');
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run scripts/__tests__/instanceLauncher.test.mjs`
Expected: PASS (6 testes)

- [ ] **Step 5: Atualizar `scripts/dev.mjs` pra usar o módulo extraído**

No topo do arquivo, troque:

```js
// Dev orchestrator: aloca portas livres por clone e liga Vite -> API do mesmo projeto.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateDevPorts, findFreePort, waitForPort } from './devPorts.mjs';
import { parseDevArgs, resolveSlugs } from './devArgs.mjs';
import { loadRegistry, createProjectCli } from './registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_META = path.join(ROOT, '.localdrawdb-dev.json');
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const VITE_CLI = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
```

Por:

```js
// Dev orchestrator: aloca portas livres por clone e liga Vite -> API do mesmo projeto.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { allocateDevPorts, findFreePort } from './devPorts.mjs';
import { parseDevArgs, resolveSlugs } from './devArgs.mjs';
import { loadRegistry, createProjectCli } from './registry.mjs';
import { ROOT, TSX_CLI, VITE_CLI, startInstance, startPreviewInstance, stopInstance } from './instanceLauncher.mjs';

const DEV_META = path.join(ROOT, '.localdrawdb-dev.json');
```

Remova por completo as duas funções `startInstance` e `startPreviewInstance` que hoje moram inline em `dev.mjs` (o bloco entre o comentário `/** Start one server+vite pair. ... */` e o fechamento de `startPreviewInstance`, imediatamente antes do `if (parsed.preview) {`) — o corpo delas foi para `scripts/instanceLauncher.mjs` no Step 3.

Troque a função `shutdown`:

```js
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const { server, web } of instances) {
    server.kill('SIGTERM');
    web?.kill('SIGTERM');
  }
  try {
    unlinkSync(DEV_META);
  } catch {
    /* ok */
  }
  process.exit(code);
}
```

Por:

```js
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const handle of instances) {
    stopInstance(handle);
  }
  try {
    unlinkSync(DEV_META);
  } catch {
    /* ok */
  }
  process.exit(code);
}
```

Nos três pontos que chamam `startInstance`/`startPreviewInstance`, ajuste os argumentos:

1. Modo compartilhado (`slugs === null`): troque `await startInstance({ slug: null, apiPort, webPort });` por `await startInstance({ domainSlug: null, projectSlug: null, apiPort, webPort });`.
2. Modo multi (loop `for (const { slug, apiPort, webPort } of instanceMeta)`): troque `await startInstance({ slug, apiPort, webPort });` por `await startInstance({ domainSlug: 'local', projectSlug: slug, apiPort, webPort });` — o registry de `scripts/registry.mjs` só enxerga o domínio `local`, então esse modo continua pinando `local` como sempre pinou.
3. Preview (loop `for (const { slug, port } of previewMeta)`): troque `const handle = startPreviewInstance({ slug, port });` por `const handle = startPreviewInstance({ domainSlug: slug ? 'local' : null, projectSlug: slug, port });`.

- [ ] **Step 6: Rodar a suíte inteira e confirmar que nada quebrou**

Run: `npm run test`
Expected: PASS — mesma contagem de testes de antes (nenhum teste cobre `dev.mjs` diretamente; a garantia aqui é comportamental via smoke manual no Step 7).

- [ ] **Step 7: Smoke manual — confirmar que os modos existentes ainda funcionam**

Run: `npm run dev:shared` — deve subir normalmente igual a antes, imprimir a URL, e `Ctrl-C` deve encerrar limpo.

- [ ] **Step 8: Commit**

```bash
git add scripts/instanceLauncher.mjs scripts/__tests__/instanceLauncher.test.mjs scripts/dev.mjs
git commit -m "refactor(dev): extrai spawn de instância pra scripts/instanceLauncher.mjs"
```

---

## Task 2: `InstanceManager` em memória (`server/controlboardInstances.ts`)

**Files:**
- Create: `server/controlboardInstances.ts`
- Test: `server/__tests__/controlboardInstances.test.ts`

**Interfaces:**
- Consumes: `startInstance`, `stopInstance` de `scripts/instanceLauncher.mjs` (Task 1); `findFreePort` de `scripts/devPorts.mjs`.
- Produces: `interface BoardInstance { id: string; domainSlug: string; domainName: string; projectSlug: string; projectName: string; apiPort: number; webPort: number; url: string; startedAt: string }`; `createInstanceManager(deps?) => { launch(opts): Promise<BoardInstance>, list(): BoardInstance[], stop(id: string): boolean, stopByDomain(domainSlug: string): void, stopAll(): void }`. Usado por `server/routes/controlboardRoutes.ts` (Task 3) e `server/controlboard.ts` (Task 4).

- [ ] **Step 1: Escrever os testes do manager (falhando)**

Create `server/__tests__/controlboardInstances.test.ts`:

```ts
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createInstanceManager } from '../controlboardInstances.ts';

function fakeFindFreePort(start: number, _host?: string, exclude = new Set<number>()) {
  let port = start;
  while (exclude.has(port)) port++;
  return Promise.resolve(port);
}

function makeDeps() {
  const stopInstance = vi.fn();
  const startInstance = vi.fn(async () => ({ server: new EventEmitter(), web: new EventEmitter() }));
  return { startInstance: startInstance as any, stopInstance, findFreePort: fakeFindFreePort };
}

const OPTS_A = { domainSlug: 'vendas', domainName: 'Vendas', projectSlug: 'q1', projectName: 'Q1' };
const OPTS_B = { domainSlug: 'rh', domainName: 'RH', projectSlug: 'q2', projectName: 'Q2' };

describe('createInstanceManager', () => {
  it('launch aloca portas distintas pra cada instância', async () => {
    const manager = createInstanceManager(makeDeps());
    const a = await manager.launch(OPTS_A);
    const b = await manager.launch(OPTS_B);
    expect(a.apiPort).not.toBe(b.apiPort);
    expect(a.webPort).not.toBe(b.webPort);
    expect(a.url).toBe(`http://127.0.0.1:${a.webPort}`);
  });

  it('list reflete as instâncias lançadas', async () => {
    const manager = createInstanceManager(makeDeps());
    const a = await manager.launch(OPTS_A);
    expect(manager.list().map((i) => i.id)).toEqual([a.id]);
  });

  it('stop chama deps.stopInstance, remove da lista e libera as portas', async () => {
    const deps = makeDeps();
    const manager = createInstanceManager(deps);
    const a = await manager.launch(OPTS_A);
    expect(manager.stop(a.id)).toBe(true);
    expect(deps.stopInstance).toHaveBeenCalledTimes(1);
    expect(manager.list()).toHaveLength(0);

    const b = await manager.launch(OPTS_A);
    expect(b.apiPort).toBe(a.apiPort); // porta liberada foi reaproveitada
  });

  it('stop com id inexistente retorna false', () => {
    const manager = createInstanceManager(makeDeps());
    expect(manager.stop('nao-existe')).toBe(false);
  });

  it('remove sozinha quando o processo filho cai (evento exit)', async () => {
    const deps = makeDeps();
    const manager = createInstanceManager(deps);
    await manager.launch(OPTS_A);
    const handle = await deps.startInstance.mock.results[0].value;
    handle.server.emit('exit', 1);
    expect(manager.list()).toHaveLength(0);
  });

  it('stopByDomain para só as instâncias daquele domínio', async () => {
    const manager = createInstanceManager(makeDeps());
    const vendas = await manager.launch(OPTS_A);
    const rh = await manager.launch(OPTS_B);
    manager.stopByDomain('vendas');
    expect(manager.list().map((i) => i.id)).toEqual([rh.id]);
    expect(vendas).toBeTruthy();
  });

  it('stopAll para todas as instâncias', async () => {
    const deps = makeDeps();
    const manager = createInstanceManager(deps);
    await manager.launch(OPTS_A);
    await manager.launch(OPTS_B);
    manager.stopAll();
    expect(manager.list()).toHaveLength(0);
    expect(deps.stopInstance).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run server/__tests__/controlboardInstances.test.ts`
Expected: FAIL — `Cannot find module '../controlboardInstances.ts'`

- [ ] **Step 3: Criar `server/controlboardInstances.ts`**

```ts
// Registro em memória das instâncias dedicadas que o controlboard sobe sob
// demanda (server+vite por domínio+projeto). Cada instância roda até ser
// parada explicitamente ou até o processo filho cair sozinho. Estado vive só
// na memória do processo do controlboard — não persiste em disco.
import crypto from 'node:crypto';
import { startInstance, stopInstance } from '../scripts/instanceLauncher.mjs';
import { findFreePort } from '../scripts/devPorts.mjs';

export interface BoardInstance {
  id: string;
  domainSlug: string;
  domainName: string;
  projectSlug: string;
  projectName: string;
  apiPort: number;
  webPort: number;
  url: string;
  startedAt: string;
}

interface KillableHandle {
  server: { kill: (signal: string) => void; on: (event: string, cb: (code: number | null) => void) => void };
  web: { kill: (signal: string) => void; on: (event: string, cb: (code: number | null) => void) => void } | null;
}

export interface InstanceManagerDeps {
  startInstance: (opts: {
    domainSlug: string;
    projectSlug: string;
    apiPort: number;
    webPort: number;
  }) => Promise<KillableHandle>;
  stopInstance: (handle: KillableHandle) => void;
  findFreePort: (start: number, host?: string, exclude?: Set<number>) => Promise<number>;
}

const defaultDeps: InstanceManagerDeps = { startInstance: startInstance as any, stopInstance, findFreePort };

export function createInstanceManager(deps: InstanceManagerDeps = defaultDeps) {
  const instances = new Map<string, { meta: BoardInstance; handle: KillableHandle }>();
  const usedPorts = new Set<number>();

  function release(id: string): void {
    const entry = instances.get(id);
    if (!entry) return;
    usedPorts.delete(entry.meta.apiPort);
    usedPorts.delete(entry.meta.webPort);
    instances.delete(id);
  }

  async function launch(opts: {
    domainSlug: string;
    domainName: string;
    projectSlug: string;
    projectName: string;
  }): Promise<BoardInstance> {
    const apiPort = await deps.findFreePort(5174, '127.0.0.1', usedPorts);
    usedPorts.add(apiPort);
    const webPort = await deps.findFreePort(5173, '127.0.0.1', usedPorts);
    usedPorts.add(webPort);

    const handle = await deps.startInstance({
      domainSlug: opts.domainSlug,
      projectSlug: opts.projectSlug,
      apiPort,
      webPort,
    });

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const meta: BoardInstance = {
      id,
      domainSlug: opts.domainSlug,
      domainName: opts.domainName,
      projectSlug: opts.projectSlug,
      projectName: opts.projectName,
      apiPort,
      webPort,
      url: `http://127.0.0.1:${webPort}`,
      startedAt: new Date().toISOString(),
    };
    instances.set(id, { meta, handle });

    const onExit = () => release(id);
    handle.server.on('exit', onExit);
    handle.web?.on('exit', onExit);

    return meta;
  }

  function list(): BoardInstance[] {
    return [...instances.values()].map((e) => e.meta);
  }

  function stop(id: string): boolean {
    const entry = instances.get(id);
    if (!entry) return false;
    deps.stopInstance(entry.handle);
    release(id);
    return true;
  }

  function stopByDomain(domainSlug: string): void {
    for (const [id, entry] of instances) {
      if (entry.meta.domainSlug === domainSlug) {
        deps.stopInstance(entry.handle);
        release(id);
      }
    }
  }

  function stopAll(): void {
    for (const id of [...instances.keys()]) stop(id);
  }

  return { launch, list, stop, stopByDomain, stopAll };
}

export type InstanceManager = ReturnType<typeof createInstanceManager>;
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run server/__tests__/controlboardInstances.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add server/controlboardInstances.ts server/__tests__/controlboardInstances.test.ts
git commit -m "feat(controlboard): registro em memória de instâncias sob demanda"
```

---

## Task 3: Rotas `/api/board/*` (`server/routes/controlboardRoutes.ts`)

**Files:**
- Create: `server/routes/controlboardRoutes.ts`
- Test: `server/__tests__/controlboardRoutes.test.ts`

**Interfaces:**
- Consumes: `listDomains`, `createLocalDomain`, `cloneDomain`, `deleteDomain`, `getDomain` de `../domains.ts`; `listProjects`, `createProject`, `ensureRegistry` de `../files.ts`; `setActiveDomainSlug` de `../domainContext.ts`; `InstanceManager` de `../controlboardInstances.ts` (Task 2).
- Produces: `registerControlboardRoutes(app: FastifyInstance, instances: InstanceManager): void`, registrando `GET/POST /api/board/domains`, `POST /api/board/domains/clone`, `DELETE /api/board/domains/:id`, `POST /api/board/projects`, `GET/POST /api/board/instances`, `DELETE /api/board/instances/:id`. Usado por `server/controlboard.ts` (Task 4).

- [ ] **Step 1: Escrever os testes das rotas (falhando)**

Create `server/__tests__/controlboardRoutes.test.ts`:

```ts
/**
 * Testes das rotas do controlboard (/api/board/*): listar domínios+projetos
 * de TODOS os domínios (não só "local"), criar/clonar/apagar domínio, criar
 * projeto, e ligar/desligar instâncias via InstanceManager fake (sem
 * spawnar processo real).
 *
 * Mesma convenção de domainRoutes.test.ts: LOCALDRAWDB_DATA_DIR isolado por
 * teste + vi.resetModules() antes de cada import dinâmico, porque
 * domainContext.ts guarda o domínio ativo em estado de módulo.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createInstanceManager } from '../controlboardInstances.ts';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-controlboard-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function fakeInstanceManager() {
  return createInstanceManager({
    startInstance: async () => ({ server: new EventEmitter() as any, web: new EventEmitter() as any }),
    stopInstance: () => {},
    findFreePort: async (start: number, _host?: string, exclude = new Set<number>()) => {
      let port = start;
      while (exclude.has(port)) port++;
      return port;
    },
  });
}

async function buildApp(instances = fakeInstanceManager()) {
  const { default: Fastify } = await import('fastify');
  const { registerControlboardRoutes } = await import('../routes/controlboardRoutes.ts');
  const app = Fastify();
  registerControlboardRoutes(app, instances);
  return { app, instances };
}

async function createDomain(app: Awaited<ReturnType<typeof buildApp>>['app'], name: string) {
  const res = await app.inject({ method: 'POST', url: '/api/board/domains', payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; slug: string; name: string; dir: string; hasGit: boolean };
}

describe('GET /api/board/domains', () => {
  it('lista vazio antes de qualquer criação', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/board/domains' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ domains: [] });
  });

  it('lista domínios com seus projetos, sem precisar ativar nenhum antes', async () => {
    const { app } = await buildApp();
    const vendas = await createDomain(app, 'Vendas');
    await createDomain(app, 'RH');

    const res = await app.inject({ method: 'GET', url: '/api/board/domains' });
    await app.close();
    const body = res.json() as { domains: { slug: string; projects: { name: string }[] }[] };
    expect(body.domains.map((d) => d.slug).sort()).toEqual(['rh', 'vendas']);
    const found = body.domains.find((d) => d.slug === vendas.slug)!;
    expect(found.projects).toHaveLength(1); // default criado pelo ensureRegistry
  });
});

describe('POST /api/board/domains', () => {
  it('400 quando o nome está ausente ou vazio', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/board/domains', payload: { name: '  ' } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/board/domains/clone', () => {
  it('400 sem url', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/board/domains/clone', payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it('422 quando o git clone falha', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/board/domains/clone',
      payload: { url: path.join(tmpDir, 'repo-inexistente.git'), name: 'Falho' },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });
});

describe('DELETE /api/board/domains/:id', () => {
  it('remove o domínio e a pasta local', async () => {
    const { app } = await buildApp();
    const fica = await createDomain(app, 'Fica');
    const sai = await createDomain(app, 'Sai');
    const res = await app.inject({ method: 'DELETE', url: `/api/board/domains/${sai.id}` });
    expect(res.statusCode).toBe(200);

    const listed = await app.inject({ method: 'GET', url: '/api/board/domains' });
    await app.close();
    const body = listed.json() as { domains: { slug: string }[] };
    expect(body.domains.map((d) => d.slug)).toEqual([fica.slug]);
    await expect(fs.stat(sai.dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('404 para id inexistente', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/board/domains/nao-existe' });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('para as instâncias do domínio antes de apagar', async () => {
    const { app, instances } = await buildApp();
    const domain = await createDomain(app, 'Comrodando');
    const domainsRes = await app.inject({ method: 'GET', url: '/api/board/domains' });
    const projectId = (
      domainsRes.json() as { domains: { id: string; projects: { id: string }[] }[] }
    ).domains.find((d) => d.id === domain.id)!.projects[0].id;

    const launch = await app.inject({
      method: 'POST',
      url: '/api/board/instances',
      payload: { domainId: domain.id, projectId },
    });
    expect(launch.statusCode).toBe(201);

    const del = await app.inject({ method: 'DELETE', url: `/api/board/domains/${domain.id}` });
    await app.close();
    expect(del.statusCode).toBe(200);
    expect(instances.list()).toHaveLength(0);
  });
});

describe('POST /api/board/projects', () => {
  it('cria projeto dentro do domínio informado', async () => {
    const { app } = await buildApp();
    const domain = await createDomain(app, 'Vendas');
    const res = await app.inject({
      method: 'POST',
      url: '/api/board/projects',
      payload: { domainId: domain.id, name: 'Q1' },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slug: string; domainSlug: string };
    expect(body.slug).toBe('q1');
    expect(body.domainSlug).toBe('vendas');
  });

  it('404 quando o domínio não existe', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/board/projects',
      payload: { domainId: 'nao-existe', name: 'Q1' },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/board/instances', () => {
  it('lança a instância e ela aparece em GET /api/board/instances', async () => {
    const { app } = await buildApp();
    const domain = await createDomain(app, 'Vendas');
    const domainsRes = await app.inject({ method: 'GET', url: '/api/board/domains' });
    const project = (
      domainsRes.json() as { domains: { id: string; projects: { id: string; slug: string }[] }[] }
    ).domains[0].projects[0];

    const res = await app.inject({
      method: 'POST',
      url: '/api/board/instances',
      payload: { domainId: domain.id, projectId: project.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; url: string };
    expect(body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const list = await app.inject({ method: 'GET', url: '/api/board/instances' });
    await app.close();
    expect((list.json() as { instances: { id: string }[] }).instances.map((i) => i.id)).toEqual([body.id]);
  });

  it('404 quando domainId ou projectId não existem', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/board/instances',
      payload: { domainId: 'nao-existe', projectId: 'x' },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/board/instances/:id', () => {
  it('para a instância e some da listagem', async () => {
    const { app, instances } = await buildApp();
    const domain = await createDomain(app, 'Vendas');
    const domainsRes = await app.inject({ method: 'GET', url: '/api/board/domains' });
    const project = (
      domainsRes.json() as { domains: { id: string; projects: { id: string }[] }[] }
    ).domains[0].projects[0];
    const launch = await app.inject({
      method: 'POST',
      url: '/api/board/instances',
      payload: { domainId: domain.id, projectId: project.id },
    });
    const { id } = launch.json() as { id: string };

    const res = await app.inject({ method: 'DELETE', url: `/api/board/instances/${id}` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(instances.list()).toHaveLength(0);
  });

  it('404 para id inexistente', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/board/instances/nao-existe' });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run server/__tests__/controlboardRoutes.test.ts`
Expected: FAIL — `Cannot find module '../routes/controlboardRoutes.ts'`

- [ ] **Step 3: Criar `server/routes/controlboardRoutes.ts`**

```ts
// Rotas do controlboard (/api/board/*): listar domínios+projetos (de TODOS
// os domínios, não só "local") e ligar/desligar instâncias dedicadas sob
// demanda. Processo separado de server/routes.ts — nunca roda em produção,
// só via `npm run dev` (modo board, default sem argumentos).
import type { FastifyInstance } from 'fastify';
import { listDomains, createLocalDomain, cloneDomain, deleteDomain, getDomain } from '../domains.ts';
import { listProjects, createProject, ensureRegistry } from '../files.ts';
import { setActiveDomainSlug } from '../domainContext.ts';
import type { InstanceManager } from '../controlboardInstances.ts';

type CreateDomainBody = { name?: string };
type CloneDomainBody = { url?: string; name?: string };
type CreateProjectBody = { domainId?: string; name?: string };
type LaunchBody = { domainId?: string; projectId?: string };

function errorMessage(e: any, fallback: string): string {
  return e?.stderr || e?.message || fallback;
}

function isNotFound(e: any): boolean {
  return typeof e?.message === 'string' && e.message.includes('não encontrado');
}

/**
 * Lista os projetos de um domínio SEM os efeitos colaterais de
 * `activateDomain()` (que também dispara `seedGitIfNeeded` — commit/push de
 * bootstrap via rede). Troca o domínio ativo do processo, garante o
 * registry, lê os projetos.
 */
async function listProjectsForDomain(slug: string) {
  setActiveDomainSlug(slug);
  await ensureRegistry();
  return listProjects();
}

export function registerControlboardRoutes(app: FastifyInstance, instances: InstanceManager): void {
  // GET/POST aqui percorrem domínios sequencialmente — o domínio ativo é
  // estado global do processo (server/domainContext.ts), nunca em paralelo.
  app.get('/api/board/domains', async () => {
    const domains = await listDomains();
    const withProjects: unknown[] = [];
    try {
      for (const domain of domains) {
        const projects = await listProjectsForDomain(domain.slug);
        withProjects.push({ ...domain, projects });
      }
    } finally {
      setActiveDomainSlug(null);
    }
    return { domains: withProjects };
  });

  app.post<{ Body: CreateDomainBody }>('/api/board/domains', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'Nome é obrigatório.' });
    const domain = await createLocalDomain(name);
    reply.code(201);
    return domain;
  });

  app.post<{ Body: CloneDomainBody }>('/api/board/domains/clone', async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url) return reply.code(400).send({ error: 'URL é obrigatória.' });
    try {
      const domain = await cloneDomain(url, req.body?.name?.trim());
      reply.code(201);
      return domain;
    } catch (e: any) {
      return reply.code(422).send({ error: errorMessage(e, 'Falha ao clonar repositório.') });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/board/domains/:id', async (req, reply) => {
    try {
      const domain = await getDomain(req.params.id);
      instances.stopByDomain(domain.slug);
      await deleteDomain(req.params.id);
      return { ok: true };
    } catch (e: any) {
      if (isNotFound(e)) return reply.code(404).send({ error: e.message });
      return reply.code(422).send({ error: errorMessage(e, 'Falha ao remover o domínio.') });
    }
  });

  app.post<{ Body: CreateProjectBody }>('/api/board/projects', async (req, reply) => {
    const domainId = req.body?.domainId?.trim();
    const name = req.body?.name?.trim();
    if (!domainId) return reply.code(400).send({ error: 'domainId é obrigatório.' });
    if (!name) return reply.code(400).send({ error: 'Nome é obrigatório.' });
    let domain;
    try {
      domain = await getDomain(domainId);
    } catch (e: any) {
      return reply.code(404).send({ error: e.message });
    }
    setActiveDomainSlug(domain.slug);
    try {
      await ensureRegistry();
      const project = await createProject(name);
      return { ...project, domainId: domain.id, domainSlug: domain.slug };
    } finally {
      setActiveDomainSlug(null);
    }
  });

  app.get('/api/board/instances', async () => {
    return { instances: instances.list() };
  });

  app.post<{ Body: LaunchBody }>('/api/board/instances', async (req, reply) => {
    const domainId = req.body?.domainId?.trim();
    const projectId = req.body?.projectId?.trim();
    if (!domainId || !projectId) {
      return reply.code(400).send({ error: 'domainId e projectId são obrigatórios.' });
    }
    let domain;
    try {
      domain = await getDomain(domainId);
    } catch (e: any) {
      return reply.code(404).send({ error: e.message });
    }
    const projects = await listProjectsForDomain(domain.slug);
    setActiveDomainSlug(null);
    const project = projects.find((p) => p.id === projectId);
    if (!project) return reply.code(404).send({ error: 'Projeto não encontrado.' });
    try {
      const instance = await instances.launch({
        domainSlug: domain.slug,
        domainName: domain.name,
        projectSlug: project.slug,
        projectName: project.name,
      });
      reply.code(201);
      return instance;
    } catch (e: any) {
      return reply.code(500).send({ error: errorMessage(e, 'Falha ao subir a instância.') });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/board/instances/:id', async (req, reply) => {
    const stopped = instances.stop(req.params.id);
    if (!stopped) return reply.code(404).send({ error: 'Instância não encontrada.' });
    return { ok: true };
  });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run server/__tests__/controlboardRoutes.test.ts`
Expected: PASS (12 testes)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/controlboardRoutes.ts server/__tests__/controlboardRoutes.test.ts
git commit -m "feat(controlboard): rotas /api/board/* (domínios, projetos, instâncias)"
```

---

## Task 4: UI + entry point (`server/controlboardUi.ts`, `server/controlboard.ts`)

**Files:**
- Create: `server/controlboardUi.ts`
- Create: `server/controlboard.ts`
- Test: `server/__tests__/controlboardUi.test.ts`

**Interfaces:**
- Consumes: `migrateLegacyDomains` de `./domains.ts`; `baseDataDir` de `./domainContext.ts`; `registerControlboardRoutes` de `./routes/controlboardRoutes.ts` (Task 3); `createInstanceManager` de `./controlboardInstances.ts` (Task 2); `CONTROLBOARD_HTML` de `./controlboardUi.ts`.
- Produces: `CONTROLBOARD_HTML: string`. `server/controlboard.ts` é um entry point (como `server/index.ts`) — sem exports, sem teste direto (mesma convenção do `index.ts`, que também não tem teste).

- [ ] **Step 1: Escrever o teste de sanidade da UI (falhando)**

Create `server/__tests__/controlboardUi.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONTROLBOARD_HTML } from '../controlboardUi.ts';

describe('CONTROLBOARD_HTML', () => {
  it('é uma página HTML autocontida que fala com /api/board/*', () => {
    expect(CONTROLBOARD_HTML).toContain('<html');
    expect(CONTROLBOARD_HTML).toContain('/api/board/domains');
    expect(CONTROLBOARD_HTML).toContain('/api/board/instances');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run server/__tests__/controlboardUi.test.ts`
Expected: FAIL — `Cannot find module '../controlboardUi.ts'`

- [ ] **Step 3: Criar `server/controlboardUi.ts`**

```ts
// UI estática do controlboard — HTML+JS puro, sem build/Vite. Servida como
// texto simples por server/controlboard.ts. Ferramenta de dev, não faz
// parte do bundle do app (App.tsx/AppGate/DomainPicker não mudam).
export const CONTROLBOARD_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>LocalDrawDB — Controlboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 780px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  h2 { font-size: 1rem; margin-top: 2rem; }
  .domain { border: 1px solid #8883; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; }
  .domain__head { display: flex; align-items: center; gap: 0.5rem; }
  .badge { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px; background: #8883; }
  .badge--git { background: #2a72; }
  .project { display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0; }
  .instance { display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0; }
  .error { color: #c33; margin: 0.5rem 0; min-height: 1.2em; }
  form { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
  input { flex: 1; }
</style>
</head>
<body>
<h1>LocalDrawDB — Controlboard</h1>
<div id="error" class="error"></div>

<section>
  <h2>Domínios</h2>
  <div id="domains"></div>
  <form id="new-local-form">
    <input id="new-local-name" placeholder="Nome do domínio local" />
    <button type="submit">+ Novo domínio local</button>
  </form>
  <form id="clone-form">
    <input id="clone-name" placeholder="Nome (opcional)" />
    <input id="clone-url" placeholder="URL do repositório git" />
    <button type="submit">+ Clonar repositório</button>
  </form>
</section>

<section>
  <h2>Instâncias rodando</h2>
  <div id="instances">Nenhuma.</div>
</section>

<script>
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showError(msg) {
  document.getElementById('error').textContent = msg || '';
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Falha: ' + res.status));
  return data;
}

async function refreshDomains() {
  showError('');
  try {
    const { domains } = await api('GET', '/api/board/domains');
    renderDomains(domains);
  } catch (e) {
    showError(e.message);
  }
}

function renderDomains(domains) {
  const root = document.getElementById('domains');
  root.innerHTML = '';
  for (const d of domains) {
    const el = document.createElement('div');
    el.className = 'domain';
    const badgeClass = d.hasGit ? 'badge badge--git' : 'badge';
    const badgeText = d.hasGit ? 'Git' : 'Local';
    el.innerHTML =
      '<div class="domain__head">' +
        '<span class="' + badgeClass + '">' + badgeText + '</span>' +
        '<strong>' + escapeHtml(d.name) + '</strong>' +
        '<button data-delete-domain="' + d.id + '" style="margin-left:auto">Apagar domínio</button>' +
      '</div>' +
      '<div class="projects"></div>' +
      '<form class="new-project-form" data-domain="' + d.id + '">' +
        '<input placeholder="Nome do novo projeto" required />' +
        '<button type="submit">+ Novo projeto</button>' +
      '</form>';
    const projectsEl = el.querySelector('.projects');
    for (const p of d.projects) {
      const row = document.createElement('div');
      row.className = 'project';
      row.innerHTML =
        '<span>' + escapeHtml(p.name) + '</span>' +
        '<button data-open="' + d.id + '" data-project="' + p.id + '">Abrir</button>';
      projectsEl.appendChild(row);
    }
    root.appendChild(el);
  }
}

async function refreshInstances() {
  try {
    const { instances } = await api('GET', '/api/board/instances');
    renderInstances(instances);
  } catch (e) {
    showError(e.message);
  }
}

function renderInstances(instances) {
  const root = document.getElementById('instances');
  if (instances.length === 0) {
    root.textContent = 'Nenhuma.';
    return;
  }
  root.innerHTML = '';
  for (const i of instances) {
    const row = document.createElement('div');
    row.className = 'instance';
    row.innerHTML =
      '<a href="' + i.url + '" target="_blank">' + escapeHtml(i.domainName) + ' / ' + escapeHtml(i.projectName) + ' — ' + i.url + '</a>' +
      '<button data-stop="' + i.id + '">Parar</button>';
    root.appendChild(row);
  }
}

document.getElementById('domains').addEventListener('click', async (e) => {
  const target = e.target;
  if (target.dataset.open) {
    showError('');
    try {
      await api('POST', '/api/board/instances', { domainId: target.dataset.open, projectId: target.dataset.project });
      await refreshInstances();
    } catch (err) {
      showError(err.message);
    }
  } else if (target.dataset.deleteDomain) {
    showError('');
    try {
      await api('DELETE', '/api/board/domains/' + target.dataset.deleteDomain);
      await refreshDomains();
      await refreshInstances();
    } catch (err) {
      showError(err.message);
    }
  }
});

document.getElementById('domains').addEventListener('submit', async (e) => {
  if (!e.target.classList.contains('new-project-form')) return;
  e.preventDefault();
  const domainId = e.target.dataset.domain;
  const input = e.target.querySelector('input');
  showError('');
  try {
    await api('POST', '/api/board/projects', { domainId, name: input.value.trim() });
    input.value = '';
    await refreshDomains();
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById('new-local-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('new-local-name');
  showError('');
  try {
    await api('POST', '/api/board/domains', { name: input.value.trim() });
    input.value = '';
    await refreshDomains();
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById('clone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('clone-name');
  const urlInput = document.getElementById('clone-url');
  showError('');
  try {
    await api('POST', '/api/board/domains/clone', { url: urlInput.value.trim(), name: nameInput.value.trim() || undefined });
    nameInput.value = '';
    urlInput.value = '';
    await refreshDomains();
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById('instances').addEventListener('click', async (e) => {
  const target = e.target;
  if (target.dataset.stop) {
    showError('');
    try {
      await api('DELETE', '/api/board/instances/' + target.dataset.stop);
      await refreshInstances();
    } catch (err) {
      showError(err.message);
    }
  }
});

refreshDomains();
refreshInstances();
setInterval(refreshInstances, 2000);
</script>
</body>
</html>
`;
```

- [ ] **Step 4: Rodar o teste de sanidade e confirmar que passa**

Run: `npx vitest run server/__tests__/controlboardUi.test.ts`
Expected: PASS

- [ ] **Step 5: Criar `server/controlboard.ts`**

```ts
// Processo do controlboard: UI dev-only pra escolher domínio+projeto e
// alocar uma instância dedicada sob demanda. Nunca roda em produção — só é
// spawnado por scripts/dev.mjs quando `npm run dev` roda sem argumentos.
import Fastify from 'fastify';
import { migrateLegacyDomains } from './domains.ts';
import { baseDataDir } from './domainContext.ts';
import { registerControlboardRoutes } from './routes/controlboardRoutes.ts';
import { createInstanceManager } from './controlboardInstances.ts';
import { CONTROLBOARD_HTML } from './controlboardUi.ts';

const PORT = Number(process.env.PORT ?? 5170);

async function main() {
  try {
    await migrateLegacyDomains();
  } catch (err) {
    console.error(
      `[localdrawdb] Falha ao migrar dados legados em "${baseDataDir()}" — inspecione manualmente ` +
        `antes de tentar de novo. Nenhum dado foi sobrescrito.`,
    );
    throw err;
  }

  const app = Fastify({ logger: false });
  const instances = createInstanceManager();
  registerControlboardRoutes(app, instances);

  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(CONTROLBOARD_HTML);
  });

  const shutdown = () => {
    instances.stopAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`\nlocaldrawdb controlboard\n  http://127.0.0.1:${PORT}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Verificar manualmente que o processo sobe sozinho**

Run: `PORT=5170 npx tsx server/controlboard.ts` (em background, ex.: `&` ou outro terminal)
Expected: imprime `localdrawdb controlboard` + a URL; `curl http://127.0.0.1:5170/` retorna o HTML (contém `<title>LocalDrawDB`); `curl http://127.0.0.1:5170/api/board/domains` retorna `{"domains":[]}` ou os domínios existentes em `data/`. Encerre com `Ctrl-C` (ou `kill`).

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm run test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/controlboardUi.ts server/controlboard.ts server/__tests__/controlboardUi.test.ts
git commit -m "feat(controlboard): UI do dashboard + entry point do processo"
```

---

## Task 5: `npm run dev` default vira `board` + docs

**Files:**
- Modify: `scripts/devArgs.mjs`
- Modify: `scripts/__tests__/devArgs.test.ts`
- Modify: `scripts/dev.mjs`
- Modify: `README.md`
- Modify: `./ldb`

**Interfaces:**
- Consumes: `ROOT`, `TSX_CLI` de `./instanceLauncher.mjs` (Task 1, já importados em `dev.mjs`); `findFreePort` de `./devPorts.mjs` (já importado).
- Produces: `parseDevArgs([])` agora retorna `{ mode: 'board', slugs: null, preview: false }`; `resolveSlugs` trata `mode === 'board'` como `null` (mesma família de `shared`/`list`).

- [ ] **Step 1: Atualizar os testes de `devArgs` pra refletir o novo default (vão falhar até o Step 2)**

Em `scripts/__tests__/devArgs.test.ts`, troque:

```js
  it('sem flags = todos os projetos (all)', () => {
    expect(parseDevArgs([])).toEqual({ mode: 'all', slugs: null, preview: false });
  });
```

Por:

```js
  it('sem flags = controlboard (board)', () => {
    expect(parseDevArgs([])).toEqual({ mode: 'board', slugs: null, preview: false });
  });
```

E troque:

```js
  it('sem flags (default) → todos os slugs', () => {
    expect(resolveSlugs(parseDevArgs([]), REG)).toEqual(['alpha', 'beta']);
  });
```

Por:

```js
  it('sem flags (default) → null (controlboard decide na UI)', () => {
    expect(resolveSlugs(parseDevArgs([]), REG)).toBeNull();
  });
```

- [ ] **Step 2: Rodar e confirmar que falham (comportamento antigo ainda no código)**

Run: `npx vitest run scripts/__tests__/devArgs.test.ts`
Expected: FAIL nos 2 testes alterados (`--all` continua passando)

- [ ] **Step 3: Atualizar `scripts/devArgs.mjs`**

No topo, o comentário do arquivo:

```js
// Parser puro das flags/slugs do launcher multimodo. Sem efeitos colaterais.
//
// SEM argumentos → `all` (todos os projetos, cada um na sua porta). `--shared` força a
// instância única compartilhada (comportamento antigo). Slugs POSICIONAIS (estilo
// `uv run`): `lakehouse`, `vendas rh`, `vendas,rh`. Flags: --all, --shared, --preview,
// --list, e os aliases --project/--projects.
```

Por:

```js
// Parser puro das flags/slugs do launcher multimodo. Sem efeitos colaterais.
//
// SEM argumentos → `board` (controlboard: tela de escolha, aloca porta só quando você
// clica). `--all` sobe todos de uma vez (comportamento eager de antes); `--shared` força
// a instância única compartilhada. Slugs POSICIONAIS (estilo `uv run`): `lakehouse`,
// `vendas rh`, `vendas,rh`. Flags: --all, --shared, --preview, --list, e os aliases
// --project/--projects.
```

No final de `parseDevArgs`, troque:

```js
  if (list) return { mode: 'list', slugs: null, preview: false };
  if (slugs.length) return { mode: 'project', slugs, preview };
  // Sem slugs: default = TODOS; --shared força a instância única compartilhada.
  return { mode: explicit === 'shared' ? 'shared' : 'all', slugs: null, preview };
}
```

Por:

```js
  if (list) return { mode: 'list', slugs: null, preview: false };
  if (slugs.length) return { mode: 'project', slugs, preview };
  // Sem slugs: default = controlboard (a escolha fica na UI). --all/--shared
  // continuam como atalhos explícitos pro comportamento eager de sempre.
  if (explicit === 'shared') return { mode: 'shared', slugs: null, preview };
  if (explicit === 'all') return { mode: 'all', slugs: null, preview };
  return { mode: 'board', slugs: null, preview };
}
```

Em `resolveSlugs`, troque:

```js
export function resolveSlugs(parsed, registry) {
  const available = registry.projects.map((p) => p.slug);
  if (parsed.mode === 'shared' || parsed.mode === 'list') return null;
```

Por:

```js
export function resolveSlugs(parsed, registry) {
  const available = registry.projects.map((p) => p.slug);
  if (parsed.mode === 'shared' || parsed.mode === 'list' || parsed.mode === 'board') return null;
```

- [ ] **Step 4: Rodar os testes de `devArgs` e confirmar que passam**

Run: `npx vitest run scripts/__tests__/devArgs.test.ts`
Expected: PASS (todos os testes, incluindo os 2 alterados)

- [ ] **Step 5: Adicionar o branch `board` em `scripts/dev.mjs`**

Logo depois da definição de `supervise()` e antes de `if (parsed.preview) {`, troque:

```js
if (parsed.preview) {
  // --- Preview mode: serve built dist/ via Fastify static, no Vite ---
```

Por:

```js
if (parsed.mode === 'board') {
  // --- Board mode: sobe só o controlboard; instâncias nascem sob demanda ---
  const port = await findFreePort(Number(process.env.CONTROLBOARD_PORT) || 5170);
  const env = { ...process.env, PORT: String(port) };
  const server = spawn(process.execPath, [TSX_CLI, 'server/controlboard.ts'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  const handle = { server, web: null };
  instances.push(handle);
  supervise(handle);
} else if (parsed.preview) {
  // --- Preview mode: serve built dist/ via Fastify static, no Vite ---
```

(O `else` que fechava o `if (parsed.preview)` original — bloco "Dev mode (non-preview)" — continua exatamente como está, só que agora como `else` de uma cadeia `if/else if/else` de três braços em vez de dois.)

- [ ] **Step 6: Smoke manual do modo board**

Run: `npm run dev` (sem argumentos)
Expected: imprime a URL do controlboard (não sobe mais todos os projetos de uma vez); abrir a URL no navegador mostra a lista de domínios; clicar "Abrir" num projeto aloca uma instância nova e ela aparece em "Instâncias rodando" com link funcionando; "Parar" mata o processo (a porta é liberada — `lsof -i :<porta>` some). `Ctrl-C` no terminal do `npm run dev` encerra o controlboard.

Run: `npm run dev:all` e `npm run dev:shared`
Expected: continuam subindo exatamente como antes (nenhuma regressão nos modos explícitos).

- [ ] **Step 7: Atualizar `README.md`**

Substitua o bloco (linhas 21-30):

```
```bash
npm install
npm run dev          # sobe TODOS os projetos, cada um na sua porta (o terminal lista as URLs)
npm run dev:shared   # 1 instância única servindo todos, com o seletor de projeto na UI
# Ctrl-C encerra todas as instâncias do conjunto
```

> `npm run dev` sem argumentos abre **um servidor por projeto** (cada um numa porta). Para
> rodar **só alguns**, passe os slugs (ver abaixo); para a **instância única** de antes, use
> `npm run dev:shared` (ou `./ldb --shared`).
```

Por:

```
```bash
npm install
npm run dev          # abre o controlboard — escolha domínio/projeto, a porta é alocada ao clicar
npm run dev:all       # sobe TODOS os projetos de uma vez, cada um na sua porta (comportamento antigo)
npm run dev:shared   # 1 instância única servindo todos, com o seletor de projeto na UI
# Ctrl-C encerra o controlboard (e as instâncias que ele abriu) ou o conjunto do modo escolhido
```

> `npm run dev` sem argumentos abre o **controlboard**: uma tela pra escolher qual
> domínio/projeto abrir, alocando a porta só quando você clica. Para rodar **todos de uma
> vez** (comportamento de antes), use `npm run dev:all` (ou `./ldb --all`); para a
> **instância única** com seletor embutido, `npm run dev:shared` (ou `./ldb --shared`); para
> pular a UI e ir direto a um projeto conhecido, passe os slugs (ver abaixo).
```

E substitua (linhas 39-63):

```
### Rodar projetos em portas isoladas

**Sem argumentos, sobe todos os projetos** (cada um na sua porta) — para comparar lado a
lado e **controlar o consumo de memória**. Use o atalho **`./ldb`** (estilo `uv run`, sem o
`--` do npm):

```bash
./ldb                    # TODOS os projetos, 1 por porta (default)
./ldb --list             # lista os projetos (slug + nome)
./ldb lakehouse          # só 1 projeto (casa por substring única do slug)
./ldb vendas rh          # só esses, cada um na sua porta
./ldb --all --preview    # todos, build estático (leve, sem Vite)
./ldb --shared           # instância única servindo todos (com o seletor de projeto)
```

Sem o atalho, via npm (precisa do `--` para repassar slugs/flags):

```bash
npm run dev                        # = ./ldb  (todos)
npm run list                       # = ./ldb --list
npm run dev:shared                 # = ./ldb --shared
npm run preview:all                # = ./ldb --all --preview
npm run dev -- lakehouse           # só 1 projeto (slug posicional)
npm run dev -- vendas rh           # só esses
```
```

Por:

```
### Controlboard (default) e portas isoladas

**Sem argumentos, `npm run dev` abre o controlboard**: uma tela que lista os domínios
(locais e git) e os projetos dentro deles — a porta só é alocada quando você clica em
"Abrir". Várias instâncias podem ficar rodando ao mesmo tempo; o controlboard passa a
listá-las com link e botão "Parar".

Pra pular a UI e ir direto a projeto(s) conhecido(s) — cada um na sua porta, pra comparar
lado a lado e **controlar o consumo de memória** — use o atalho **`./ldb`** (estilo
`uv run`, sem o `--` do npm):

```bash
./ldb                    # controlboard (default)
./ldb --all              # TODOS os projetos de uma vez, 1 por porta
./ldb --list             # lista os projetos (slug + nome)
./ldb lakehouse          # só 1 projeto (casa por substring única do slug)
./ldb vendas rh          # só esses, cada um na sua porta
./ldb --all --preview    # todos, build estático (leve, sem Vite)
./ldb --shared           # instância única servindo todos (com o seletor de projeto)
```

Sem o atalho, via npm (precisa do `--` para repassar slugs/flags):

```bash
npm run dev                        # = ./ldb  (controlboard)
npm run dev:all                    # = ./ldb --all
npm run list                       # = ./ldb --list
npm run dev:shared                 # = ./ldb --shared
npm run preview:all                # = ./ldb --all --preview
npm run dev -- lakehouse           # só 1 projeto (slug posicional)
npm run dev -- vendas rh           # só esses
```
```

- [ ] **Step 8: Atualizar o cabeçalho de `./ldb`**

Troque:

```sh
#!/bin/sh
# ldb — atalho para o launcher multimodo (estilo `uv run`), sem o `--` do npm.
#
#   ./ldb                 modo compartilhado (todos os projetos, 1 instância)
#   ./ldb --list          lista os projetos (slug + nome)
#   ./ldb lakehouse       fixa 1 projeto (casa por substring única do slug)
#   ./ldb vendas rh       vários projetos, cada um na sua porta
#   ./ldb --all           1 instância por projeto
#   ./ldb --preview vendas rh   modo leve (build estático, sem Vite)
exec node "$(dirname "$0")/scripts/dev.mjs" "$@"
```

Por:

```sh
#!/bin/sh
# ldb — atalho para o launcher multimodo (estilo `uv run`), sem o `--` do npm.
#
#   ./ldb                 controlboard (escolhe domínio/projeto, aloca porta ao clicar)
#   ./ldb --list          lista os projetos (slug + nome)
#   ./ldb lakehouse       fixa 1 projeto (casa por substring única do slug)
#   ./ldb vendas rh       vários projetos, cada um na sua porta
#   ./ldb --all           todos de uma vez, 1 instância por projeto
#   ./ldb --shared        instância única compartilhada (com o seletor de projeto)
#   ./ldb --preview vendas rh   modo leve (build estático, sem Vite)
exec node "$(dirname "$0")/scripts/dev.mjs" "$@"
```

- [ ] **Step 9: Rodar a suíte inteira uma última vez**

Run: `npm run test && npm run typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add scripts/devArgs.mjs scripts/__tests__/devArgs.test.ts scripts/dev.mjs README.md ldb
git commit -m "feat(dev): npm run dev sem args abre o controlboard por default"
```

---

## Self-Review (spec coverage)

- Listar domínios locais+git e projetos dentro deles → Task 3 (`GET /api/board/domains`).
- Alocar porta só ao clicar → Task 2 (`InstanceManager.launch`) + Task 3 (`POST /api/board/instances`).
- Vários simultâneos → `InstanceManager` usa `Map`, testado no Task 2.
- Controlboard vira dashboard (lista instâncias + parar) → Task 3 (`GET`/`DELETE /api/board/instances`) + Task 4 (UI).
- Domínio+projeto direto (sem picker interno) → `startInstance` pina `LOCALDRAWDB_DOMAIN`/`LOCALDRAWDB_PROJECT`, igual ao `--all` de hoje (Task 1).
- Atalho de CLI (`npm run dev -- <slug>`) inalterado → Task 1 Step 6 smoke + Global Constraints.
- Apagar domínio (reaproveitando `deleteDomain`) → Task 3 (`DELETE /api/board/domains/:id`, para instâncias antes).
- Nenhuma mudança em `AppGate`/`DomainPicker`/`App.tsx` → nenhuma task toca esses arquivos.
