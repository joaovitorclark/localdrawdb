# Spec — Menu git na toolbar (commit / pull / push)

**Data:** 2026-08-18
**Status:** aprovado (aguardando revisão do usuário)
**Branch alvo:** `feat/git-panel-menu`
**Depende de:** [Spec A — Domínios versionados](2026-08-04-git-domains-versioning-design.md), já implementada.

## Objetivo

O painel git da toolbar hoje espalha a branch e quatro botões
(`Atualizar`, `Publicar`, `Abrir PR`, `Credenciais`) e usa `window.prompt`
para mensagem de commit e para trocar/criar branch. Clicar na branch
preenche o prompt com o nome atual: confirmar sem mudar o texto é no-op
silencioso. Criar branch com arquivos não commitados é bloqueado pelo
servidor — diferente do git.

Esta spec troca isso por **um botão só** (a branch atual) que abre um
dropdown, com **commit**, **pull** e **push** como ações separadas, nas
palavras do git. Criar uma branch nova leva as mudanças não commitadas
junto, como `git switch -c`.

## Escopo

### Dentro

- Um controle na toolbar: trigger = nome da branch + resumo de status +
  chevron; clique abre/fecha o dropdown (mesmo padrão do menu Exportar).
- Dentro do menu: status, lista de branches, criar branch, commit, pull,
  push, Abrir PR, Credenciais.
- Labels das três operações git: `commit`, `pull`, `push` (não
  “Atualizar” / “Publicar”).
- Mensagem de commit e nome da branch nova entram em campos do próprio
  menu. Zero `window.prompt` / `window.confirm` no fluxo git.
- `GET /api/domains/:id/git-status` passa a incluir a lista de branches.
- `commit` e `push` viram endpoints separados. O `Publicar` atual
  (`add + commit + push` num passo) some.
- Criar branch com working tree suja é permitido; os arquivos não
  commitados continuam não commitados na branch nova.

### Fora (YAGNI / v1)

- Layout remoto `localdrawdb/` + `oracledatamodeler/` + README (spec
  futura).
- Espelhamento / export Data Modeler.
- Stash, merge, rebase, apagar branch, rename de branch.
- Criar o repositório no GitHub pela API.
- Resolver conflito de merge dentro do app.
- Traduzir “Abrir PR” e “Credenciais” / “Criar branch” para inglês.

## Decisões de design

| Decisão | Escolha | Por quê |
|---|---|---|
| Forma do controle | Um dropdown ancorado no nome da branch, no padrão do `ExportMenu` | Usuário pediu um botão só; a toolbar já tem esse padrão (Exportar, ProjectSwitcher). |
| Verbos | `commit`, `pull`, `push` | Palavras que o usuário já usa no git; “Publicar” misturava commit+push. |
| Commit vs push | Separados. Commit nunca dá push. Push nunca dá commit. | Igual ao git. Fluxo: criar branch (sujos vão junto) → commit na branch nova → push quando quiser enviar. |
| Push com working tree suja | Recusa com aviso para commitar primeiro | Push não deve inventar commit nem mandar arquivo não commitado. |
| Push sem commits à frente | Recusa (“Nada para enviar”) **só** quando a branch já tem upstream e `ahead == 0`. Branch nova (sem `origin/<branch>`) **pode** dar push: é o `push -u` da primeira vez. | Sem isso, criar branch → commit → push falharia sempre. |
| Pull com working tree suja | Continua bloqueando, como hoje | Evita merge surpresa por cima de edição local. |
| Criar branch com sujos | Permitido; mudanças vão para a branch nova sem commit automático | `git switch -c` no git normal. O bloqueio atual era o bug que o usuário bateu. |
| Trocar para branch **existente** com sujos | Tenta `git switch`; se o git recusar, mostra o erro | Git às vezes deixa (arquivos não sobrepostos) e às vezes recusa. Não ser mais estrito que o git. |
| Clicar na branch atual na lista | No-op (já estamos nela) | Evita o bug do prompt pré-preenchido com `main`. |
| Primeiro push de branch nova | `git push -u origin <branch>` | Precisa de upstream; é o que `commitAndPush` já faz hoje, só que agora no `push` sozinho. |
| Auth | Falha de credencial em pull/push continua abrindo o `CredentialsWizard` | Já existe e funciona; o menu só reusa. |

## Arquitetura

### UI — `src/domains/GitPanel.tsx`

Substitui a fileira de botões por um trigger + dropdown (fechar no
clique fora e no Escape, igual `ExportMenu`).

Ordem no menu:

1. Status (não clicável): o mesmo texto de `formatGitSummary` (`● N não
   commitados`, `↑N`, `↓N`, ou `Em dia`).
2. Lista de branches locais (a atual marcada). Clique numa outra chama
   `switchGitBranch(id, name, false)` e dispara `onRepoChanged` se
   suceder.
3. Campo de nome + botão **Criar branch**. Chama
   `switchGitBranch(id, name, true)`. Working tree suja **não** é
   motivo de recusa no servidor.
4. Campo de mensagem + botão **commit**.
5. Botão **pull**.
6. Botão **push**.
7. **Abrir PR** e **Credenciais** — mesmo comportamento de hoje.

Mensagens de sucesso/erro ficam no próprio dropdown (não dependem de
`prompt`). Enquanto uma ação roda, os botões do menu desabilitam.

Domínio sem git: o `GitPanel` continua não renderizando nada. Anexar
repositório permanece no picker, fora desta spec.

### Servidor — `server/git.ts` + rotas

`listBranches` já existe e não é exposto. `GET git-status` passa a
devolver `branches: string[]` junto com o status atual.

`switchBranch(dir, branch, create)`:

- Se `create === true`: **não** checa dirty. Roda `git switch -c
  <branch>`. Os arquivos modificados permanecem no working tree.
- Se `create === false`: não há pré-check nosso de dirty. Roda `git
  switch <branch>`. Recusa só se o git recusar (stderr vai na mensagem
  de erro da API).

Nova função `commit(dir, message)`:

```
git add -A
git status --porcelain   # se vazio → erro "Nada para commitar"
git commit -m <message>
```

Não dá push.

Nova função `push(dir)`:

```
# se working tree suja → erro "Há mudanças não commitadas — commite antes de enviar."
# se a branch já tem upstream (origin/<branch> existe) e ahead == 0
#   → erro "Nada para enviar."
# se ainda não tem upstream → permitido (primeiro push da branch)
git push -u origin <branch-atual>
```

`commitAndPush` deixa de ser usado pelas rotas (pode ser removido ou
ficar só como helper de teste legado — preferível remover e atualizar
os testes).

Rotas:

- `POST /api/domains/:id/git/commit` `{ message }` → `commit()`
- `POST /api/domains/:id/git/push` deixa de receber `message`; só
  `push()`
- `POST .../git/switch-branch` e `POST .../git/pull` como hoje, com a
  regra nova de dirty no switch
- `GET .../git-status` inclui `branches`

Front (`src/api.ts`): `gitCommit(id, message)`, `gitPush(id)` sem
mensagem, `GitStatusResponse` com `branches` quando `hasGit: true`.

### Dados / git do domínio

Nada muda no layout em disco (`data/domains/<slug>/` continua sendo a
raiz do git do domínio). Esta spec não mexe em como o remoto é criado
nem no que é versionado.

## Critérios de aceitação

1. Com domínio git aberto, a toolbar mostra **um** controle git (nome da
   branch). Não há botões `Atualizar` nem `Publicar`.
2. Abrir o menu não usa `window.prompt`. Criar branch, commit e push
   usam campos/botões do dropdown.
3. Clicar na branch atual (trigger ou item da lista) não chama git.
4. Com arquivos modificados não commitados, **Criar branch** `foo`
   sucede; `git status` na pasta do domínio mostra os mesmos arquivos
   sujos, agora em `foo`.
5. **commit** com mensagem grava um commit local e **não** fala com o
   remoto. O resumo passa a mostrar `↑1` (ou `↑N`) se houver upstream.
6. **push** com working tree suja não chama `git push` e mostra o aviso
   de commitar primeiro.
7. **push** com working tree limpa e commits à frente envia ao `origin`
   (`-u` na primeira vez da branch).
8. **pull** com working tree suja continua recusando, com a mensagem já
   existente.
9. Falha de autenticação em pull/push abre o `CredentialsWizard`.
10. `npm test` e `npm run typecheck` passam. Testes novos cobrem:
    `commit` vs `push` em `git.ts`; switch `-c` com dirty; `git-status`
    devolve `branches`.

## Testes

- `server/__tests__/git.test.ts`: `commit` (add+commit, erro se nada
  pendente, não chama push); `push` (recusa dirty, recusa ahead 0, chama
  `push -u origin <branch>`); `switchBranch(..., true)` **não** falha
  por dirty e chama `switch -c`.
- `server/__tests__/domainRoutes.test.ts`: rotas `git/commit` e
  `git/push` (push sem `message`); `git-status` inclui `branches`.
- `src/domains/__tests__/gitPanelHelpers.test.ts`: resumo inalterado
  (já cobre dirty/ahead/behind). Qualquer helper novo do menu (ex.:
  “pode fazer push?”) ganha teste aqui.

Não é obrigatório teste de componente React do dropdown nesta spec;
o comportamento git é o que tem que estar blindado. O checklist
manual: abrir o domínio de teste, criar branch com os 2 arquivos não
commitados visíveis, commit, push, conferir no GitHub.
