# Domínios versionados (git) — Camada de servidor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a camada de servidor da [Spec A](../specs/2026-08-04-git-domains-versioning-design.md): hierarquia `domínio (opcionalmente git) → projeto → arquivos`, wrapper de comandos git, montagem de URL de PR, rotas HTTP e migração automática do layout legado — sem quebrar nenhum teste existente.

**Architecture:** `server/files.ts` (CRUD de projetos, já existente) passa a resolver seu "diretório de dados" a partir de um **domínio ativo** (novo módulo `server/domainContext.ts`), em vez de um único `data/` global. Um novo módulo `server/domains.ts` gerencia o registro de domínios (`data/domains.json`) e as pastas `data/domains/<slug>/` (cada uma contendo, internamente, o mesmo layout `projects.json` + `projects/` que `files.ts` já sabe manipular). Um wrapper fino `server/git.ts` roda `git` via `child_process`. Rotas novas em `server/routes/domainRoutes.ts` expõem tudo isso; as rotas legadas de projeto continuam funcionando inalteradas, desde que um domínio esteja ativo.

**Tech Stack:** Node.js/TypeScript, Fastify, Vitest, `node:child_process` (sem novas dependências de terceiros).

## Global Constraints

- Nenhum teste existente pode quebrar (`npm test` verde do início ao fim — cada task roda a suíte completa, não só os testes novos).
- `npm run typecheck` verde ao final de cada task.
- Nenhuma dependência nova no `package.json` — git é invocado via `child_process`, sem lib.
- Todo path usa `node:path` (`path.join`/`path.sep`) — nada de `/` hardcoded (requisito multiplataforma da Spec A).
- Compatibilidade retroativa de `LOCALDRAWDB_DATA_DIR` (usado por ~150 testes existentes) é **obrigatória**: quando essa env var está setada e nenhum domínio foi explicitamente ativado, `files.ts` deve se comportar **exatamente** como hoje.
- Mensagens de erro voltadas ao usuário em português, no mesmo tom do restante do `server/`.

## Dependency Graph (para execução em paralelo)

```
Camada 0 (paralelizável entre si, sem dependências):
  Task 1 — server/paths.ts + server/domainContext.ts
  Task 2 — server/git.ts
  Task 3 — server/prUrl.ts

Camada 1 (depende só da Camada 0; paralelizável entre si):
  Task 4 — server/domains.ts        (depende de Task 1 + Task 2)
  Task 5 — server/files.ts (rewire)  (depende de Task 1)

Camada 2 (sequencial, depende de tudo acima):
  Task 6 — rotas + boot (server/routes.ts, server/routes/domainRoutes.ts, server/index.ts)
           (depende de Task 2, 3, 4, 5)
  Task 7 — CLI (scripts/ensureRegistry.ts, scripts/createProject.ts, scripts/registry.mjs, scripts/dev.mjs)
           (depende de Task 4; pode rodar em paralelo com Task 6)
```

Se despachando em multitarefa: rode Task 1, 2 e 3 em paralelo primeiro; depois Task 4 e 5 em paralelo; depois Task 6 e 7 em paralelo.

---

### Task 1: `server/paths.ts` + `server/domainContext.ts`

**Files:**
- Create: `server/paths.ts`
- Create: `server/domainContext.ts`
- Modify: `server/files.ts:1-16` (importar `ROOT`/`DATA_DIR` de `paths.ts` em vez de calculá-los)
- Test: `server/__tests__/domainContext.test.ts`

**Interfaces:**
- Consumes: nada (módulo raiz da árvore de dependências).
- Produces:
  - `paths.ts`: `export const ROOT: string`, `export const DATA_DIR: string`.
  - `domainContext.ts`: `export function baseDataDir(): string`, `export function domainsRootDir(): string`, `export function domainsRegistryPath(): string`, `export function domainDirFor(slug: string): string`, `export function setActiveDomainSlug(slug: string | null): void`, `export function getActiveDomainSlug(): string | null`, `export function activeDomainDir(): string` (lança erro se nenhum domínio ativo).

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// server/__tests__/domainContext.test.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-domainctx-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  delete process.env.LOCALDRAWDB_DOMAIN;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('domainContext', () => {
  it('domainsRootDir/domainDirFor resolvem sob LOCALDRAWDB_DATA_DIR', async () => {
    const { domainsRootDir, domainDirFor } = await import('../domainContext.ts');
    expect(domainsRootDir()).toBe(path.join(tmpDir, 'domains'));
    expect(domainDirFor('acme')).toBe(path.join(tmpDir, 'domains', 'acme'));
  });

  it('getActiveDomainSlug começa null sem env nem chamada explícita', async () => {
    const { getActiveDomainSlug } = await import('../domainContext.ts');
    expect(getActiveDomainSlug()).toBeNull();
  });

  it('setActiveDomainSlug muda o valor em memória', async () => {
    const { setActiveDomainSlug, getActiveDomainSlug } = await import('../domainContext.ts');
    setActiveDomainSlug('acme');
    expect(getActiveDomainSlug()).toBe('acme');
    setActiveDomainSlug(null);
    expect(getActiveDomainSlug()).toBeNull();
  });

  it('LOCALDRAWDB_DOMAIN funciona como pin quando nada foi setado em memória', async () => {
    process.env.LOCALDRAWDB_DOMAIN = 'beta';
    const { getActiveDomainSlug } = await import('../domainContext.ts');
    expect(getActiveDomainSlug()).toBe('beta');
  });

  it('setActiveDomainSlug em memória tem prioridade sobre LOCALDRAWDB_DOMAIN', async () => {
    process.env.LOCALDRAWDB_DOMAIN = 'beta';
    const { setActiveDomainSlug, getActiveDomainSlug } = await import('../domainContext.ts');
    setActiveDomainSlug('acme');
    expect(getActiveDomainSlug()).toBe('acme');
  });

  it('activeDomainDir lança erro claro quando nenhum domínio está ativo', async () => {
    const { activeDomainDir } = await import('../domainContext.ts');
    expect(() => activeDomainDir()).toThrow(/domínio ativo/i);
  });

  it('activeDomainDir resolve para domainDirFor(slug) quando há domínio ativo', async () => {
    const { setActiveDomainSlug, activeDomainDir, domainDirFor } = await import('../domainContext.ts');
    setActiveDomainSlug('acme');
    expect(activeDomainDir()).toBe(domainDirFor('acme'));
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run server/__tests__/domainContext.test.ts`
Expected: FAIL — `Cannot find module '../domainContext.ts'`.

- [ ] **Step 3: Implementar `paths.ts`**

```ts
// server/paths.ts
// Raiz do repositório e diretório de dados default — únicas fontes de
// verdade para ambos, para evitar ciclos de import entre files.ts e
// domainContext.ts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
```

- [ ] **Step 4: Implementar `domainContext.ts`**

```ts
// server/domainContext.ts
// Resolve qual domínio (data/domains/<slug>/) está ativo no processo, para
// que server/files.ts saiba onde ler/gravar projects.json + projects/.
import path from 'node:path';
import { DATA_DIR } from './paths.ts';

export const DOMAINS_DIR_NAME = 'domains';
export const DOMAINS_REGISTRY_FILE = 'domains.json';

/** Diretório base de dados: LOCALDRAWDB_DATA_DIR (testes) ou ROOT/data (produção). */
export function baseDataDir(): string {
  return process.env.LOCALDRAWDB_DATA_DIR ?? DATA_DIR;
}

export function domainsRootDir(): string {
  return path.join(baseDataDir(), DOMAINS_DIR_NAME);
}

export function domainsRegistryPath(): string {
  return path.join(baseDataDir(), DOMAINS_REGISTRY_FILE);
}

export function domainDirFor(slug: string): string {
  return path.join(domainsRootDir(), slug);
}

let activeDomainSlug: string | null = null;

/** Define o domínio ativo do processo (contexto em memória — não persiste em disco). */
export function setActiveDomainSlug(slug: string | null): void {
  activeDomainSlug = slug;
}

/** Domínio ativo: memória (setActiveDomainSlug) > LOCALDRAWDB_DOMAIN (pin de processo) > null. */
export function getActiveDomainSlug(): string | null {
  return activeDomainSlug ?? process.env.LOCALDRAWDB_DOMAIN?.trim() ?? null;
}

/** Diretório do domínio ativo. Lança erro se nenhum domínio estiver ativo. */
export function activeDomainDir(): string {
  const slug = getActiveDomainSlug();
  if (!slug) {
    throw new Error('Nenhum domínio ativo — selecione um projeto na tela de escolha.');
  }
  return domainDirFor(slug);
}
```

- [ ] **Step 5: Atualizar `server/files.ts` para importar de `paths.ts`**

Em `server/files.ts:1-16`, substituir o cálculo local de `ROOT`/`DATA_DIR`:

```ts
// Acesso ao diretório data/ (input, output, persistência). NUNCA versionado.
// Camada de projeto — data/domains/<slug>/projects/<slug>/
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, DATA_DIR } from './paths.ts';

export { ROOT, DATA_DIR };
```

Remover as linhas antigas que definiam `ROOT`/`DATA_DIR` via `fileURLToPath` (o resto do arquivo continua igual — nenhuma outra mudança neste step).

- [ ] **Step 6: Rodar e confirmar sucesso**

Run: `npx vitest run server/__tests__/domainContext.test.ts server/__tests__/files.test.ts server/__tests__/projects.test.ts`
Expected: PASS em todos.

- [ ] **Step 7: Rodar a suíte completa e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (nenhuma regressão).

- [ ] **Step 8: Commit**

```bash
git add server/paths.ts server/domainContext.ts server/files.ts server/__tests__/domainContext.test.ts
git commit -m "feat(server): extrai paths.ts e adiciona domainContext (domínio ativo)"
```

---

### Task 2: `server/git.ts` — wrapper de comandos git

**Files:**
- Create: `server/git.ts`
- Test: `server/__tests__/git.test.ts`

**Interfaces:**
- Consumes: nada (só `node:child_process`).
- Produces:
  ```ts
  export class GitError extends Error { readonly stderr: string; }
  export interface GitStatus { branch: string; ahead: number; behind: number; dirty: boolean; files: string[]; }
  export function isGitAvailable(): Promise<boolean>;
  export function isGitRepo(dir: string): Promise<boolean>;
  export function currentBranch(dir: string): Promise<string>;
  export function listBranches(dir: string): Promise<string[]>;
  export function getStatus(dir: string): Promise<GitStatus>;
  export function switchBranch(dir: string, branch: string, create?: boolean): Promise<void>;
  export function pull(dir: string): Promise<void>;
  export function commitAndPush(dir: string, message: string): Promise<{ branch: string }>;
  export function remoteUrl(dir: string): Promise<string | null>;
  export function cloneRepo(url: string, destDir: string): Promise<void>;
  export function initRepo(dir: string, remoteUrl?: string): Promise<void>;
  export function credentialApprove(dir: string, input: { protocol: string; host: string; username: string; password: string }): Promise<void>;
  ```

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// server/__tests__/git.test.ts
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

function mockExecFileOnce(stdout: string, stderr = '') {
  execFileMock.mockImplementationOnce((_cmd, _args, optsOrCb, cb) => {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
    callback(null, stdout, stderr);
  });
}

function mockExecFileFail(stderr: string) {
  execFileMock.mockImplementationOnce((_cmd, _args, optsOrCb, cb) => {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
    const err = new Error('git failed') as Error & { stderr?: string };
    err.stderr = stderr;
    callback(err, '', stderr);
  });
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe('isGitAvailable', () => {
  it('true quando `git --version` funciona', async () => {
    mockExecFileOnce('git version 2.40.0');
    const { isGitAvailable } = await import('../git.ts');
    expect(await isGitAvailable()).toBe(true);
  });

  it('false quando o comando falha', async () => {
    mockExecFileFail('command not found');
    const { isGitAvailable } = await import('../git.ts');
    expect(await isGitAvailable()).toBe(false);
  });
});

describe('getStatus', () => {
  it('parseia branch, dirty e arquivos modificados', async () => {
    mockExecFileOnce('main'); // rev-parse --abbrev-ref HEAD
    mockExecFileOnce(' M src/App.tsx\n?? novo.txt'); // status --porcelain
    mockExecFileFail('no upstream'); // rev-list ahead/behind (sem upstream)
    const { getStatus } = await import('../git.ts');
    const status = await getStatus('/tmp/repo');
    expect(status.branch).toBe('main');
    expect(status.dirty).toBe(true);
    expect(status.files).toEqual(['src/App.tsx', 'novo.txt']);
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
  });

  it('sem mudanças pendentes: dirty=false', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce('2\t1');
    const { getStatus } = await import('../git.ts');
    const status = await getStatus('/tmp/repo');
    expect(status.dirty).toBe(false);
    expect(status.files).toEqual([]);
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(1);
  });
});

describe('pull', () => {
  it('bloqueia quando há mudanças não commitadas', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce(' M src/App.tsx');
    mockExecFileFail('no upstream');
    const { pull } = await import('../git.ts');
    await expect(pull('/tmp/repo')).rejects.toThrow(/não commitadas/i);
  });

  it('roda `git pull` quando não há mudanças pendentes', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce('0\t0');
    mockExecFileOnce('Already up to date.');
    const { pull } = await import('../git.ts');
    await expect(pull('/tmp/repo')).resolves.toBeUndefined();
    expect(execFileMock).toHaveBeenCalledTimes(4);
  });
});

describe('switchBranch', () => {
  it('bloqueia quando há mudanças não commitadas', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce(' M src/App.tsx');
    mockExecFileFail('no upstream');
    const { switchBranch } = await import('../git.ts');
    await expect(switchBranch('/tmp/repo', 'outra')).rejects.toThrow(/não commitadas/i);
  });

  it('usa `switch -c` quando create=true', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce('0\t0');
    mockExecFileOnce('');
    const { switchBranch } = await import('../git.ts');
    await switchBranch('/tmp/repo', 'nova', true);
    const lastCall = execFileMock.mock.calls.at(-1)!;
    expect(lastCall[1]).toEqual(['switch', '-c', 'nova']);
  });
});

describe('commitAndPush', () => {
  it('lança erro claro quando não há nada para publicar', async () => {
    mockExecFileOnce('main'); // currentBranch
    mockExecFileOnce(''); // add -A
    mockExecFileOnce(''); // status --porcelain (vazio = nada pendente)
    const { commitAndPush } = await import('../git.ts');
    await expect(commitAndPush('/tmp/repo', 'msg')).rejects.toThrow(/nada para publicar/i);
  });

  it('commita e publica quando há mudanças', async () => {
    mockExecFileOnce('main'); // currentBranch
    mockExecFileOnce(''); // add -A
    mockExecFileOnce(' M src/App.tsx'); // status --porcelain
    mockExecFileOnce(''); // commit
    mockExecFileOnce(''); // push
    const { commitAndPush } = await import('../git.ts');
    const result = await commitAndPush('/tmp/repo', 'minha mensagem');
    expect(result).toEqual({ branch: 'main' });
    const pushCall = execFileMock.mock.calls.at(-1)!;
    expect(pushCall[1]).toEqual(['push', '-u', 'origin', 'main']);
  });
});

describe('remoteUrl', () => {
  it('retorna null quando não há remote origin', async () => {
    mockExecFileFail('No such remote');
    const { remoteUrl } = await import('../git.ts');
    expect(await remoteUrl('/tmp/repo')).toBeNull();
  });

  it('retorna a URL quando existe', async () => {
    mockExecFileOnce('https://github.com/acme/repo.git');
    const { remoteUrl } = await import('../git.ts');
    expect(await remoteUrl('/tmp/repo')).toBe('https://github.com/acme/repo.git');
  });
});

describe('credentialApprove', () => {
  it('escreve o payload no stdin do processo git credential approve', async () => {
    const writes: string[] = [];
    execFileMock.mockImplementationOnce((_cmd, args, _opts, cb) => {
      expect(args).toEqual(['credential', 'approve']);
      const child = new EventEmitter() as EventEmitter & { stdin: { write: (s: string) => void; end: () => void } };
      child.stdin = {
        write: (s: string) => writes.push(s),
        end: () => cb(null, '', ''),
      };
      return child;
    });
    const { credentialApprove } = await import('../git.ts');
    await credentialApprove('/tmp/repo', {
      protocol: 'https', host: 'github.com', username: 'me', password: 'tok123',
    });
    expect(writes.join('')).toContain('host=github.com');
    expect(writes.join('')).toContain('password=tok123');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run server/__tests__/git.test.ts`
Expected: FAIL — `Cannot find module '../git.ts'`.

- [ ] **Step 3: Implementar `server/git.ts`**

```ts
// server/git.ts
// Wrapper fino sobre o `git` do sistema (child_process). Sem lib de git em
// JS — decisão da Spec A (robustez de auth/SSH/LFS de graça).
import { execFile } from 'node:child_process';
import path from 'node:path';

export class GitError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'GitError';
    this.stderr = stderr;
  }
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  files: string[];
}

function run(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) {
        const stderrText = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? stderr ?? err.message;
        reject(new GitError(`git ${args.join(' ')} falhou`, stderrText));
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

export async function isGitAvailable(): Promise<boolean> {
  try {
    await run(process.cwd(), ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await run(dir, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

export async function currentBranch(dir: string): Promise<string> {
  return run(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export async function listBranches(dir: string): Promise<string[]> {
  const out = await run(dir, ['branch', '--format=%(refname:short)']);
  return out ? out.split('\n') : [];
}

export async function getStatus(dir: string): Promise<GitStatus> {
  const branch = await currentBranch(dir);
  const porcelain = await run(dir, ['status', '--porcelain']);
  const files = porcelain ? porcelain.split('\n').map((l) => l.slice(3).trim()) : [];
  let ahead = 0;
  let behind = 0;
  try {
    const counts = await run(dir, ['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`]);
    const [a, b] = counts.split(/\s+/).map(Number);
    ahead = a ?? 0;
    behind = b ?? 0;
  } catch {
    // sem upstream configurado — sem ahead/behind, não é um erro fatal
  }
  return { branch, ahead, behind, dirty: files.length > 0, files };
}

export async function switchBranch(dir: string, branch: string, create = false): Promise<void> {
  const status = await getStatus(dir);
  if (status.dirty) {
    throw new Error('Há mudanças não commitadas — salve ou commite antes de trocar de branch.');
  }
  await run(dir, create ? ['switch', '-c', branch] : ['switch', branch]);
}

export async function pull(dir: string): Promise<void> {
  const status = await getStatus(dir);
  if (status.dirty) {
    throw new Error('Há mudanças não commitadas — salve ou commite antes de atualizar.');
  }
  await run(dir, ['pull']);
}

export async function commitAndPush(dir: string, message: string): Promise<{ branch: string }> {
  const branch = await currentBranch(dir);
  await run(dir, ['add', '-A']);
  const pending = await run(dir, ['status', '--porcelain']);
  if (!pending) {
    throw new Error('Nada para publicar — nenhuma mudança pendente.');
  }
  await run(dir, ['commit', '-m', message]);
  await run(dir, ['push', '-u', 'origin', branch]);
  return { branch };
}

export async function remoteUrl(dir: string): Promise<string | null> {
  try {
    return await run(dir, ['remote', 'get-url', 'origin']);
  } catch {
    return null;
  }
}

export async function cloneRepo(url: string, destDir: string): Promise<void> {
  await run(path.dirname(destDir), ['clone', url, destDir]);
}

export async function initRepo(dir: string, remoteUrl?: string): Promise<void> {
  await run(dir, ['init']);
  if (remoteUrl) {
    await run(dir, ['remote', 'add', 'origin', remoteUrl]);
  }
}

export async function credentialApprove(
  dir: string,
  input: { protocol: string; host: string; username: string; password: string },
): Promise<void> {
  const payload =
    `protocol=${input.protocol}\nhost=${input.host}\nusername=${input.username}\n` +
    `password=${input.password}\n\n`;
  await new Promise<void>((resolve, reject) => {
    const child = execFile('git', ['credential', 'approve'], { cwd: dir }, (err, _stdout, stderr) => {
      if (err) {
        reject(new GitError('git credential approve falhou', stderr ?? err.message));
        return;
      }
      resolve();
    });
    child.stdin?.write(payload);
    child.stdin?.end();
  });
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run server/__tests__/git.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/git.ts server/__tests__/git.test.ts
git commit -m "feat(server): wrapper de comandos git (status, branch, pull, publicar)"
```

---

### Task 3: `server/prUrl.ts` — montagem de URL de PR/MR por host

**Files:**
- Create: `server/prUrl.ts`
- Test: `server/__tests__/prUrl.test.ts`

**Interfaces:**
- Consumes: nada (função pura).
- Produces:
  ```ts
  export interface PrUrlResult { host: string; url: string; }
  export function buildPrUrl(remoteUrl: string, branch: string): PrUrlResult | null;
  ```

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// server/__tests__/prUrl.test.ts
import { describe, expect, it } from 'vitest';
import { buildPrUrl } from '../prUrl.ts';

describe('buildPrUrl', () => {
  it('GitHub HTTPS', () => {
    const r = buildPrUrl('https://github.com/acme/repo.git', 'feature/x');
    expect(r).toEqual({ host: 'github.com', url: 'https://github.com/acme/repo/compare/feature/x?expand=1' });
  });

  it('GitHub SSH', () => {
    const r = buildPrUrl('git@github.com:acme/repo.git', 'feature/x');
    expect(r).toEqual({ host: 'github.com', url: 'https://github.com/acme/repo/compare/feature/x?expand=1' });
  });

  it('GitLab HTTPS', () => {
    const r = buildPrUrl('https://gitlab.com/acme/repo.git', 'feature/x');
    expect(r).toEqual({
      host: 'gitlab.com',
      url: 'https://gitlab.com/acme/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fx',
    });
  });

  it('Bitbucket HTTPS', () => {
    const r = buildPrUrl('https://bitbucket.org/acme/repo.git', 'feature/x');
    expect(r).toEqual({
      host: 'bitbucket.org',
      url: 'https://bitbucket.org/acme/repo/pull-requests/new?source=feature%2Fx',
    });
  });

  it('Azure DevOps HTTPS', () => {
    const r = buildPrUrl('https://dev.azure.com/acme/proj/_git/repo', 'feature/x');
    expect(r).toEqual({
      host: 'dev.azure.com',
      url: 'https://dev.azure.com/acme/proj/_git/repo/pullrequestcreate?sourceRef=feature%2Fx',
    });
  });

  it('host desconhecido retorna null', () => {
    expect(buildPrUrl('https://git.empresa-interna.com/acme/repo.git', 'feature/x')).toBeNull();
  });

  it('URL de remote inválida retorna null em vez de lançar', () => {
    expect(buildPrUrl('not-a-url', 'feature/x')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run server/__tests__/prUrl.test.ts`
Expected: FAIL — `Cannot find module '../prUrl.ts'`.

- [ ] **Step 3: Implementar `server/prUrl.ts`**

```ts
// server/prUrl.ts
// Monta a URL de "abrir PR/MR" a partir do remote origin — heurística por
// host. Host desconhecido retorna null (front mostra só a URL crua).

export interface PrUrlResult {
  host: string;
  url: string;
}

/** Normaliza `git@host:owner/repo.git` e `https://host/owner/repo.git` para { host, ownerRepoPath }. */
function parseRemote(remoteUrl: string): { host: string; ownerRepoPath: string } | null {
  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (sshMatch) {
    return { host: sshMatch[1], ownerRepoPath: sshMatch[2] };
  }
  try {
    const url = new URL(remoteUrl);
    const cleanPath = url.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
    return { host: url.host, ownerRepoPath: cleanPath };
  } catch {
    return null;
  }
}

export function buildPrUrl(remoteUrl: string, branch: string): PrUrlResult | null {
  const parsed = parseRemote(remoteUrl);
  if (!parsed) return null;
  const { host, ownerRepoPath } = parsed;
  const encodedBranch = encodeURIComponent(branch);

  if (host === 'github.com') {
    return { host, url: `https://github.com/${ownerRepoPath}/compare/${branch}?expand=1` };
  }
  if (host === 'gitlab.com') {
    return {
      host,
      url: `https://gitlab.com/${ownerRepoPath}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodedBranch}`,
    };
  }
  if (host === 'bitbucket.org') {
    return { host, url: `https://bitbucket.org/${ownerRepoPath}/pull-requests/new?source=${encodedBranch}` };
  }
  if (host === 'dev.azure.com') {
    return { host, url: `https://dev.azure.com/${ownerRepoPath}/pullrequestcreate?sourceRef=${encodedBranch}` };
  }
  return null;
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run server/__tests__/prUrl.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/prUrl.ts server/__tests__/prUrl.test.ts
git commit -m "feat(server): monta URL de PR/MR por host (GitHub/GitLab/Bitbucket/Azure DevOps)"
```

---

### Task 4: `server/domains.ts` — registro de domínios + migração legada

**Depends on:** Task 1 (`domainContext.ts`), Task 2 (`git.ts`).

**Files:**
- Create: `server/domains.ts`
- Test: `server/__tests__/domains.test.ts`

**Interfaces:**
- Consumes:
  - de `./domainContext.ts`: `domainsRootDir()`, `domainsRegistryPath()`, `domainDirFor(slug)`, `setActiveDomainSlug(slug)`, `baseDataDir()`.
  - de `./git.ts`: `isGitRepo(dir)`, `remoteUrl(dir)`, `cloneRepo(url, destDir)`, `initRepo(dir, remoteUrl?)`.
  - de `./files.ts`: `ensureRegistry()` (já existente, inalterado).
- Produces:
  ```ts
  export interface DomainMeta {
    id: string; slug: string; name: string; dir: string;
    hasGit: boolean; remoteUrl: string | null;
    createdAt: string; updatedAt: string;
  }
  export function listDomains(): Promise<DomainMeta[]>;
  export function getDomain(id: string): Promise<DomainMeta>;
  export function createLocalDomain(name: string): Promise<DomainMeta>;
  export function cloneDomain(url: string, name?: string): Promise<DomainMeta>;
  export function attachGitToDomain(id: string, remoteUrl?: string): Promise<DomainMeta>;
  export function activateDomain(id: string): Promise<DomainMeta>;
  export function migrateLegacyDomains(): Promise<void>;
  ```

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// server/__tests__/domains.test.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-domains-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  delete process.env.LOCALDRAWDB_DOMAIN;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('createLocalDomain / listDomains', () => {
  it('cria domínio local (sem git) com slug único', async () => {
    const { createLocalDomain, listDomains } = await import('../domains.ts');
    const d1 = await createLocalDomain('Vendas');
    expect(d1.slug).toBe('vendas');
    expect(d1.hasGit).toBe(false);
    expect(d1.remoteUrl).toBeNull();

    const dirExists = await fs.stat(d1.dir).then((s) => s.isDirectory()).catch(() => false);
    expect(dirExists).toBe(true);

    const all = await listDomains();
    expect(all.map((d) => d.id)).toContain(d1.id);
  });

  it('gera slug sem conflito com sufixo numérico', async () => {
    const { createLocalDomain } = await import('../domains.ts');
    const a = await createLocalDomain('Time A');
    const b = await createLocalDomain('Time A');
    expect(a.slug).toBe('time-a');
    expect(b.slug).toBe('time-a-2');
  });
});

describe('attachGitToDomain', () => {
  it('promove domínio local a git (init) sem remote', async () => {
    const { createLocalDomain, attachGitToDomain } = await import('../domains.ts');
    const d = await createLocalDomain('Local Puro');
    const updated = await attachGitToDomain(d.id);
    expect(updated.hasGit).toBe(true);
    expect(updated.remoteUrl).toBeNull();
  });
});

describe('activateDomain', () => {
  it('ativa o domínio e garante o registry de projetos dele', async () => {
    const { createLocalDomain, activateDomain, getDomain } = await import('../domains.ts');
    const d = await createLocalDomain('Alpha');
    await activateDomain(d.id);

    const { getActiveDomainSlug } = await import('../domainContext.ts');
    expect(getActiveDomainSlug()).toBe('alpha');

    const registryExists = await fs
      .stat(path.join(d.dir, 'projects.json'))
      .then(() => true)
      .catch(() => false);
    expect(registryExists).toBe(true);

    const meta = await getDomain(d.id);
    expect(meta.id).toBe(d.id);
  });
});

describe('getDomain', () => {
  it('lança erro para id inexistente', async () => {
    const { getDomain } = await import('../domains.ts');
    await expect(getDomain('nao-existe')).rejects.toThrow(/não encontrado/i);
  });
});

describe('migrateLegacyDomains', () => {
  it('move data/projects/ + data/projects.json legados para data/domains/local/', async () => {
    await fs.mkdir(path.join(tmpDir, 'projects', 'default'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'projects', 'default', 'project.dbml'), 'Table t { id int }', 'utf8');
    await fs.writeFile(
      path.join(tmpDir, 'projects.json'),
      JSON.stringify({ activeId: 'x', projects: [{ id: 'x', name: 'default', slug: 'default', createdAt: '', updatedAt: '' }] }),
      'utf8',
    );

    const { migrateLegacyDomains, listDomains } = await import('../domains.ts');
    await migrateLegacyDomains();

    const domains = await listDomains();
    expect(domains).toHaveLength(1);
    expect(domains[0].slug).toBe('local');

    const movedDbml = await fs.readFile(
      path.join(tmpDir, 'domains', 'local', 'projects', 'default', 'project.dbml'),
      'utf8',
    );
    expect(movedDbml).toBe('Table t { id int }');

    const oldProjectsExists = await fs.stat(path.join(tmpDir, 'projects')).then(() => true).catch(() => false);
    expect(oldProjectsExists).toBe(false);
  });

  it('instalação limpa (nada em disco): ainda cria o domínio local vazio', async () => {
    const { migrateLegacyDomains, listDomains } = await import('../domains.ts');
    await migrateLegacyDomains();

    const domains = await listDomains();
    expect(domains).toHaveLength(1);
    expect(domains[0].slug).toBe('local');
    expect(domains[0].hasGit).toBe(false);
  });

  it('é idempotente: segunda chamada não duplica domínios', async () => {
    const { migrateLegacyDomains, listDomains } = await import('../domains.ts');
    await migrateLegacyDomains();
    await migrateLegacyDomains();

    const domains = await listDomains();
    expect(domains).toHaveLength(1);
  });

  it('não sobrescreve domínios já registrados manualmente', async () => {
    const { migrateLegacyDomains, createLocalDomain, listDomains } = await import('../domains.ts');
    await createLocalDomain('Já Existia');
    await migrateLegacyDomains();

    const domains = await listDomains();
    expect(domains.map((d) => d.name)).toEqual(['Já Existia']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run server/__tests__/domains.test.ts`
Expected: FAIL — `Cannot find module '../domains.ts'`.

- [ ] **Step 3: Implementar `server/domains.ts`**

```ts
// server/domains.ts
// Registro de domínios (data/domains.json) e pastas data/domains/<slug>/.
// Cada domínio, internamente, usa o mesmo layout que files.ts já entende
// (projects.json + projects/) — só muda o que "diretório de dados" significa.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  baseDataDir,
  domainsRootDir,
  domainsRegistryPath,
  domainDirFor,
  setActiveDomainSlug,
} from './domainContext.ts';
import { isGitRepo, remoteUrl as gitRemoteUrl, cloneRepo, initRepo } from './git.ts';
import { ensureRegistry } from './files.ts';

export interface DomainRecord {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainMeta extends DomainRecord {
  dir: string;
  hasGit: boolean;
  remoteUrl: string | null;
}

interface DomainsRegistryFile {
  domains: DomainRecord[];
}

function toSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'dominio'
  );
}

function uniqueSlug(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readDomainsRegistry(): Promise<DomainsRegistryFile> {
  try {
    const raw = await fs.readFile(domainsRegistryPath(), 'utf8');
    const reg = JSON.parse(raw) as DomainsRegistryFile;
    if (Array.isArray(reg.domains)) return reg;
  } catch {
    // ausente ou inválido — tratado como vazio
  }
  return { domains: [] };
}

export async function writeDomainsRegistry(reg: DomainsRegistryFile): Promise<void> {
  await ensureDir(baseDataDir());
  await fs.writeFile(domainsRegistryPath(), JSON.stringify(reg, null, 2), 'utf8');
}

async function toDomainMeta(record: DomainRecord): Promise<DomainMeta> {
  const dir = domainDirFor(record.slug);
  const hasGit = await isGitRepo(dir);
  const remote = hasGit ? await gitRemoteUrl(dir) : null;
  return { ...record, dir, hasGit, remoteUrl: remote };
}

async function registerDomain(name: string, slug: string): Promise<DomainRecord> {
  const reg = await readDomainsRegistry();
  const now = new Date().toISOString();
  const record: DomainRecord = { id: newId(), slug, name, createdAt: now, updatedAt: now };
  reg.domains.push(record);
  await writeDomainsRegistry(reg);
  return record;
}

export async function listDomains(): Promise<DomainMeta[]> {
  const reg = await readDomainsRegistry();
  return Promise.all(reg.domains.map(toDomainMeta));
}

export async function getDomain(id: string): Promise<DomainMeta> {
  const reg = await readDomainsRegistry();
  const record = reg.domains.find((d) => d.id === id);
  if (!record) throw new Error(`Domínio não encontrado: ${id}`);
  return toDomainMeta(record);
}

export async function createLocalDomain(name: string): Promise<DomainMeta> {
  const reg = await readDomainsRegistry();
  const slug = uniqueSlug(toSlug(name), reg.domains.map((d) => d.slug));
  await ensureDir(domainDirFor(slug));
  const record = await registerDomain(name, slug);
  return toDomainMeta(record);
}

export async function cloneDomain(url: string, name?: string): Promise<DomainMeta> {
  const reg = await readDomainsRegistry();
  const fallbackName = url.replace(/\.git$/, '').split(/[/\\]/).filter(Boolean).pop() ?? 'dominio';
  const baseName = name?.trim() || fallbackName;
  const slug = uniqueSlug(toSlug(baseName), reg.domains.map((d) => d.slug));
  await ensureDir(domainsRootDir());
  await cloneRepo(url, domainDirFor(slug));
  const record = await registerDomain(baseName, slug);
  return toDomainMeta(record);
}

export async function attachGitToDomain(id: string, remoteUrl?: string): Promise<DomainMeta> {
  const reg = await readDomainsRegistry();
  const record = reg.domains.find((d) => d.id === id);
  if (!record) throw new Error(`Domínio não encontrado: ${id}`);
  const dir = domainDirFor(record.slug);
  await ensureDir(dir);
  await initRepo(dir, remoteUrl);
  record.updatedAt = new Date().toISOString();
  await writeDomainsRegistry(reg);
  return toDomainMeta(record);
}

/** Ativa o domínio (contexto em memória) e garante o registry de projetos dele. */
export async function activateDomain(id: string): Promise<DomainMeta> {
  const meta = await getDomain(id);
  setActiveDomainSlug(meta.slug);
  await ensureRegistry();
  return meta;
}

/**
 * Migra o layout legado (data/projects/ + data/projects.json direto em
 * data/) para data/domains/local/. Idempotente: se data/domains.json já
 * existe, não faz nada. Numa instalação limpa (nada em disco), ainda cria
 * o domínio "local" vazio para a tela de escolha nunca ficar sem opções.
 */
export async function migrateLegacyDomains(): Promise<void> {
  const alreadyMigrated = await fs.stat(domainsRegistryPath()).then(() => true).catch(() => false);
  if (alreadyMigrated) return;

  await ensureDir(domainsRootDir());
  const localDir = domainDirFor('local');
  await ensureDir(localDir);

  const legacyProjectsDir = path.join(baseDataDir(), 'projects');
  const legacyRegistryPath = path.join(baseDataDir(), 'projects.json');

  const legacyProjectsExist = await fs
    .stat(legacyProjectsDir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (legacyProjectsExist) {
    await fs.rename(legacyProjectsDir, path.join(localDir, 'projects'));
  }

  const legacyRegistryExists = await fs.stat(legacyRegistryPath).then(() => true).catch(() => false);
  if (legacyRegistryExists) {
    await fs.rename(legacyRegistryPath, path.join(localDir, 'projects.json'));
  }

  await registerDomain('Local', 'local');
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run server/__tests__/domains.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 5: Rodar a suíte completa e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (nenhuma regressão nos testes de `files.ts`/`projects.ts`, que não usam domínio nenhum).

- [ ] **Step 6: Commit**

```bash
git add server/domains.ts server/__tests__/domains.test.ts
git commit -m "feat(server): registro de domínios (data/domains.json) e migração legada"
```

---

### Task 5: Rewire `server/files.ts` para resolver por domínio ativo

**Depends on:** Task 1 (`domainContext.ts`).

**Files:**
- Modify: `server/files.ts:18-24` (função `getDataDir`)
- Test: `server/__tests__/filesActiveDomain.test.ts`

**Interfaces:**
- Consumes: de `./domainContext.ts`: `getActiveDomainSlug()`, `domainDirFor(slug)`.
- Produces: nenhuma API nova — `getDataDir()` (privada) muda de comportamento; toda a API pública de `files.ts` (`listProjects`, `createProject`, `loadProject`, etc.) permanece com a mesma assinatura.

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// server/__tests__/filesActiveDomain.test.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-filesctx-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  delete process.env.LOCALDRAWDB_DOMAIN;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('files.ts — resolução por domínio ativo', () => {
  it('sem domínio ativo e sem LOCALDRAWDB_DATA_DIR: lança erro claro', async () => {
    delete process.env.LOCALDRAWDB_DATA_DIR;
    const { listProjects } = await import('../files.ts');
    await expect(listProjects()).rejects.toThrow(/domínio ativo/i);
  });

  it('com domínio ativo (setActiveDomainSlug), opera dentro de <base>/domains/<slug>/', async () => {
    const { setActiveDomainSlug } = await import('../domainContext.ts');
    const filesMod = await import('../files.ts');
    setActiveDomainSlug('acme');

    const meta = await filesMod.createProject('Projeto Acme');
    const expectedDir = path.join(tmpDir, 'domains', 'acme', 'projects', meta.slug);
    const exists = await fs.stat(expectedDir).then((s) => s.isDirectory()).catch(() => false);
    expect(exists).toBe(true);
  });

  it('LOCALDRAWDB_DOMAIN funciona como pin de processo (sem chamada explícita)', async () => {
    process.env.LOCALDRAWDB_DOMAIN = 'beta';
    const filesMod = await import('../files.ts');
    await filesMod.createProject('Projeto Beta');
    const registryExists = await fs
      .stat(path.join(tmpDir, 'domains', 'beta', 'projects.json'))
      .then(() => true)
      .catch(() => false);
    expect(registryExists).toBe(true);
  });

  it('domínio ativo tem prioridade sobre LOCALDRAWDB_DATA_DIR quando ambos setados', async () => {
    const { setActiveDomainSlug } = await import('../domainContext.ts');
    const filesMod = await import('../files.ts');
    setActiveDomainSlug('gama');

    await filesMod.createProject('Projeto Gama');
    const registryExists = await fs
      .stat(path.join(tmpDir, 'domains', 'gama', 'projects.json'))
      .then(() => true)
      .catch(() => false);
    expect(registryExists).toBe(true);

    // Não deve ter criado projects.json direto em tmpDir (comportamento legado)
    const flatExists = await fs.stat(path.join(tmpDir, 'projects.json')).then(() => true).catch(() => false);
    expect(flatExists).toBe(false);
  });

  it('sem domínio ativo, LOCALDRAWDB_DATA_DIR continua funcionando (compat com testes existentes)', async () => {
    const { listProjects, migrateLegacy } = await import('../files.ts');
    await migrateLegacy();
    const projects = await listProjects();
    expect(projects[0].slug).toBe('default');
    const exists = await fs.stat(path.join(tmpDir, 'projects.json')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run server/__tests__/filesActiveDomain.test.ts`
Expected: FAIL — a maioria assume o comportamento novo, que ainda não existe (`getDataDir` atual ignora domínio).

- [ ] **Step 3: Implementar a mudança em `server/files.ts`**

Substituir a função `getDataDir` (atualmente em `server/files.ts:18-24`):

```ts
function getDataDir(): string {
  return process.env.LOCALDRAWDB_DATA_DIR ?? DATA_DIR;
}
```

por:

```ts
import { getActiveDomainSlug, domainDirFor } from './domainContext.ts';

/**
 * Diretório de dados efetivo: domínio ativo (memória ou LOCALDRAWDB_DOMAIN)
 * tem prioridade; senão, LOCALDRAWDB_DATA_DIR (compat com testes/legado);
 * senão, lança erro — nenhuma rota deve chamar isto sem domínio nem override.
 */
function getDataDir(): string {
  const slug = getActiveDomainSlug();
  if (slug) return domainDirFor(slug);
  if (process.env.LOCALDRAWDB_DATA_DIR) return process.env.LOCALDRAWDB_DATA_DIR;
  throw new Error('Nenhum domínio ativo — selecione um projeto na tela de escolha.');
}
```

(O `import` vai junto aos demais imports no topo do arquivo, ao lado do `import { ROOT, DATA_DIR } from './paths.ts';` já adicionado na Task 1.)

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run server/__tests__/filesActiveDomain.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 5: Rodar a suíte completa (regressão) e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — em particular `server/__tests__/projects.test.ts`, `server/__tests__/pinnedProject.test.ts` e `server/__tests__/projectsRoutes.test.ts`, que sempre setam `LOCALDRAWDB_DATA_DIR` e nunca ativam domínio, devem continuar idênticos.

- [ ] **Step 6: Commit**

```bash
git add server/files.ts server/__tests__/filesActiveDomain.test.ts
git commit -m "feat(server): files.ts resolve diretório de dados pelo domínio ativo"
```

---

### Task 6: Rotas de domínio + boot + `/api/meta` com `gitAvailable`

**Depends on:** Task 2 (`git.ts`), Task 3 (`prUrl.ts`), Task 4 (`domains.ts`), Task 5 (`files.ts` rewire).

**Files:**
- Create: `server/routes/domainRoutes.ts`
- Modify: `server/routes.ts` (remover `ensureRegistry()` do topo de `registerRoutes`, adicionar guard `requireActiveDomain` nas rotas de projeto legadas, registrar `domainRoutes`, adicionar `gitAvailable`/`activeDomain` em `/api/meta`)
- Modify: `server/index.ts` (trocar `ensureRegistry()` por `migrateLegacyDomains()`; só chamar `pinnedSlug()` quando há domínio ativo)
- Test: `server/__tests__/domainRoutes.test.ts`

**Interfaces:**
- Consumes: tudo de `./domains.ts`, `./git.ts`, `./prUrl.ts`, `./domainContext.ts`, `./files.ts` (já existentes).
- Produces (rotas HTTP):
  - `GET /api/domains` → `{ domains: DomainMeta[], activeDomainSlug: string | null }`
  - `POST /api/domains { name }` → 201 `DomainMeta`
  - `POST /api/domains/clone { url, name? }` → 201 `DomainMeta` | 422 em erro de clone
  - `POST /api/domains/:id/attach-git { remoteUrl? }` → `DomainMeta` | 404
  - `POST /api/domains/:id/activate` → `{ ok: true, domain: DomainMeta }` | 404
  - `GET /api/domains/:id/git-status` → `{ hasGit: false } | { hasGit: true, ...GitStatus }` | 404
  - `POST /api/domains/:id/git/switch-branch { branch, create? }` → `{ ok: true, branch }` | 400 | 404 | 409
  - `POST /api/domains/:id/git/pull` → `{ ok: true }` | 404 | 409
  - `POST /api/domains/:id/git/push { message }` → `{ ok: true, branch }` | 400 | 404 | 409
  - `GET /api/domains/:id/git/pr-url` → `{ url, host, remoteUrl, branch }` | 404
  - `POST /api/domains/:id/git/credential { host, username, token }` → `{ ok: true }` | 400 | 404 | 422
  - `GET /api/context` → `{ domain: DomainMeta | null }`
  - `POST /api/context/clear` → `{ ok: true }`

- [ ] **Step 1: Escrever os testes de rota (falhando)**

```ts
// server/__tests__/domainRoutes.test.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-domainroutes-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  delete process.env.LOCALDRAWDB_DOMAIN;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function buildApp() {
  const { default: Fastify } = await import('fastify');
  const { registerRoutes } = await import('../routes.ts');
  const app = Fastify();
  await registerRoutes(app);
  return app;
}

describe('GET /api/domains', () => {
  it('lista vazio antes de qualquer migração/criação', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/domains' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ domains: [], activeDomainSlug: null });
  });
});

describe('POST /api/domains + activate', () => {
  it('cria domínio, ativa, e rotas legadas de projeto passam a funcionar', async () => {
    const app = await buildApp();

    const create = await app.inject({ method: 'POST', url: '/api/domains', payload: { name: 'Vendas' } });
    expect(create.statusCode).toBe(201);
    const domain = create.json() as { id: string; slug: string };
    expect(domain.slug).toBe('vendas');

    const activate = await app.inject({ method: 'POST', url: `/api/domains/${domain.id}/activate` });
    expect(activate.statusCode).toBe(200);

    const projects = await app.inject({ method: 'GET', url: '/api/projects' });
    await app.close();
    expect(projects.statusCode).toBe(200);
    const body = projects.json() as { projects: unknown[] };
    expect(body.projects).toHaveLength(1); // default criado pelo ensureRegistry do domínio
  });
});

describe('rotas legadas de projeto sem domínio ativo', () => {
  it('GET /api/projects retorna 409 com mensagem clara', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toMatch(/domínio ativo/i);
  });
});

describe('GET /api/context', () => {
  it('domain null antes de ativar; preenchido depois', async () => {
    const app = await buildApp();
    const before = await app.inject({ method: 'GET', url: '/api/context' });
    expect(before.json()).toEqual({ domain: null });

    const create = await app.inject({ method: 'POST', url: '/api/domains', payload: { name: 'X' } });
    const domain = create.json() as { id: string };
    await app.inject({ method: 'POST', url: `/api/domains/${domain.id}/activate` });

    const after = await app.inject({ method: 'GET', url: '/api/context' });
    await app.close();
    expect((after.json() as { domain: { id: string } }).domain.id).toBe(domain.id);
  });
});

describe('POST /api/context/clear', () => {
  it('limpa o domínio ativo — rotas legadas voltam a dar 409', async () => {
    const app = await buildApp();
    const create = await app.inject({ method: 'POST', url: '/api/domains', payload: { name: 'X' } });
    const domain = create.json() as { id: string };
    await app.inject({ method: 'POST', url: `/api/domains/${domain.id}/activate` });

    await app.inject({ method: 'POST', url: '/api/context/clear' });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    await app.close();
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /api/meta', () => {
  it('inclui gitAvailable e activeDomain', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/meta' });
    await app.close();
    const body = res.json() as { gitAvailable: boolean; activeDomain: string | null };
    expect(typeof body.gitAvailable).toBe('boolean');
    expect(body.activeDomain).toBeNull();
  });
});

describe('git-status de domínio sem git', () => {
  it('retorna hasGit: false', async () => {
    const app = await buildApp();
    const create = await app.inject({ method: 'POST', url: '/api/domains', payload: { name: 'SemGit' } });
    const domain = create.json() as { id: string };

    const res = await app.inject({ method: 'GET', url: `/api/domains/${domain.id}/git-status` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hasGit: false });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run server/__tests__/domainRoutes.test.ts`
Expected: FAIL — rotas ainda não existem; `GET /api/projects` ainda retorna 200 (sem guard).

- [ ] **Step 3: Implementar `server/routes/domainRoutes.ts`**

```ts
// server/routes/domainRoutes.ts
import type { FastifyInstance } from 'fastify';
import {
  listDomains,
  createLocalDomain,
  cloneDomain,
  attachGitToDomain,
  getDomain,
  activateDomain,
} from '../domains.ts';
import { getStatus, switchBranch, pull, commitAndPush, remoteUrl, credentialApprove } from '../git.ts';
import { buildPrUrl } from '../prUrl.ts';
import { getActiveDomainSlug, setActiveDomainSlug } from '../domainContext.ts';

type CreateDomainBody = { name?: string };
type CloneDomainBody = { url?: string; name?: string };
type AttachGitBody = { remoteUrl?: string };
type SwitchBranchBody = { branch?: string; create?: boolean };
type PushBody = { message?: string };
type CredentialBody = { host?: string; username?: string; token?: string };

export function registerDomainRoutes(app: FastifyInstance): void {
  app.get('/api/domains', async () => {
    const domains = await listDomains();
    return { domains, activeDomainSlug: getActiveDomainSlug() };
  });

  app.post<{ Body: CreateDomainBody }>('/api/domains', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'Nome é obrigatório.' });
    const domain = await createLocalDomain(name);
    reply.code(201);
    return domain;
  });

  app.post<{ Body: CloneDomainBody }>('/api/domains/clone', async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url) return reply.code(400).send({ error: 'URL é obrigatória.' });
    try {
      const domain = await cloneDomain(url, req.body?.name?.trim());
      reply.code(201);
      return domain;
    } catch (e: any) {
      return reply.code(422).send({ error: e?.stderr ?? e?.message ?? 'Falha ao clonar repositório.' });
    }
  });

  app.post<{ Params: { id: string }; Body: AttachGitBody }>(
    '/api/domains/:id/attach-git',
    async (req, reply) => {
      try {
        return await attachGitToDomain(req.params.id, req.body?.remoteUrl?.trim() || undefined);
      } catch (e: any) {
        return reply.code(404).send({ error: e?.message ?? 'Domínio não encontrado.' });
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/domains/:id/activate', async (req, reply) => {
    try {
      const domain = await activateDomain(req.params.id);
      return { ok: true, domain };
    } catch (e: any) {
      return reply.code(404).send({ error: e?.message ?? 'Domínio não encontrado.' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/git-status', async (req, reply) => {
    const domain = await getDomain(req.params.id).catch(() => null);
    if (!domain) return reply.code(404).send({ error: 'Domínio não encontrado.' });
    if (!domain.hasGit) return { hasGit: false as const };
    const status = await getStatus(domain.dir);
    return { hasGit: true as const, ...status };
  });

  app.post<{ Params: { id: string }; Body: SwitchBranchBody }>(
    '/api/domains/:id/git/switch-branch',
    async (req, reply) => {
      const branch = req.body?.branch?.trim();
      if (!branch) return reply.code(400).send({ error: 'Branch é obrigatória.' });
      const domain = await getDomain(req.params.id).catch(() => null);
      if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
      try {
        await switchBranch(domain.dir, branch, req.body?.create ?? false);
        return { ok: true, branch };
      } catch (e: any) {
        return reply.code(409).send({ error: e?.stderr ?? e?.message });
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/domains/:id/git/pull', async (req, reply) => {
    const domain = await getDomain(req.params.id).catch(() => null);
    if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
    try {
      await pull(domain.dir);
      return { ok: true };
    } catch (e: any) {
      return reply.code(409).send({ error: e?.stderr ?? e?.message });
    }
  });

  app.post<{ Params: { id: string }; Body: PushBody }>('/api/domains/:id/git/push', async (req, reply) => {
    const message = req.body?.message?.trim();
    if (!message) return reply.code(400).send({ error: 'Mensagem de commit é obrigatória.' });
    const domain = await getDomain(req.params.id).catch(() => null);
    if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
    try {
      const result = await commitAndPush(domain.dir, message);
      return { ok: true, ...result };
    } catch (e: any) {
      return reply.code(409).send({ error: e?.stderr ?? e?.message });
    }
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/git/pr-url', async (req, reply) => {
    const domain = await getDomain(req.params.id).catch(() => null);
    if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
    const remote = await remoteUrl(domain.dir);
    const { branch } = await getStatus(domain.dir);
    if (!remote) return { url: null, host: null, remoteUrl: null, branch };
    const built = buildPrUrl(remote, branch);
    return { url: built?.url ?? null, host: built?.host ?? null, remoteUrl: remote, branch };
  });

  app.post<{ Params: { id: string }; Body: CredentialBody }>(
    '/api/domains/:id/git/credential',
    async (req, reply) => {
      const { host, username, token } = req.body ?? {};
      if (!host || !username || !token) {
        return reply.code(400).send({ error: 'host, username e token são obrigatórios.' });
      }
      const domain = await getDomain(req.params.id).catch(() => null);
      if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
      try {
        await credentialApprove(domain.dir, { protocol: 'https', host, username, password: token });
        return { ok: true };
      } catch (e: any) {
        return reply.code(422).send({ error: e?.stderr ?? e?.message });
      }
    },
  );

  app.get('/api/context', async () => {
    const slug = getActiveDomainSlug();
    if (!slug) return { domain: null };
    const domains = await listDomains();
    const domain = domains.find((d) => d.slug === slug) ?? null;
    return { domain };
  });

  app.post('/api/context/clear', async () => {
    setActiveDomainSlug(null);
    return { ok: true };
  });
}
```

- [ ] **Step 4: Modificar `server/routes.ts`**

No topo do arquivo, adicionar aos imports (junto aos existentes de `./files.ts`):

```ts
import { registerDomainRoutes } from './routes/domainRoutes.ts';
import { isGitAvailable } from './git.ts';
import { getActiveDomainSlug } from './domainContext.ts';
```

Adicionar, próximo às outras funções de guard (`requireUnpinned`, `requirePinMatch`):

```ts
/** Garante domínio ativo antes de qualquer rota de projeto legada. 409 se não houver. */
async function requireActiveDomain(reply: FastifyReply): Promise<boolean> {
  try {
    await ensureRegistry();
    return true;
  } catch (e: any) {
    reply.code(409).send({ error: e?.message ?? 'Nenhum domínio ativo.' });
    return false;
  }
}
```

Em `registerRoutes`, **remover** a linha `await ensureRegistry();` do topo (linha 157 do arquivo atual) e **registrar** as novas rotas logo em seguida:

```ts
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  registerDomainRoutes(app);

  app.get('/api/meta', async () => {
    const pin = await pinnedSlug().catch(() => null);
    let pinnedProjectId: string | null = null;
    let inputDir: string | null = null;
    if (pin) {
      const reg = await readRegistry().catch(() => ({ activeId: '', projects: [] }));
      pinnedProjectId = reg.projects.find((p) => p.slug === pin)?.id ?? null;
    }
    try {
      inputDir = await getActiveInputDir();
    } catch {
      inputDir = null;
    }
    return {
      root: ROOT,
      dataDir: DATA_DIR,
      inputDir,
      port: Number(process.env.PORT ?? 5174),
      pinnedProject: pin,
      pinnedProjectId,
      gitAvailable: await isGitAvailable(),
      activeDomain: getActiveDomainSlug(),
    };
  });

  // ... (resto do arquivo idêntico, exceto os `requireActiveDomain` abaixo)
```

Em **cada** um dos handlers de rota de projeto legada, adicionar a guarda como primeira linha do corpo (antes de qualquer outra lógica): `GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id`, `PUT /api/projects/:id`, `PATCH /api/projects/:id`, `DELETE /api/projects/:id`, `POST /api/projects/:id/duplicate`, `POST /api/projects/:id/activate`, `POST /api/projects/:id/import`, `GET /api/project`, `PUT /api/project`, `POST /api/import`, `POST /api/export/png`. Exemplo para `GET /api/projects`:

```ts
app.get('/api/projects', async (req, reply) => {
  if (!(await requireActiveDomain(reply))) return;
  const [projects, activeId] = await Promise.all([listProjects(), getActiveId()]);
  return { activeId, projects };
});
```

(Cada handler ganha o parâmetro `reply` se ainda não tiver, e a linha de guarda como primeira instrução — o restante do corpo de cada handler permanece **exatamente** como está hoje.)

- [ ] **Step 5: Modificar `server/index.ts`**

```ts
// Servidor Fastify: API /api + (em produção) serve o frontend buildado em dist/.
import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerRoutes } from './routes.ts';
import { ROOT, pinnedSlug } from './files.ts';
import { migrateLegacyDomains } from './domains.ts';
import { getActiveDomainSlug } from './domainContext.ts';

const APP_ROOT = ROOT;
const PORT = Number(process.env.PORT ?? 5174);
const isProd = process.env.NODE_ENV === 'production';

async function main() {
  // Migra o layout legado (data/projects/ direto em data/) para
  // data/domains/local/ — idempotente, não requer domínio ativo.
  await migrateLegacyDomains();

  // Falha cedo se LOCALDRAWDB_PROJECT apontar para um projeto inexistente —
  // só faz sentido checar quando há um domínio pinado (LOCALDRAWDB_DOMAIN),
  // caso contrário a tela de escolha ainda vai decidir o domínio.
  if (getActiveDomainSlug()) {
    await pinnedSlug();
  }

  const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });

  await registerRoutes(app);

  const dist = path.join(APP_ROOT, 'dist');
  if (isProd && existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: PORT, host: '127.0.0.1' });
  app.log.info({ root: APP_ROOT, port: PORT }, 'localdrawdb API');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Rodar e confirmar sucesso**

Run: `npx vitest run server/__tests__/domainRoutes.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 7: Rodar a suíte completa e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS — incluindo `projectsRoutes.test.ts` e `pinnedProject.test.ts`, que continuam setando `LOCALDRAWDB_DATA_DIR` (o guard `requireActiveDomain` chama `ensureRegistry()`, que resolve via esse env var exatamente como antes).

- [ ] **Step 8: Commit**

```bash
git add server/routes/domainRoutes.ts server/routes.ts server/index.ts server/__tests__/domainRoutes.test.ts
git commit -m "feat(server): rotas de domínio, guard de contexto ativo e gitAvailable em /api/meta"
```

---

### Task 7: CLI (`./ldb`) — compatibilidade com o layout de domínios

**Depends on:** Task 4 (`domains.ts`). Pode rodar em paralelo com a Task 6.

**Escopo desta task:** manter `./ldb`, `./ldb --list`, `./ldb new`, `npm run dev`, `npm run dev:shared` funcionando **exatamente como hoje**, operando dentro do domínio `local` (criado pela migração). CLI para gerenciar **outros** domínios (clonar, ativar um domínio diferente por linha de comando) fica fora de escopo desta implementação — é uma evolução futura, já que hoje o `./ldb` não tem noção de domínio nenhuma.

**Files:**
- Modify: `scripts/ensureRegistry.ts`
- Modify: `scripts/createProject.ts`
- Modify: `scripts/registry.mjs` (`loadRegistry`)
- Modify: `scripts/dev.mjs:109-153` (`startInstance`, `startPreviewInstance`)
- Test: `scripts/__tests__/registry.test.mjs` (novo — não existe hoje; se a suíte de scripts já usar outro executor além do Vitest, ajustar o comando do Step 2/4 de acordo com o `package.json` real encontrado na implementação)

**Interfaces:**
- Consumes: `migrateLegacyDomains()` e `DomainMeta` de `../server/domains.ts`; `setActiveDomainSlug` de `../server/domainContext.ts`.
- Produces: nenhuma API nova — o contrato externo do CLI (`./ldb --list`, `./ldb new <nome>`, `./ldb <slug>`) não muda.

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// scripts/__tests__/registry.test.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRegistry, createProjectCli } from '../registry.mjs';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-cli-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadRegistry — layout de domínios', () => {
  it('cria o domínio local e retorna o registry de dentro de domains/local/', async () => {
    const reg = loadRegistry(tmpDir);
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0].slug).toBe('default');

    const registryOnDisk = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'domains', 'local', 'projects.json'), 'utf8'),
    );
    expect(registryOnDisk.projects).toHaveLength(1);
  });
});

describe('createProjectCli — layout de domínios', () => {
  it('cria o projeto dentro de domains/local/projects/', async () => {
    createProjectCli('Novo Projeto CLI', tmpDir);
    const dirExists = await fs
      .stat(path.join(tmpDir, 'domains', 'local', 'projects', 'novo-projeto-cli'))
      .then((s) => s.isDirectory())
      .catch(() => false);
    expect(dirExists).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run scripts/__tests__/registry.test.mjs`
Expected: FAIL — o registry ainda é procurado/gravado direto em `tmpDir/projects.json`, não em `tmpDir/domains/local/projects.json`.

- [ ] **Step 3: Implementar as mudanças**

`scripts/ensureRegistry.ts`:

```ts
// Entrypoint mínimo (rodado via tsx pelo launcher) que garante a existência do
// registry de projetos dentro do domínio "local" — o único que o CLI (./ldb)
// enxerga nesta versão. Delega à lógica canônica idempotente de files.ts e
// domains.ts, que respeitam LOCALDRAWDB_DATA_DIR.
import { migrateLegacyDomains } from '../server/domains.ts';
import { setActiveDomainSlug } from '../server/domainContext.ts';
import { ensureRegistry } from '../server/files.ts';

await migrateLegacyDomains();
setActiveDomainSlug('local');
await ensureRegistry();
```

`scripts/createProject.ts`:

```ts
// Entry tsx do launcher: cria um projeto dentro do domínio "local", reusando
// a lógica canônica de files.ts (respeita LOCALDRAWDB_DATA_DIR). Imprime o
// slug resultante.
import { migrateLegacyDomains } from '../server/domains.ts';
import { setActiveDomainSlug } from '../server/domainContext.ts';
import { createProject } from '../server/files.ts';

const name = process.argv[2]?.trim();
if (!name) {
  console.error('Uso: createProject <nome>');
  process.exit(1);
}

await migrateLegacyDomains();
setActiveDomainSlug('local');
const meta = await createProject(name);
console.log(`Projeto criado: ${meta.name} (slug: ${meta.slug})`);
```

`scripts/registry.mjs` — trocar apenas a linha do `registryPath` dentro de `loadRegistry` (o resto da função fica igual):

```js
export function loadRegistry(dataDir, opts = {}) {
  const tsxCli = opts.tsxCli ?? TSX_CLI;
  const ensureScript = opts.ensureScript ?? ENSURE_REGISTRY;
  const registryPath = path.join(dataDir, 'domains', 'local', 'projects.json');

  // Sempre executa ensureRegistry para sincronizar pastas criadas manualmente.
  const res = spawnSync(process.execPath, [tsxCli, ensureScript], {
    cwd: ROOT,
    env: { ...process.env, LOCALDRAWDB_DATA_DIR: dataDir },
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(
      `Falha ao inicializar o registry de projetos em ${registryPath}` +
        (res.error ? `\n${res.error.message}` : ''),
    );
  }

  return JSON.parse(readFileSync(registryPath, 'utf8'));
}
```

(`createProjectCli` já passa `LOCALDRAWDB_DATA_DIR: dataDir` e delega tudo para `scripts/createProject.ts` — nenhuma mudança adicional necessária nela.)

`scripts/dev.mjs` — em `startInstance` (linha ~110-116), acrescentar `LOCALDRAWDB_DOMAIN: 'local'` ao objeto `env`:

```ts
async function startInstance({ slug, apiPort, webPort }) {
  const env = {
    ...process.env,
    PORT: String(apiPort),
    API_PORT: String(apiPort),
    VITE_PORT: String(webPort),
    LOCALDRAWDB_DOMAIN: 'local',
    ...(slug ? { LOCALDRAWDB_PROJECT: slug } : {}),
  };
  // ... resto da função inalterado
```

E em `startPreviewInstance` (linha ~142-148):

```js
function startPreviewInstance({ slug, port }) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    LOCALDRAWDB_DOMAIN: 'local',
    ...(slug ? { LOCALDRAWDB_PROJECT: slug } : {}),
  };
  // ... resto da função inalterado
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run scripts/__tests__/registry.test.mjs`
Expected: PASS em ambos os testes.

- [ ] **Step 5: Smoke test manual do CLI**

Run: `LOCALDRAWDB_DATA_DIR=/tmp/ldb-smoke ./ldb --list`
Expected: imprime `Nenhum projeto.` na primeira vez (ou lista o `default` se já migrado); não lança exceção. Rodar de novo confirma idempotência.

Run: `rm -rf /tmp/ldb-smoke`

- [ ] **Step 6: Rodar a suíte completa e o typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/ensureRegistry.ts scripts/createProject.ts scripts/registry.mjs scripts/dev.mjs scripts/__tests__/registry.test.mjs
git commit -m "feat(cli): ./ldb opera dentro do domínio local (data/domains/local/)"
```

---

## Self-Review

**Cobertura da Spec A (parte de servidor):** hierarquia domínio→projeto ✅ (Task 4), `canvas.json` versionado junto ✅ (nenhuma mudança necessária — já vive dentro da pasta do projeto, que agora vive dentro do domínio), backend git via shell-out ✅ (Task 2), pull bloqueado com mudança pendente ✅ (Task 2), branch trocar/criar ✅ (Task 2/6), publicar = commit+push ✅ (Task 2/6), abrir PR por host ✅ (Task 3/6), credenciais via `git credential approve` ✅ (Task 2/6 — a UI do assistente fica no plano de frontend), migração automática para domínio `local` ✅ (Task 4), domínio 100% local + anexar git + clonar ✅ (Task 4/6), compat retroativa de `LOCALDRAWDB_DATA_DIR` ✅ (Task 5, testado explicitamente).

**Não coberto neste plano (intencional, ver spec/notas de escopo):** UI (picker, painel de git, assistente de credenciais — plano de frontend separado), CLI para domínios além de `local`, resolução de merge conflict, criação de PR via API.

**Placeholders:** nenhum `TBD`/`TODO` — todo step tem código completo.

**Consistência de tipos:** `DomainMeta` definido uma vez em `domains.ts` (Task 4) e reusado sem alteração em `domainRoutes.ts` (Task 6); `GitStatus` definido em `git.ts` (Task 2) e reusado em `domainRoutes.ts`; `PrUrlResult` definido em `prUrl.ts` (Task 3) e consumido em `domainRoutes.ts`.
