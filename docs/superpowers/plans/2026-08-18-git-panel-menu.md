# Menu git na toolbar — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os botões soltos do git por um dropdown na branch atual, com `commit`, `pull` e `push` separados, e criar branch levando mudanças não commitadas (como `git switch -c`).

**Architecture:** `server/git.ts` deixa de misturar commit+push e de pré-bloquear `switch -c` quando a árvore está suja. As rotas e `src/api.ts` espelham isso. `GitPanel.tsx` vira um trigger+dropdown no padrão do `ExportMenu`.

**Tech Stack:** TypeScript, Fastify, Vitest, React.

## Global Constraints

- Labels das operações: `commit`, `pull`, `push` (não “Atualizar”/“Publicar”).
- Zero `window.prompt` / `window.confirm` no fluxo git.
- Commit nunca dá push; push nunca dá commit.
- Criar branch com working tree suja é permitido; pull com suja continua bloqueado.
- Push com suja recusa; push sem upstream é permitido (`-u`); push com upstream e ahead 0 recusa.
- Sem dependências novas. Comentários em português (porquê, não quê).
- `npm test` + `npm run typecheck` passam ao fim de cada task.
- Fora: Data Modeler, layout `localdrawdb/`/`oracledatamodeler/`.

---

### Task 1: git.ts — commit, push, switch sem pré-check dirty na criação

**Files:**
- Modify: `server/git.ts`
- Modify: `server/__tests__/git.test.ts`

**Interfaces:**
- Produces:
  - `GitStatus` ganha `branches: string[]`
  - `commit(dir: string, message: string): Promise<{ branch: string }>`
  - `push(dir: string): Promise<{ branch: string }>`
  - `switchBranch(dir, branch, create?)` não pré-checa dirty
  - `commitAndPush` removido

- [ ] **Step 1: Atualizar testes de `switchBranch` e substituir `commitAndPush`**

Em `server/__tests__/git.test.ts`, o teste “bloqueia quando há mudanças não commitadas” de `switchBranch` some. No lugar:

```ts
describe('switchBranch', () => {
  it('usa `switch` sem pré-checar dirty quando create=false', async () => {
    mockExecFileOnce(''); // git switch outra
    const { switchBranch } = await import('../git.ts');
    await switchBranch('/tmp/repo', 'outra');
    expect(execFileMock.mock.calls[0][1]).toEqual(['switch', 'outra']);
  });

  it('usa `switch -c` quando create=true, mesmo com árvore suja (não chama status)', async () => {
    mockExecFileOnce('');
    const { switchBranch } = await import('../git.ts');
    await switchBranch('/tmp/repo', 'nova', true);
    expect(execFileMock.mock.calls[0][1]).toEqual(['switch', '-c', 'nova']);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});

describe('commit', () => {
  it('lança quando não há nada pendente após add', async () => {
    mockExecFileOnce('main'); // currentBranch
    mockExecFileOnce(''); // add -A
    mockExecFileOnce(''); // status --porcelain
    const { commit } = await import('../git.ts');
    await expect(commit('/tmp/repo', 'msg')).rejects.toThrow(/nada para commitar/i);
  });

  it('add + commit, sem push', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce(' M a.dbml');
    mockExecFileOnce('');
    const { commit } = await import('../git.ts');
    await expect(commit('/tmp/repo', 'wip')).resolves.toEqual({ branch: 'main' });
    const cmds = execFileMock.mock.calls.map((c) => c[1] as string[]);
    expect(cmds).toContainEqual(['add', '-A']);
    expect(cmds).toContainEqual(['commit', '-m', 'wip']);
    expect(cmds.some((a) => a[0] === 'push')).toBe(false);
  });
});

describe('push', () => {
  it('recusa working tree suja e não chama git push', async () => {
    // getStatus: branch, porcelain dirty, listBranches, rev-list fail
    mockExecFileOnce('main');
    mockExecFileOnce(' M a.dbml');
    mockExecFileOnce('main');
    mockExecFileFail('no upstream');
    const { push } = await import('../git.ts');
    await expect(push('/tmp/repo')).rejects.toThrow(/commite antes de enviar/i);
    expect(execFileMock.mock.calls.some((c) => (c[1] as string[])[0] === 'push')).toBe(false);
  });

  it('recusa quando já tem upstream e ahead=0', async () => {
    mockExecFileOnce('main'); // branch
    mockExecFileOnce(''); // porcelain limpo
    mockExecFileOnce('main'); // listBranches
    mockExecFileOnce('0\t0'); // rev-list ahead/behind
    mockExecFileOnce('origin/main'); // rev-parse --verify origin/main
    const { push } = await import('../git.ts');
    await expect(push('/tmp/repo')).rejects.toThrow(/nada para enviar/i);
  });

  it('push -u quando não há upstream (branch nova)', async () => {
    mockExecFileOnce('feat'); // branch
    mockExecFileOnce(''); // porcelain
    mockExecFileOnce('feat'); // listBranches
    mockExecFileFail('no origin/feat'); // rev-list
    mockExecFileFail('no origin/feat'); // rev-parse --verify
    mockExecFileOnce(''); // push
    const { push } = await import('../git.ts');
    await expect(push('/tmp/repo')).resolves.toEqual({ branch: 'feat' });
    expect(execFileMock.mock.calls.at(-1)![1]).toEqual(['push', '-u', 'origin', 'feat']);
  });
});
```

Ajustar os testes de `pull` para incluir a chamada extra de `listBranches` dentro de `getStatus` (depois do porcelain, antes do rev-list): um `mockExecFileOnce('main')` a mais no caminho feliz e no bloqueio dirty.

- [ ] **Step 2: Rodar testes e ver falhar**

Run: `npx vitest run server/__tests__/git.test.ts`
Expected: FAIL (`commit`/`push` não exportados; switch ainda pré-checa dirty).

- [ ] **Step 3: Implementar**

`GitStatus` ganha `branches: string[]`. `getStatus` chama `listBranches`.

```ts
export async function switchBranch(dir: string, branch: string, create = false): Promise<void> {
  await run(dir, create ? ['switch', '-c', branch] : ['switch', branch]);
}

export async function commit(dir: string, message: string): Promise<{ branch: string }> {
  const branch = await currentBranch(dir);
  await run(dir, ['add', '-A']);
  const pending = await run(dir, ['status', '--porcelain']);
  if (!pending) throw new Error('Nada para commitar.');
  await run(dir, ['commit', '-m', message]);
  return { branch };
}

async function hasUpstream(dir: string, branch: string): Promise<boolean> {
  try {
    await run(dir, ['rev-parse', '--verify', `origin/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function push(dir: string): Promise<{ branch: string }> {
  const status = await getStatus(dir);
  if (status.dirty) {
    throw new Error('Há mudanças não commitadas — commite antes de enviar.');
  }
  if ((await hasUpstream(dir, status.branch)) && status.ahead === 0) {
    throw new Error('Nada para enviar.');
  }
  await run(dir, ['push', '-u', 'origin', status.branch]);
  return { branch: status.branch };
}
```

Remover `commitAndPush`. `pull` permanece com o pré-check dirty via `getStatus`.

- [ ] **Step 4: Testes passam**

Run: `npx vitest run server/__tests__/git.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** `feat(git): separa commit e push; switch -c leva working tree suja`

---

### Task 2: Rotas e cliente API

**Files:**
- Modify: `server/routes/domainRoutes.ts`
- Modify: `server/__tests__/domainRoutes.test.ts`
- Modify: `src/api.ts`
- Modify: `src/__tests__/api.domains.test.ts`

**Interfaces:**
- Consumes: `commit`, `push`, `getStatus.branches` da Task 1
- Produces:
  - `POST /api/domains/:id/git/commit` `{ message }` → `{ ok, branch }`
  - `POST /api/domains/:id/git/push` sem body de mensagem
  - `GET git-status` inclui `branches` quando `hasGit: true`
  - `gitCommit(id, message)`, `gitPush(id)` (sem message)

- [ ] **Step 1: Testes de rota e api**

`git-status` com git: `expect(Array.isArray(body.branches)).toBe(true)`.

Push sem git: payload vazio (não `{ message }`). O teste “valida o body” deixa de esperar 400 em push sem message; commit sem message → 400.

Novo: commit sem git → 404; commit com git e nada pendente → 409.

`src/__tests__/api.domains.test.ts`: `gitPush` POST sem body de message; `gitCommit` POST `{ message }`.

- [ ] **Step 2: Falhar**

Run: `npx vitest run server/__tests__/domainRoutes.test.ts src/__tests__/api.domains.test.ts`

- [ ] **Step 3: Implementar rotas e api**

Importar `commit, push` no lugar de `commitAndPush`. Rota commit exige `message`. Rota push chama `push(domain.dir)`.

```ts
export type GitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  files: string[];
  branches: string[];
};
export const gitCommit = (id: string, message: string) =>
  post(`/api/domains/${id}/git/commit`, { message });
export const gitPush = (id: string) => post(`/api/domains/${id}/git/push`, {});
```

- [ ] **Step 4: Passar testes da task**

- [ ] **Step 5: Commit** `feat(api): rotas git/commit e git/push separados`

---

### Task 3: GitPanel dropdown + CSS + helpers

**Files:**
- Modify: `src/domains/GitPanel.tsx`
- Modify: `src/domains/gitPanelHelpers.ts`
- Modify: `src/domains/__tests__/gitPanelHelpers.test.ts`
- Modify: `src/styles.css` (bloco `.git-panel`)

**Interfaces:**
- Consumes: `gitCommit`, `gitPush()`, `GitStatus.branches`, `switchGitBranch`
- Produces: um trigger (branch + summary + chevron) e dropdown com a ordem da spec

- [ ] **Step 1: Helper `hasGitStatus` / testes do summary com `branches`**

Atualizar fixtures de `formatGitSummary` para incluir `branches: ['main']`.

Opcional: `export function isCurrentBranch(name: string, current: string): boolean` — igualdade exata; o painel usa para no-op.

- [ ] **Step 2: Reescrever `GitPanel.tsx`**

Padrão `ExportMenu`: `rootRef`, clique fora, Escape. Sem `window.prompt`/`confirm`.

Trigger: `{branch} {summary} Chevron`.

Dropdown:
1. Status (div, não botão)
2. Lista `status.branches` — atual com marca; clique em outra → `switchGitBranch(id, name, false)` + `onRepoChanged`
3. input + **Criar branch** → `switchGitBranch(id, name, true)` + `onRepoChanged`
4. textarea/input mensagem + **commit** → `gitCommit`
5. **pull** → `gitPull` + `onRepoChanged`
6. **push** → `gitPush()`
7. Abrir PR, Credenciais

Auth error em pull/push → wizard. Mensagens no dropdown. `busy` desabilita ações.

- [ ] **Step 3: CSS** `.git-panel` `position: relative`; dropdown estilo `.toolbar__export-dropdown` (fundo navy, z-index alto, min-width ~240px); itens e campos compactos.

- [ ] **Step 4:** `npx vitest run src/domains/__tests__/gitPanelHelpers.test.ts src/__tests__/api.domains.test.ts` + `npm run typecheck` + `npm test`

- [ ] **Step 5: Commit** `feat(ui): menu git na toolbar com commit/pull/push`

---

## Coverage da spec

| AC | Task |
|---|---|
| 1 um controle, sem Atualizar/Publicar | 3 |
| 2 sem prompt | 3 |
| 3 clique na branch atual no-op | 3 |
| 4 criar branch com sujos | 1 |
| 5 commit local | 1–3 |
| 6 push recusa suja | 1 |
| 7 push -u | 1 |
| 8 pull recusa suja | 1 (já existia) |
| 9 CredentialsWizard | 3 |
| 10 testes | 1–3 |
