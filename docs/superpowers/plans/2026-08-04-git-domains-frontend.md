# Domínios versionados (git) — Camada de frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a UI da [Spec A](../specs/2026-08-04-git-domains-versioning-design.md) por cima da camada de servidor já implementada em [`2026-08-04-git-domains-server.md`](2026-08-04-git-domains-server.md): tela de escolha (picker) de domínio/projeto, painel de git na toolbar (status/branch/pull/publicar/PR) e assistente de credenciais.

**Architecture:** Um novo componente `AppGate` (montado em `src/main.tsx` no lugar de `App` direto) resolve o contexto ativo (`GET /api/context`) **antes** de montar o `App` existente: enquanto não há domínio ativo, renderiza `DomainPicker`; assim que um domínio+projeto é ativado no servidor, monta `<App key={domain.id} domain={domain} onBackToDomains={...} />` — o `App.tsx` existente (undo/redo, autosave, canvas, etc.) **não é reescrito**, só ganha duas props novas e um botão a mais na toolbar. Isso evita qualquer edição arriscada dentro do efeito de boot existente do `App` (que já assume, corretamente, que um projeto está disponível assim que ele monta — isso passa a ser verdade porque o `AppGate` só o monta depois de ativar o domínio no servidor).

**Tech Stack:** React 18, TypeScript, Vitest. **Sem `@testing-library/react`** — esse projeto não tem componentes de UI testados via render (confirmado: nenhum arquivo em `src/**/__tests__` usa `render()`/testing-library; só lógica pura). Este plano segue a mesma convenção: lógica extraída para helpers puros e testada; os componentes React em si são verificados por **smoke test manual** (`npm run dev` + navegador), como o resto da UI do projeto.

## Global Constraints

- `npm test` verde do início ao fim (suíte existente + testes novos).
- `npm run typecheck` verde ao final de cada task.
- Nenhuma dependência nova no `package.json`.
- Nenhuma edição ao conteúdo interno (JSX) do `App.tsx` além do necessário para: (a) trocar a assinatura da função para receber `domain`/`onBackToDomains`, (b) adicionar o botão "← Domínios" e `<GitPanel>` no bloco de toolbar já lido (linhas 1543-1560), (c) adicionar um handler `handleBackToDomains` logo após `switchProject`. Nada mais no `App.tsx` muda.
- Textos de UI em português, mesmo tom do restante do app.
- Depende da [Spec A — server plan](2026-08-04-git-domains-server.md) estar implementado (rotas `/api/domains*`, `/api/context*`, `/api/meta` com `gitAvailable`).

## Dependency Graph (para execução em paralelo)

```
Camada 0:
  Task 1 — src/api.ts (client das rotas de domínio/git/contexto)

Camada 1 (paralelizável entre si; depende só da Task 1):
  Task 2 — src/domains/DomainPicker.tsx (+ domainPickerHelpers.ts)
  Task 3 — src/domains/CredentialsWizard.tsx (+ tokenUrl.ts)

Camada 2 (depende de Task 1 + Task 3):
  Task 4 — src/domains/GitPanel.tsx (+ gitPanelHelpers.ts) — embute o CredentialsWizard da Task 3

Camada 3 (sequencial, depende de Task 2 + Task 4):
  Task 5 — src/domains/AppGate.tsx, src/main.tsx, src/App.tsx (integração final)
```

Se despachando em multitarefa: Task 1 sozinha primeiro; depois Task 2 e Task 3 em paralelo; depois Task 4; depois Task 5 (fica mais seguro como owner único, já que toca o `App.tsx` existente).

---

### Task 1: `src/api.ts` — client das rotas de domínio/git/contexto

**Files:**
- Modify: `src/api.ts` (adicionar ao final do arquivo, depois de `exportLocalDrawDB`)
- Test: `src/__tests__/api.domains.test.ts`

**Interfaces:**
- Consumes: rotas HTTP da [Task 6 do plano de servidor](2026-08-04-git-domains-server.md#task-6-rotas-de-domínio--boot--apimeta-com-gitavailable).
- Produces:
  ```ts
  export type DomainMeta = {
    id: string; slug: string; name: string; dir: string;
    hasGit: boolean; remoteUrl: string | null; createdAt: string; updatedAt: string;
  };
  export type GitStatus = { branch: string; ahead: number; behind: number; dirty: boolean; files: string[] };
  export type GitStatusResponse = { hasGit: false } | ({ hasGit: true } & GitStatus);

  export function listDomains(): Promise<{ domains: DomainMeta[]; activeDomainSlug: string | null }>;
  export function createDomain(name: string): Promise<DomainMeta>;
  export function cloneDomain(url: string, name?: string): Promise<DomainMeta>;
  export function attachGitToDomain(id: string, remoteUrl?: string): Promise<DomainMeta>;
  export function activateDomain(id: string): Promise<{ ok: boolean; domain: DomainMeta }>;
  export function getGitStatus(id: string): Promise<GitStatusResponse>;
  export function switchGitBranch(id: string, branch: string, create?: boolean): Promise<{ ok: boolean; branch: string }>;
  export function gitPull(id: string): Promise<{ ok: boolean }>;
  export function gitPush(id: string, message: string): Promise<{ ok: boolean; branch: string }>;
  export function getPrUrl(id: string): Promise<{ url: string | null; host: string | null; remoteUrl: string | null; branch: string }>;
  export function submitGitCredential(id: string, host: string, username: string, token: string): Promise<{ ok: boolean }>;
  export function getContext(): Promise<{ domain: DomainMeta | null }>;
  export function clearContext(): Promise<{ ok: boolean }>;
  ```

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/__tests__/api.domains.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listDomains', () => {
  it('faz GET /api/domains e retorna o corpo', async () => {
    mockFetchOnce(200, { domains: [], activeDomainSlug: null });
    const api = await import('../api.ts');
    const result = await api.listDomains();
    expect(result).toEqual({ domains: [], activeDomainSlug: null });
    expect(fetch).toHaveBeenCalledWith('/api/domains');
  });
});

describe('createDomain', () => {
  it('faz POST /api/domains com o nome', async () => {
    mockFetchOnce(201, { id: '1', slug: 'x', name: 'X' });
    const api = await import('../api.ts');
    await api.createDomain('X');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains');
    expect(JSON.parse(opts.body)).toEqual({ name: 'X' });
  });
});

describe('gitPull', () => {
  it('propaga o erro do servidor na mensagem', async () => {
    mockFetchOnce(409, { error: 'Há mudanças não commitadas — salve ou commite antes de atualizar.' });
    const api = await import('../api.ts');
    await expect(api.gitPull('dom-1')).rejects.toThrow(/não commitadas/i);
  });
});

describe('getPrUrl', () => {
  it('faz GET na rota do domínio', async () => {
    mockFetchOnce(200, { url: 'https://github.com/a/b/compare/main?expand=1', host: 'github.com', remoteUrl: 'x', branch: 'main' });
    const api = await import('../api.ts');
    const result = await api.getPrUrl('dom-1');
    expect(fetch).toHaveBeenCalledWith('/api/domains/dom-1/git/pr-url');
    expect(result.host).toBe('github.com');
  });
});

describe('submitGitCredential', () => {
  it('faz POST com host/username/token', async () => {
    mockFetchOnce(200, { ok: true });
    const api = await import('../api.ts');
    await api.submitGitCredential('dom-1', 'github.com', 'me', 'tok');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains/dom-1/git/credential');
    expect(JSON.parse(opts.body)).toEqual({ host: 'github.com', username: 'me', token: 'tok' });
  });
});

describe('getContext / clearContext', () => {
  it('getContext faz GET /api/context', async () => {
    mockFetchOnce(200, { domain: null });
    const api = await import('../api.ts');
    expect(await api.getContext()).toEqual({ domain: null });
    expect(fetch).toHaveBeenCalledWith('/api/context');
  });

  it('clearContext faz POST /api/context/clear', async () => {
    mockFetchOnce(200, { ok: true });
    const api = await import('../api.ts');
    await api.clearContext();
    expect(fetch).toHaveBeenCalledWith('/api/context/clear', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/__tests__/api.domains.test.ts`
Expected: FAIL — as funções ainda não existem em `src/api.ts`.

- [ ] **Step 3: Implementar (adicionar ao final de `src/api.ts`)**

```ts
// --- API domínios/git (Spec A) ---

export type DomainMeta = {
  id: string;
  slug: string;
  name: string;
  dir: string;
  hasGit: boolean;
  remoteUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GitStatus = { branch: string; ahead: number; behind: number; dirty: boolean; files: string[] };
export type GitStatusResponse = { hasGit: false } | ({ hasGit: true } & GitStatus);

export const listDomains = (): Promise<{ domains: DomainMeta[]; activeDomainSlug: string | null }> =>
  get('/api/domains');

export const createDomain = (name: string): Promise<DomainMeta> => post('/api/domains', { name });

export const cloneDomain = (url: string, name?: string): Promise<DomainMeta> =>
  post('/api/domains/clone', { url, name });

export const attachGitToDomain = (id: string, remoteUrl?: string): Promise<DomainMeta> =>
  post(`/api/domains/${id}/attach-git`, { remoteUrl });

export const activateDomain = (id: string): Promise<{ ok: boolean; domain: DomainMeta }> =>
  post(`/api/domains/${id}/activate`, {});

export const getGitStatus = (id: string): Promise<GitStatusResponse> => get(`/api/domains/${id}/git-status`);

export const switchGitBranch = (
  id: string,
  branch: string,
  create = false,
): Promise<{ ok: boolean; branch: string }> => post(`/api/domains/${id}/git/switch-branch`, { branch, create });

export const gitPull = (id: string): Promise<{ ok: boolean }> => post(`/api/domains/${id}/git/pull`, {});

export const gitPush = (id: string, message: string): Promise<{ ok: boolean; branch: string }> =>
  post(`/api/domains/${id}/git/push`, { message });

export const getPrUrl = (
  id: string,
): Promise<{ url: string | null; host: string | null; remoteUrl: string | null; branch: string }> =>
  get(`/api/domains/${id}/git/pr-url`);

export const submitGitCredential = (
  id: string,
  host: string,
  username: string,
  token: string,
): Promise<{ ok: boolean }> => post(`/api/domains/${id}/git/credential`, { host, username, token });

export const getContext = (): Promise<{ domain: DomainMeta | null }> => get('/api/context');

export const clearContext = (): Promise<{ ok: boolean }> => post('/api/context/clear', {});
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run src/__tests__/api.domains.test.ts`
Expected: PASS em todos os testes.

- [ ] **Step 5: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api.ts src/__tests__/api.domains.test.ts
git commit -m "feat(api): client de domínios/git/contexto"
```

---

### Task 2: `src/domains/DomainPicker.tsx` — tela de escolha

**Depends on:** Task 1.

**Files:**
- Create: `src/domains/domainPickerHelpers.ts`
- Create: `src/domains/DomainPicker.tsx`
- Modify: `src/styles.css` (adicionar ao final, classes novas — não tocar em nenhuma regra existente)
- Test: `src/domains/__tests__/domainPickerHelpers.test.ts`

**Interfaces:**
- Consumes: `listDomains`, `createDomain`, `cloneDomain`, `attachGitToDomain`, `activateDomain`, `listProjects`, `createProject`, `activateProject`, `clearContext`, `DomainMeta`, `ProjectMeta` de `../api.ts` (Task 1 + já existentes).
- Produces:
  - `domainPickerHelpers.ts`: `export function sortDomainsByName(domains: DomainMeta[]): DomainMeta[]`, `export function domainBadge(domain: DomainMeta): string`.
  - `DomainPicker.tsx`: `export function DomainPicker(props: { onOpened: (domain: DomainMeta) => void }): JSX.Element`.

- [ ] **Step 1: Escrever o teste do helper (falhando)**

```ts
// src/domains/__tests__/domainPickerHelpers.test.ts
import { describe, expect, it } from 'vitest';
import { sortDomainsByName, domainBadge } from '../domainPickerHelpers.ts';
import type { DomainMeta } from '../../api.ts';

function makeDomain(overrides: Partial<DomainMeta>): DomainMeta {
  return {
    id: '1', slug: 'x', name: 'X', dir: '/tmp/x',
    hasGit: false, remoteUrl: null, createdAt: '', updatedAt: '',
    ...overrides,
  };
}

describe('sortDomainsByName', () => {
  it('ordena alfabeticamente por nome', () => {
    const domains = [makeDomain({ name: 'Zeta' }), makeDomain({ name: 'Alpha' })];
    expect(sortDomainsByName(domains).map((d) => d.name)).toEqual(['Alpha', 'Zeta']);
  });
});

describe('domainBadge', () => {
  it('🔒 Local para domínio sem git', () => {
    expect(domainBadge(makeDomain({ hasGit: false }))).toBe('🔒 Local');
  });

  it('🌿 Git para domínio com git', () => {
    expect(domainBadge(makeDomain({ hasGit: true }))).toBe('🌿 Git');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/domains/__tests__/domainPickerHelpers.test.ts`
Expected: FAIL — `Cannot find module '../domainPickerHelpers.ts'`.

- [ ] **Step 3: Implementar `domainPickerHelpers.ts`**

```ts
// src/domains/domainPickerHelpers.ts
import type { DomainMeta } from '../api';

export function sortDomainsByName(domains: DomainMeta[]): DomainMeta[] {
  return [...domains].sort((a, b) => a.name.localeCompare(b.name));
}

export function domainBadge(domain: DomainMeta): string {
  return domain.hasGit ? '🌿 Git' : '🔒 Local';
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run src/domains/__tests__/domainPickerHelpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar `DomainPicker.tsx`**

```tsx
// src/domains/DomainPicker.tsx
import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { DomainMeta, ProjectMeta } from '../api';
import { sortDomainsByName, domainBadge } from './domainPickerHelpers';

type View = 'domains' | 'projects';
type NewDomainMode = 'local' | 'clone' | null;

export function DomainPicker({ onOpened }: { onOpened: (domain: DomainMeta) => void }) {
  const [view, setView] = useState<View>('domains');
  const [domains, setDomains] = useState<DomainMeta[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<DomainMeta | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newDomainMode, setNewDomainMode] = useState<NewDomainMode>(null);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainUrl, setNewDomainUrl] = useState('');
  const [newProjectName, setNewProjectName] = useState('');

  const refreshDomains = useCallback(async () => {
    try {
      const { domains: list } = await api.listDomains();
      setDomains(list);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refreshDomains();
  }, [refreshDomains]);

  const openDomain = useCallback(async (domain: DomainMeta) => {
    setError(null);
    try {
      await api.activateDomain(domain.id);
      const { projects: list } = await api.listProjects();
      setSelectedDomain(domain);
      setProjects(list);
      setView('projects');
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, []);

  const backToDomains = useCallback(async () => {
    await api.clearContext().catch(() => {});
    setSelectedDomain(null);
    setProjects([]);
    setView('domains');
    refreshDomains();
  }, [refreshDomains]);

  const openProject = useCallback(
    async (projectId: string) => {
      if (!selectedDomain) return;
      setError(null);
      try {
        await api.activateProject(projectId);
        onOpened(selectedDomain);
      } catch (e: unknown) {
        setError((e as Error).message);
      }
    },
    [selectedDomain, onOpened],
  );

  const handleCreateDomain = useCallback(async () => {
    setError(null);
    try {
      if (newDomainMode === 'clone') {
        if (!newDomainUrl.trim()) return;
        await api.cloneDomain(newDomainUrl.trim(), newDomainName.trim() || undefined);
      } else {
        if (!newDomainName.trim()) return;
        await api.createDomain(newDomainName.trim());
      }
      setNewDomainMode(null);
      setNewDomainName('');
      setNewDomainUrl('');
      await refreshDomains();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [newDomainMode, newDomainName, newDomainUrl, refreshDomains]);

  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    setError(null);
    try {
      await api.createProject(newProjectName.trim());
      setNewProjectName('');
      const { projects: list } = await api.listProjects();
      setProjects(list);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [newProjectName]);

  return (
    <div className="domain-picker">
      <header className="domain-picker__header">
        <strong className="brand">LocalDrawDB</strong>
        {view === 'projects' && (
          <button onClick={backToDomains} className="domain-picker__back">
            ← Domínios
          </button>
        )}
      </header>

      {error && <div className="domain-picker__error">{error}</div>}

      {view === 'domains' && (
        <section className="domain-picker__list">
          <h2>Escolha um domínio</h2>
          {sortDomainsByName(domains).map((d) => (
            <button key={d.id} className="domain-picker__item" onClick={() => openDomain(d)}>
              <span className="domain-picker__badge">{domainBadge(d)}</span>
              <span className="domain-picker__name">{d.name}</span>
            </button>
          ))}

          {newDomainMode === null ? (
            <div className="domain-picker__new-actions">
              <button onClick={() => setNewDomainMode('local')}>+ Novo domínio local</button>
              <button onClick={() => setNewDomainMode('clone')}>+ Clonar repositório</button>
            </div>
          ) : (
            <div className="domain-picker__new-form">
              <input
                placeholder="Nome do domínio"
                value={newDomainName}
                onChange={(e) => setNewDomainName(e.target.value)}
              />
              {newDomainMode === 'clone' && (
                <input
                  placeholder="URL do repositório (https ou ssh)"
                  value={newDomainUrl}
                  onChange={(e) => setNewDomainUrl(e.target.value)}
                />
              )}
              <button onClick={handleCreateDomain}>Criar</button>
              <button onClick={() => setNewDomainMode(null)}>Cancelar</button>
            </div>
          )}
        </section>
      )}

      {view === 'projects' && selectedDomain && (
        <section className="domain-picker__list">
          <h2>
            {domainBadge(selectedDomain)} {selectedDomain.name}
          </h2>
          {projects.map((p) => (
            <button key={p.id} className="domain-picker__item" onClick={() => openProject(p.id)}>
              <span className="domain-picker__name">{p.name}</span>
            </button>
          ))}
          <div className="domain-picker__new-form">
            <input
              placeholder="Nome do novo projeto"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <button onClick={handleCreateProject}>+ Novo projeto</button>
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Adicionar estilos mínimos ao final de `src/styles.css`**

```css
/* Domain picker (Spec A) */
.domain-picker { display: flex; flex-direction: column; height: 100vh; padding: 24px; gap: 16px; }
.domain-picker__header { display: flex; align-items: center; gap: 12px; }
.domain-picker__back { margin-left: auto; }
.domain-picker__error { color: var(--danger, #c0392b); }
.domain-picker__list { display: flex; flex-direction: column; gap: 8px; max-width: 480px; }
.domain-picker__item { display: flex; gap: 8px; align-items: center; padding: 10px 12px; text-align: left; border: 1px solid var(--border, #ccc); border-radius: 6px; background: transparent; cursor: pointer; }
.domain-picker__item:hover { background: var(--hover-bg, #f3f3f3); }
.domain-picker__new-actions, .domain-picker__new-form { display: flex; gap: 8px; margin-top: 8px; }
.domain-picker__new-form input { flex: 1; }
```

- [ ] **Step 7: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Smoke test manual**

Run: `npm run dev:shared` (ou `./ldb --shared`), abrir a URL impressa no terminal no navegador.
Expected (até a Task 5 integrar o `AppGate`, `DomainPicker` ainda não é o ponto de entrada — este smoke test só confirma que o app sobe normalmente sem regressão; a verificação visual do `DomainPicker` acontece no smoke test da Task 5).

- [ ] **Step 9: Commit**

```bash
git add src/domains/domainPickerHelpers.ts src/domains/DomainPicker.tsx src/domains/__tests__/domainPickerHelpers.test.ts src/styles.css
git commit -m "feat(ui): tela de escolha de domínio/projeto (DomainPicker)"
```

---

### Task 3: `src/domains/CredentialsWizard.tsx` — assistente de token

**Depends on:** Task 1.

**Files:**
- Create: `src/domains/tokenUrl.ts`
- Create: `src/domains/CredentialsWizard.tsx`
- Modify: `src/styles.css` (adicionar ao final)
- Test: `src/domains/__tests__/tokenUrl.test.ts`

**Interfaces:**
- Consumes: `submitGitCredential` de `../api.ts` (Task 1).
- Produces:
  - `tokenUrl.ts`: `export function buildTokenCreationUrl(host: string): string | null`.
  - `CredentialsWizard.tsx`: `export function CredentialsWizard(props: { domainId: string; host: string; onDone: () => void; onCancel: () => void }): JSX.Element`.

- [ ] **Step 1: Escrever o teste do helper (falhando)**

```ts
// src/domains/__tests__/tokenUrl.test.ts
import { describe, expect, it } from 'vitest';
import { buildTokenCreationUrl } from '../tokenUrl.ts';

describe('buildTokenCreationUrl', () => {
  it('GitHub', () => {
    expect(buildTokenCreationUrl('github.com')).toContain('github.com/settings/tokens/new');
  });

  it('GitLab', () => {
    expect(buildTokenCreationUrl('gitlab.com')).toContain('gitlab.com');
  });

  it('Bitbucket', () => {
    expect(buildTokenCreationUrl('bitbucket.org')).toContain('bitbucket.org');
  });

  it('Azure DevOps', () => {
    expect(buildTokenCreationUrl('dev.azure.com')).toContain('dev.azure.com');
  });

  it('host desconhecido retorna null', () => {
    expect(buildTokenCreationUrl('git.empresa-interna.com')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/domains/__tests__/tokenUrl.test.ts`
Expected: FAIL — `Cannot find module '../tokenUrl.ts'`.

- [ ] **Step 3: Implementar `tokenUrl.ts`**

```ts
// src/domains/tokenUrl.ts
// Deep-link para a tela de criação de token por host. Host desconhecido
// retorna null — a UI mostra instrução textual genérica nesse caso.
export function buildTokenCreationUrl(host: string): string | null {
  if (host === 'github.com') {
    return 'https://github.com/settings/tokens/new?description=LocalDrawDB&scopes=repo';
  }
  if (host === 'gitlab.com') {
    return 'https://gitlab.com/-/user_settings/personal_access_tokens?name=LocalDrawDB&scopes=write_repository';
  }
  if (host === 'bitbucket.org') {
    return 'https://bitbucket.org/account/settings/app-passwords/new';
  }
  if (host === 'dev.azure.com') {
    return 'https://dev.azure.com/_usersSettings/tokens';
  }
  return null;
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run src/domains/__tests__/tokenUrl.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar `CredentialsWizard.tsx`**

```tsx
// src/domains/CredentialsWizard.tsx
import { useState } from 'react';
import * as api from '../api';
import { buildTokenCreationUrl } from './tokenUrl';

export function CredentialsWizard({
  domainId,
  host,
  onDone,
  onCancel,
}: {
  domainId: string;
  host: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const tokenUrl = buildTokenCreationUrl(host);

  const handleSubmit = async () => {
    if (!username.trim() || !token.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submitGitCredential(domainId, host, username.trim(), token.trim());
      onDone();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="credentials-wizard__overlay">
      <div className="credentials-wizard">
        <h3>Configurar acesso a {host}</h3>
        <p>
          Para publicar/atualizar por HTTPS, {host} pede um <strong>token de acesso pessoal</strong> no
          lugar de senha. Gere um token e cole abaixo.
        </p>
        {tokenUrl ? (
          <a href={tokenUrl} target="_blank" rel="noreferrer" className="credentials-wizard__link">
            Abrir página de criar token em {host}
          </a>
        ) : (
          <p>Gere um token de acesso pessoal com permissão de repositório no seu provedor ({host}).</p>
        )}
        <input
          placeholder="Usuário"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          placeholder="Token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {error && <div className="credentials-wizard__error">{error}</div>}
        <div className="credentials-wizard__actions">
          <button onClick={handleSubmit} disabled={submitting}>
            Salvar
          </button>
          <button onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Adicionar estilos mínimos ao final de `src/styles.css`**

```css
/* Credentials wizard (Spec A) */
.credentials-wizard__overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.credentials-wizard { background: var(--panel-bg, #fff); padding: 20px; border-radius: 8px; display: flex; flex-direction: column; gap: 10px; max-width: 380px; }
.credentials-wizard__link { color: var(--accent, #1a6f4c); }
.credentials-wizard__error { color: var(--danger, #c0392b); }
.credentials-wizard__actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 7: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domains/tokenUrl.ts src/domains/CredentialsWizard.tsx src/domains/__tests__/tokenUrl.test.ts src/styles.css
git commit -m "feat(ui): assistente de credenciais (token) por host"
```

---

### Task 4: `src/domains/GitPanel.tsx` — painel de git na toolbar

**Depends on:** Task 1, Task 3 (embute `CredentialsWizard`).

**Files:**
- Create: `src/domains/gitPanelHelpers.ts`
- Create: `src/domains/GitPanel.tsx`
- Modify: `src/styles.css` (adicionar ao final)
- Test: `src/domains/__tests__/gitPanelHelpers.test.ts`

**Interfaces:**
- Consumes: `getGitStatus`, `switchGitBranch`, `gitPull`, `gitPush`, `getPrUrl`, `DomainMeta`, `GitStatusResponse` de `../api.ts` (Task 1); `CredentialsWizard` de `./CredentialsWizard.tsx` (Task 3).
- Produces:
  - `gitPanelHelpers.ts`: `export function formatGitSummary(status: GitStatusResponse | null): string`, `export function hostFromRemote(remoteUrl: string | null): string | null`, `export function isAuthError(message: string): boolean`.
  - `GitPanel.tsx`: `export function GitPanel(props: { domain: DomainMeta }): JSX.Element`.

- [ ] **Step 1: Escrever os testes do helper (falhando)**

```ts
// src/domains/__tests__/gitPanelHelpers.test.ts
import { describe, expect, it } from 'vitest';
import { formatGitSummary, hostFromRemote, isAuthError } from '../gitPanelHelpers.ts';

describe('formatGitSummary', () => {
  it('sem git: string vazia', () => {
    expect(formatGitSummary({ hasGit: false })).toBe('');
  });

  it('em dia (sem dirty/ahead/behind)', () => {
    expect(formatGitSummary({ hasGit: true, branch: 'main', ahead: 0, behind: 0, dirty: false, files: [] })).toBe(
      '✓ em dia',
    );
  });

  it('dirty com N arquivos', () => {
    expect(
      formatGitSummary({ hasGit: true, branch: 'main', ahead: 0, behind: 0, dirty: true, files: ['a.dbml', 'b.json'] }),
    ).toBe('● 2 não commitados');
  });

  it('1 arquivo usa singular', () => {
    expect(
      formatGitSummary({ hasGit: true, branch: 'main', ahead: 0, behind: 0, dirty: true, files: ['a.dbml'] }),
    ).toBe('● 1 não commitado');
  });

  it('ahead e behind combinados', () => {
    expect(
      formatGitSummary({ hasGit: true, branch: 'main', ahead: 2, behind: 1, dirty: false, files: [] }),
    ).toBe('↑2 ↓1');
  });
});

describe('hostFromRemote', () => {
  it('null para remote null', () => {
    expect(hostFromRemote(null)).toBeNull();
  });

  it('extrai host de URL SSH', () => {
    expect(hostFromRemote('git@github.com:acme/repo.git')).toBe('github.com');
  });

  it('extrai host de URL HTTPS', () => {
    expect(hostFromRemote('https://gitlab.com/acme/repo.git')).toBe('gitlab.com');
  });
});

describe('isAuthError', () => {
  it('detecta mensagens de autenticação', () => {
    expect(isAuthError('fatal: Authentication failed')).toBe(true);
    expect(isAuthError('remote: Permission denied')).toBe(true);
    expect(isAuthError('could not read Username')).toBe(true);
  });

  it('não marca erro genérico como auth', () => {
    expect(isAuthError('Há mudanças não commitadas')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/domains/__tests__/gitPanelHelpers.test.ts`
Expected: FAIL — `Cannot find module '../gitPanelHelpers.ts'`.

- [ ] **Step 3: Implementar `gitPanelHelpers.ts`**

```ts
// src/domains/gitPanelHelpers.ts
import type { GitStatusResponse } from '../api';

export function formatGitSummary(status: GitStatusResponse | null): string {
  if (!status || !status.hasGit) return '';
  const parts: string[] = [];
  if (status.dirty) {
    parts.push(`● ${status.files.length} não commitado${status.files.length === 1 ? '' : 's'}`);
  }
  if (status.ahead > 0) parts.push(`↑${status.ahead}`);
  if (status.behind > 0) parts.push(`↓${status.behind}`);
  return parts.length ? parts.join(' ') : '✓ em dia';
}

export function hostFromRemote(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const sshMatch = remoteUrl.match(/^git@([^:]+):/);
  if (sshMatch) return sshMatch[1];
  try {
    return new URL(remoteUrl).host;
  } catch {
    return null;
  }
}

export function isAuthError(message: string): boolean {
  return /auth|credential|autentica|permission denied|403|could not read/i.test(message);
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run src/domains/__tests__/gitPanelHelpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar `GitPanel.tsx`**

```tsx
// src/domains/GitPanel.tsx
import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { DomainMeta, GitStatusResponse } from '../api';
import { formatGitSummary, hostFromRemote, isAuthError } from './gitPanelHelpers';
import { CredentialsWizard } from './CredentialsWizard';

export function GitPanel({ domain }: { domain: DomainMeta }) {
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [wizardHost, setWizardHost] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.getGitStatus(domain.id);
      setStatus(s);
    } catch (e: unknown) {
      setMessage((e as Error).message);
    }
  }, [domain.id]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  if (!domain.hasGit) return null;

  const handleAuthFailure = (e: unknown) => {
    const msg = (e as Error).message ?? String(e);
    if (isAuthError(msg)) {
      setWizardHost(hostFromRemote(domain.remoteUrl) ?? 'seu provedor git');
    } else {
      setMessage(msg);
    }
  };

  const handlePull = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.gitPull(domain.id);
      setMessage('Atualizado.');
      await refreshStatus();
    } catch (e: unknown) {
      handleAuthFailure(e);
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    const msg = prompt('Mensagem do commit:');
    if (!msg?.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.gitPush(domain.id, msg.trim());
      setMessage('Publicado.');
      await refreshStatus();
    } catch (e: unknown) {
      handleAuthFailure(e);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenPr = async () => {
    try {
      const { url } = await api.getPrUrl(domain.id);
      if (url) window.open(url, '_blank', 'noreferrer');
      else setMessage('Sem link automático para este host — publique e abra o PR manualmente.');
    } catch (e: unknown) {
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="git-panel">
      <span className="git-panel__branch">{status && status.hasGit ? status.branch : '…'}</span>
      <span className="git-panel__summary">{formatGitSummary(status)}</span>
      <button onClick={handlePull} disabled={busy}>
        Atualizar
      </button>
      <button onClick={handlePublish} disabled={busy}>
        Publicar
      </button>
      <button onClick={handleOpenPr} disabled={busy}>
        Abrir PR
      </button>
      <button
        onClick={() => setWizardHost(hostFromRemote(domain.remoteUrl) ?? 'seu provedor git')}
        disabled={busy}
      >
        Credenciais
      </button>
      {message && <span className="git-panel__message">{message}</span>}
      {wizardHost && (
        <CredentialsWizard
          domainId={domain.id}
          host={wizardHost}
          onDone={() => {
            setWizardHost(null);
            refreshStatus();
          }}
          onCancel={() => setWizardHost(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Adicionar estilos mínimos ao final de `src/styles.css`**

```css
/* Git panel (Spec A) */
.git-panel { display: flex; align-items: center; gap: 8px; margin-left: 12px; font-size: 13px; }
.git-panel__branch { font-weight: 600; }
.git-panel__summary { color: var(--muted, #666); }
.git-panel__message { color: var(--muted, #666); font-style: italic; }
```

- [ ] **Step 7: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domains/gitPanelHelpers.ts src/domains/GitPanel.tsx src/domains/__tests__/gitPanelHelpers.test.ts src/styles.css
git commit -m "feat(ui): painel de git (status, branch, pull, publicar, PR)"
```

---

### Task 5: Integração final — `AppGate`, `main.tsx`, `App.tsx`

**Depends on:** Task 2 (`DomainPicker`), Task 4 (`GitPanel`).

**Files:**
- Create: `src/domains/AppGate.tsx`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx:173` (assinatura da função)
- Modify: `src/App.tsx` (novo handler `handleBackToDomains`, inserido logo após o fim de `switchProject`)
- Modify: `src/App.tsx:1543-1560` (toolbar: botão "← Domínios" + `<GitPanel>`)

**Interfaces:**
- Consumes: `DomainPicker` (Task 2), `GitPanel` (Task 4), `getContext`/`clearContext`/`DomainMeta` (Task 1).
- Produces: `App` passa a exigir as props `{ domain: DomainMeta; onBackToDomains: () => void }` — só `AppGate` o instancia agora; `main.tsx` não referencia `App` diretamente.

Esta task **não introduz testes automatizados novos** (seguindo a convenção do projeto — componentes React não são testados via render). A verificação é o smoke test manual do Step 5, que é **obrigatório** antes do commit, por instrução do projeto para mudanças de UI.

- [ ] **Step 1: Criar `src/domains/AppGate.tsx`**

```tsx
// src/domains/AppGate.tsx
// Resolve o contexto (domínio ativo) ANTES de montar o App existente. Enquanto
// não há domínio ativo, mostra a tela de escolha; assim que um domínio é
// ativado no servidor, monta o App do zero (key={domain.id}) — o App.tsx
// continua assumindo, como sempre assumiu, que há um projeto pronto assim
// que ele monta.
import { useCallback, useEffect, useState } from 'react';
import App from '../App';
import { DomainPicker } from './DomainPicker';
import * as api from '../api';
import type { DomainMeta } from '../api';

export function AppGate() {
  const [activeDomain, setActiveDomain] = useState<DomainMeta | null | undefined>(undefined);

  useEffect(() => {
    api
      .getContext()
      .then(({ domain }) => setActiveDomain(domain))
      .catch(() => setActiveDomain(null));
  }, []);

  const handleOpened = useCallback((domain: DomainMeta) => {
    setActiveDomain(domain);
  }, []);

  const handleBackToDomains = useCallback(() => {
    setActiveDomain(null);
  }, []);

  if (activeDomain === undefined) {
    return <div className="app-gate-loading">Carregando…</div>;
  }
  if (activeDomain === null) {
    return <DomainPicker onOpened={handleOpened} />;
  }
  return <App key={activeDomain.id} domain={activeDomain} onBackToDomains={handleBackToDomains} />;
}
```

- [ ] **Step 2: Modificar `src/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppGate } from './domains/AppGate';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppGate />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Modificar `src/App.tsx` — assinatura da função (linha 173)**

Adicionar ao topo do arquivo, junto aos demais imports de tipos de `./api`:

```ts
import type { DomainMeta } from './api';
```

Trocar (linha 173):

```ts
export default function App() {
```

por:

```ts
export default function App({ domain, onBackToDomains }: { domain: DomainMeta; onBackToDomains: () => void }) {
```

- [ ] **Step 4: Modificar `src/App.tsx` — handler `handleBackToDomains` e toolbar**

Logo **após** o fechamento de `handleDeleteProject` (o bloco que termina em `[currentProjectId, switchProject],\n  );` — o mesmo padrão já usado por `handleCreateProject`/`handleRenameProject`/`handleDuplicateProject`/`handleDeleteProject`), adicionar:

```tsx
  const handleBackToDomains = useCallback(async () => {
    if (currentProjectId) {
      try {
        await api.saveProjectById(currentProjectId, dbml, {
          positions,
          colors,
          collapsedGroups,
          pages: canvasPages,
          activePageIds,
        });
      } catch {
        // ignora erros de save ao sair — não bloqueia a saída
      }
    }
    onBackToDomains();
  }, [currentProjectId, dbml, positions, colors, collapsedGroups, canvasPages, activePageIds, onBackToDomains]);
```

No bloco de toolbar já existente (`src/App.tsx:1543-1550`), trocar:

```tsx
  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">LocalDrawDB</strong>
        {projects.length > 0 && (
          <ProjectSwitcher
```

por:

```tsx
  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">LocalDrawDB</strong>
        <Tooltip label="Voltar à tela de escolha de projetos">
          <button onClick={handleBackToDomains} aria-label="Voltar aos domínios" className="back-to-domains-btn">
            ← Domínios
          </button>
        </Tooltip>
        {projects.length > 0 && (
          <ProjectSwitcher
```

E, imediatamente após o bloco `<ProjectSwitcher ... />` (que já termina, conforme lido, em `pinnedLabel={...}\n          />\n        )}` — linhas 1557-1559), adicionar o painel de git:

```tsx
        {domain.hasGit && <GitPanel domain={domain} />}
```

Adicionar aos imports do topo do arquivo (junto aos demais imports de componentes locais):

```ts
import { GitPanel } from './domains/GitPanel';
```

- [ ] **Step 5: Smoke test manual (obrigatório antes do commit)**

Run: `npm run dev:shared`

No navegador, na URL impressa pelo terminal:
1. Confirmar que a **tela de escolha** aparece no lugar do canvas direto.
2. Criar um domínio local ("+ Novo domínio local"), confirmar que aparece na lista.
3. Abrir o domínio, confirmar que lista o projeto `default` (ou cria um "+ Novo projeto").
4. Abrir um projeto — confirmar que o **canvas carrega normalmente** (editor, undo/redo, salvar, importar, exportar — smoke test rápido de cada um).
5. Clicar **"← Domínios"** na toolbar — confirmar que volta para a tela de escolha sem erro no console.
6. Reabrir o mesmo projeto — confirmar que o trabalho salvo no passo 4 persistiu.
7. `git init` numa pasta de teste fora do repo, criar um domínio local e usar "Anexar repositório" (via API diretamente com `curl`, já que o botão de anexar fica de fora do escopo desta task de UI — ver nota abaixo) **OU** clonar um repositório git de teste real via "+ Clonar repositório" — confirmar que o `GitPanel` aparece na toolbar com branch e status corretos.
8. No domínio git, editar e salvar, clicar **Publicar** — confirmar que aparece "Publicado." ou uma mensagem de erro compreensível (sem remote configurado, por exemplo).

Se qualquer passo falhar, **não commitar** — voltar e corrigir antes de prosseguir.

> Nota: o botão "Anexar repositório" para domínios locais existentes não foi incluído no `DomainPicker` desta task (a Task 2 só cobre criar local e clonar) — é um follow-up de UI de baixo risco (a rota `/api/domains/:id/attach-git` já existe desde o plano de servidor); registrar como próximo passo, não bloqueia esta task.

- [ ] **Step 6: Suíte completa + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domains/AppGate.tsx src/main.tsx src/App.tsx
git commit -m "feat(ui): integra AppGate/DomainPicker/GitPanel ao App existente"
```

---

## Self-Review

**Cobertura da Spec A (parte de frontend):** tela de escolha (picker) reutilizável no boot e no botão "trocar projeto" ✅ (Task 2 + Task 5), painel de git na toolbar com branch/status/pull/publicar/PR ✅ (Task 4), assistente de credenciais automático em falha de auth + acessível sob demanda ✅ (Task 3 + Task 4 — o botão "Credenciais" cobre o acesso sob demanda), domínio local mostra "Anexar repositório" no lugar dos botões de git — **parcialmente coberto**: a rota já existe (plano de servidor), mas o botão de UI ficou fora desta task (anotado como follow-up no Step 5 da Task 5, para não inflar o escopo com uma segunda forma de criação de domínio que replica lógica já presente no fluxo de clone).

**Placeholders:** nenhum `TBD`/`TODO` fora da nota de follow-up explicitamente escopada no Step 5 da Task 5 (que é uma decisão de escopo documentada, não um buraco no plano).

**Consistência de tipos:** `DomainMeta`/`GitStatusResponse` definidos uma vez em `api.ts` (Task 1) e reusados sem alteração em `DomainPicker`, `GitPanel`, `CredentialsWizard`, `AppGate` e `App.tsx`.

**Risco mais alto do plano:** Task 5 (único ponto que toca `App.tsx`, arquivo grande e não lido por inteiro). Mitigado por: (a) todas as edições são aditivas ou ancoradas em trechos **verificados por leitura direta** do arquivo atual durante o brainstorming/planejamento (linhas 173, bloco após `handleDeleteProject`, bloco de toolbar 1543-1560); (b) nenhuma edição ao efeito de boot existente nem ao corpo de `switchProject`; (c) smoke test manual obrigatório antes do commit desta task.
