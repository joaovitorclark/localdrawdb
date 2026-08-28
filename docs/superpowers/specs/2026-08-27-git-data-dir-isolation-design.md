# Spec — Isolar o git de `data/` do repositório do LocalDrawDB

**Data:** 2026-08-27
**Status:** aprovado (aguardando revisão do usuário)
**Branch alvo:** `fix/git-data-dir-isolation`
**Depende de:** [Spec A — Domínios versionados](2026-08-04-git-domains-versioning-design.md) e
[Menu git na toolbar](2026-08-18-git-panel-menu-design.md), ambas implementadas.

## Objetivo

Quem baixa o LocalDrawDB normalmente pega um **clone do repositório**
(`.git` presente, `origin` apontando para o repo do LocalDrawDB). Os
dados do usuário vivem em `data/`, que está no `.gitignore` do projeto.

Quando um domínio git é criado ou aberto e, por qualquer motivo, a
pasta `data/domains/<slug>/` **não tem `.git` próprio** no momento em que
um helper de "primeiro commit" roda, o `git` sobe na árvore de
diretórios e encontra o `.git` do **próprio LocalDrawDB**. Como `data/`
está ignorado:

```
git add -A                                   # não estageia nada
git commit --allow-empty -m "first commit"   # commit vazio no branch atual do LocalDrawDB
git branch -M main                           # renomeia o branch do LocalDrawDB para "main"
git push -u origin main                       # push para o origin do LocalDrawDB
```

Resultado: o "remote do domínio" na prática é o do LocalDrawDB, e um
`push` do usuário vai parar no repositório errado.

Hoje isso é barrado por **um único** guard (`isGitRepo`, compara
`git rev-parse --show-toplevel` com o `dir`). Esta spec adiciona uma
barreira estrutural: **nenhum comando `git` disparado para um domínio
pode enxergar um repositório acima de `data/`**, e os helpers que
mutam histórico recusam rodar fora da raiz de um repo próprio.

## Escopo

### Dentro

- `server/git.ts`: todo spawn de `git` roda com
  `GIT_CEILING_DIRECTORIES` cobrindo o diretório base de dados
  (`baseDataDir()` e seu `realpath`). A descoberta de repositório do git
  para em `data/` e nunca alcança o `.git` do LocalDrawDB.
- Guard `assertOwnRepo(dir)` no início de `bootstrapEmptyRepo` e de
  `ensureInitialCommit` (os dois caminhos que levam a `commit` /
  `branch -M` / `push`): se `dir` não é a raiz de um repo git próprio,
  lança `GitError` com mensagem clara em vez de operar num repo
  ancestral. `initRepo` fica coberto por transitividade (chama
  `bootstrapEmptyRepo`) e pelo próprio ceiling (um `git remote add` /
  `rev-parse` após um `git init` que não criou `.git` já falha limpo).
- Testes de regressão com git real cobrindo o cenário exato (repo pai
  com `data/` ignorado, domínio sem `.git`).

### Fora (YAGNI)

- Mudar o layout em disco de `data/domains/<slug>/` (continua sendo a
  raiz do git do domínio).
- Mexer em como o remoto é criado, no fluxo de credenciais ou no
  conteúdo versionado.
- Detecção de versão do git / mensagens específicas para git < 2.28.
- Migrar domínios já existentes que tenham sido corrompidos por este
  bug (não há registro de que isso tenha acontecido em disco; se
  acontecer, o `.git` do domínio simplesmente não existe e o usuário
  reanexa).

## Causa raiz

`git` descobre o repositório subindo de `cwd` até achar um `.git` ou
cruzar um limite. Em `data/domains/<slug>/` sem `.git` próprio, o
primeiro `.git` encontrado é o do LocalDrawDB. `--is-inside-work-tree`
responde `true`, e `add`/`commit`/`branch -M`/`push` operam nesse repo.

`isGitRepo()` já corrige o **sintoma no `hasGit`** (comparando o
toplevel com o `dir`), e todas as rotas de git passam por ele. Mas:

- é um único ponto de falha (comparação de path, Windows, symlink);
- `initRepo`/`bootstrapEmptyRepo` chamam `gitCommitFirst` sem
  reconfirmar o guard — hoje seguros só porque `git init` roda antes,
  mas frágeis a qualquer regressão futura;
- em git < 2.28 `git init -b main` falha e `initRepo` lança antes do
  bootstrap — seguro por acidente, não por design.

## Decisões de design

| Decisão | Escolha | Por quê |
|---|---|---|
| Barreira principal | `GIT_CEILING_DIRECTORIES` no `env` de todo spawn de git | O git para de subir a árvore em `data/`; impossível alcançar o `.git` do LocalDrawDB, independentemente de comparação de path. |
| Valor do ceiling | `baseDataDir()` **e** `fs.realpathSync(baseDataDir())`, juntos por `path.delimiter` | `baseDataDir()` respeita `LOCALDRAWDB_DATA_DIR` (testes). O `realpath` cobre o symlink de `os.tmpdir()` no macOS e instalações via link. |
| Repo aninhado legítimo | Continua funcionando | O ceiling só impede subir **acima** de `data/`; um `.git` em `data/domains/<slug>/` é achado antes de chegar no teto. |
| Guard nos helpers mutadores | `assertOwnRepo(dir)` lança `GitError` se `dir` não é raiz de repo próprio; posto em `bootstrapEmptyRepo` e `ensureInitialCommit` | Defesa em profundidade: mesmo se o ceiling falhar num SO exótico, `commit`/`branch -M`/`push` não rodam fora do repo do domínio. |
| Forma do `assertOwnRepo` | `git rev-parse --git-dir` e comparar com `<dir>/.git` (sem tocar no `fs`) | `--git-dir` é `.git` na raiz do repo e caminho absoluto num subdiretório de repo ancestral — a distinção exata que interessa. Sem `fs.realpath`, fácil de cobrir em teste com mock. |
| `git init` que não cria `.git` (git antigo) | `git remote add` / `bootstrapEmptyRepo` falham logo em seguida (ceiling + guard) | Erro explícito em vez de seguir e vazar. |
| Comandos afetados | Todos em `git.ts` (o `spawnOptions` é compartilhado) | `git --version` e `git clone` não fazem descoberta de repo — ceiling é inócuo neles. |
| Mensagem do guard | PT-BR, sem credencial, cita o motivo | Consistente com o resto de `git.ts`; aparece na resposta HTTP 422. |

## Arquitetura

### `server/git.ts`

```ts
import { baseDataDir } from './domainContext.ts';
import { realpathSync } from 'node:fs';

// Diretórios-teto: o git nunca sobe acima de data/ procurando um .git —
// sem isso, data/domains/<slug>/ sem .git próprio "herdaria" o repo do
// LocalDrawDB (data/ está no .gitignore dele) e um commit/push vazaria pra lá.
function gitCeilingDirs(): string {
  const raw = baseDataDir();
  const dirs = new Set([raw]);
  try {
    dirs.add(realpathSync(raw));
  } catch {
    // data/ pode ainda não existir; o raw já cobre o caso comum
  }
  return [...dirs].join(path.delimiter);
}

function spawnOptions(cwd: string, timeout = 30_000) {
  return {
    cwd,
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CEILING_DIRECTORIES: gitCeilingDirs(),
    },
  };
}

/** Recusa operar quando `dir` não é a raiz de um repositório git próprio. */
async function assertOwnRepo(dir: string): Promise<void> {
  try {
    const gitDir = await run(dir, ['rev-parse', '--git-dir']);
    if (path.resolve(dir, gitDir) === path.resolve(dir, '.git')) return;
  } catch {
    // não está dentro de repo nenhum (com o ceiling, o caso comum do bug)
  }
  throw new GitError(
    `Recusado: "${dir}" não é a raiz de um repositório git próprio — ` +
      `operação abortada para não tocar no repositório do LocalDrawDB.`,
    '',
  );
}
```

- `bootstrapEmptyRepo(dir)`: `await assertOwnRepo(dir)` como primeira
  linha (antes do `push`).
- `ensureInitialCommit(dir)`: `await assertOwnRepo(dir)` como primeira
  linha (caminho do `switchBranch(..., create=true)` num repo sem HEAD).

`isGitRepo` permanece como está.

### Sem mudança

- Rotas (`server/routes/domainRoutes.ts`), `server/domains.ts`,
  frontend, layout em disco, `.gitignore`.

## Critérios de aceitação

1. Repo pai com `.gitignore` contendo `/data/`, no branch `work`.
   `data/domains/acme/` **sem** `.git`. Chamar `bootstrapEmptyRepo` ou
   `initRepo` (simulando git init que não criou `.git`) **lança** e:
   - o branch do repo pai continua `work`;
   - o log do repo pai não ganha commit;
   - nenhum branch `main` é criado no repo pai.
2. `data/domains/acme/` **com** `.git` próprio (após `git init` real):
   `bootstrapEmptyRepo` roda normalmente — README, first commit, e push
   quando há origin.
3. `attachGitToDomain` / `cloneDomain` continuam retornando
   `hasGit: true` e um repo isolado (origin = o que o usuário informou,
   nunca o do LocalDrawDB).
4. `isGitRepo(data/domains/<slug>)` continua `false` para domínio local
   sem `.git` e `true` para a raiz de um repo.
5. `npm test` e `npm run typecheck` passam. Testes novos cobrem os itens
   1 e 2 com git real.

## Testes

- `server/__tests__/gitDataDirIsolation.integration.test.ts` (git real):
  - repo pai + `data/` ignorado + domínio sem `.git` → `bootstrapEmptyRepo`
    e `gitCommitFirst` rejeitam; estado do repo pai intacto (branch, log,
    lista de branches).
  - domínio com `.git` próprio → `bootstrapEmptyRepo` cria o first commit.
- `server/__tests__/git.test.ts` (mock): `spawnOptions` inclui
  `GIT_CEILING_DIRECTORIES` no env passado ao `execFile`.
- `server/__tests__/isGitRepo.integration.test.ts`: inalterado, continua
  verde (o ceiling não muda o resultado quando o teto não é ancestral do
  `dir` testado).

Checklist manual: clonar o LocalDrawDB, `npm run dev`, criar domínio
local, anexar um repositório git de teste, commit + push, confirmar no
provedor que o commit chegou **no repo de teste** e que o repositório do
LocalDrawDB não mudou de branch nem ganhou commit.
