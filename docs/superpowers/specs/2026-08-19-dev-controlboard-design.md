# Spec: Controlboard de dev (`npm run dev` sob demanda)

## Problema

Hoje `npm run dev` (sem argumentos) sobe **todos** os projetos do registry `local` de
uma vez, cada um numa porta (`scripts/dev.mjs` + `parseDevArgs` → modo `all` por
default). Duas limitações:

- **Eager, não sob demanda**: todo projeto conhecido sobe, mesmo os que você não vai
  usar na sessão — desperdiça portas/processos e o terminal já nasce lotado de URLs.
- **Enxerga só o domínio `local`**: `scripts/registry.mjs` lê apenas
  `data/domains/local/projects.json` via `spawnSync` de um script bootstrap. Domínios
  git-clonados (`data/domains/<slug>/`, ver `docs/superpowers/specs/2026-08-04-git-domains-versioning-design.md`)
  não aparecem nesse fluxo — só são alcançáveis abrindo uma instância `--shared` e
  navegando pelo `DomainPicker` já existente dentro do app.

Não existe hoje uma tela que liste **domínio + projeto, local ou git, e só aloque uma
porta quando você clica**.

## Meta

`npm run dev` sem argumentos passa a abrir um **controlboard**: uma UI mínima,
dev-only, que lista todos os domínios (locais e git) e os projetos dentro de cada um.
Clicar num projeto aloca uma instância dedicada (server+vite, porta própria) na hora —
não antes. Várias instâncias podem ficar rodando ao mesmo tempo. O controlboard continua
aberto como um dashboard: lista as instâncias rodando, com link e botão de parar.

**Fora de escopo**: o app em produção (`AppGate`/`DomainPicker`/`App.tsx`) não muda em
nada — o controlboard é uma ferramenta de dev isolada, não uma feature do produto.

## Compatibilidade (não regride)

- `npm run dev -- <slug>` / `npm run dev -- <slug1> <slug2>` continuam pulando direto
  pra instância dedicada, sem passar pelo controlboard — fluxo hoje usado por quem já
  sabe o slug de cor.
- `--all` (sobe tudo do domínio `local` de uma vez) e `--shared` (instância única com
  `DomainPicker` interno) continuam existindo como flags explícitas, com o mesmo
  comportamento atual.
- `--preview`, `--list` inalterados.
- **Único comportamento que muda**: a ausência de qualquer flag/slug, que hoje resolve
  pra `all` e passa a resolver pra `board`.

## Arquitetura

### Processo novo: `server/controlboard.ts`

Fastify, rodado via `tsx` (mesmo padrão de `server/index.ts`), disparado por
`scripts/dev.mjs` no modo `board`. Sobe numa porta fixa (default 5170, com fallback
pra próxima livre via `findFreePort` se ocupada — reaproveita `scripts/devPorts.mjs`).
`scripts/dev.mjs` imprime só essa URL no terminal.

Importa `server/domains.ts` e `server/files.ts` **diretamente** — sem o `spawnSync`
bootstrap que `scripts/registry.mjs` usa hoje — então enxerga todos os domínios em
`data/domains/*`, não só `local`.

**Ponto de atenção real**: `getActiveDomainSlug()`/`listProjects()` (em
`server/domainContext.ts` / `server/files.ts`) usam estado mutável em memória do
processo — um domínio ativo por vez. Pra listar projetos de vários domínios,
`GET /api/board/domains` percorre os domínios **sequencialmente**:
`setActiveDomainSlug(d.slug)` → `ensureRegistry()` → `listProjects()` → próximo,
montando a árvore domínio→projetos numa única resposta. Isso é seguro porque é leitura
local, mas a rota não deve rodar concorrente com ela mesma (chamadas simultâneas
pisariam no estado ativo) — trivial de garantir já que é um endpoint GET simples, sem
paralelismo interno.

### Extração: `scripts/instanceLauncher.mjs`

A função `startInstance()` (spawn do par server+vite pinado por env
`LOCALDRAWDB_DOMAIN`/`LOCALDRAWDB_PROJECT`, hoje inline em `scripts/dev.mjs`) é extraída
pra um módulo compartilhado, JS puro (ESM), importável tanto por `scripts/dev.mjs`
(modos `all`/`project`/`shared` sem mudança de comportamento) quanto por
`server/controlboard.ts` (via import direto — `tsx` importa `.mjs` sem atrito).

### Endpoints do controlboard

- `GET /api/board/domains` — árvore domínio→projetos (local + git), com badge
  local/git (reaproveita `domainBadge` já usado no `DomainPicker`).
- `POST /api/board/domains` / `POST /api/board/domains/clone` — cria domínio local /
  clona de git. Mesma lógica de `domains.ts` que a rota `/api/domains` já expõe hoje.
- `DELETE /api/board/domains/:id` — apaga domínio (reaproveita `deleteDomain()` de
  `server/domains.ts`, a mesma função por trás de `DELETE /api/domains/:id`). Se o
  domínio tiver instâncias rodando, elas são paradas primeiro (mesmo mecanismo do
  botão "Parar").
- `POST /api/board/projects` — cria projeto num domínio (reaproveita `createProject()`
  de `files.ts`, com o domínio setado como ativo primeiro).
- `POST /api/board/instances { domainSlug, projectId }` — aloca porta livre, spawna via
  `instanceLauncher.startInstance()`, guarda `{ id, domainSlug, projectId, apiPort,
  webPort, pids }` num `Map` em memória, retorna a URL.
- `GET /api/board/instances` — lista instâncias rodando (pra polling).
- `DELETE /api/board/instances/:id` — mata os processos filhos (`SIGTERM`), remove do
  Map.

### UI

HTML+JS simples servido como estático pelo próprio `server/controlboard.ts` — sem
Vite, sem build, sem React (ferramenta de dev, não parte do app).

- **Domínios → projetos**: árvore expansível vinda de `GET /api/board/domains`, com o
  badge local/git. Ações: `+ Novo domínio local`, `+ Clonar repositório`,
  `+ Novo projeto` (dentro de um domínio), `Apagar domínio` — todas espelhando
  exatamente o que o `DomainPicker` já oferece hoje, só que antes de qualquer instância
  subir.
- **Instâncias rodando**: populada por polling em `GET /api/board/instances` (~2s).
  Cada linha: link clicável, domínio/projeto, botão "Parar".

## Ciclo de vida / erros

- `SIGINT`/`SIGTERM` no controlboard mata todas as instâncias filhas antes de sair
  (mesmo padrão do `shutdown()` que já existe em `scripts/dev.mjs`).
- Instância que cai sozinha (processo filho sai com código != 0): listener de `exit`
  marca como "morta" e remove da lista — não fica link fantasma.
- Falha ao spawnar (porta ocupada, dependência faltando) vira erro 4xx/5xx na resposta
  da API, mostrado na UI — não derruba o controlboard.
- Apagar domínio com instância(s) rodando: para as instâncias primeiro, depois chama
  `deleteDomain()` — nunca apaga a pasta com processo ainda escrevendo nela.

## Testes

- `server/__tests__/controlboard.test.ts`: rotas de listagem (multi-domínio, ordem,
  domínio sem projetos), criação/clone/apagar domínio, criação de projeto — contra
  `LOCALDRAWDB_DATA_DIR` temporário, mesmo padrão dos testes de servidor existentes.
- Tracking/stop de instância testado com função de spawn injetável (processo fake) —
  sem subir processos reais no CI.
- `scripts/devArgs.mjs`: atualizar teste existente — default sem args agora é `'board'`
  em vez de `'all'`.
- Smoke manual: `npm run dev` → abrir controlboard → lançar projeto → confirmar URL
  sobe → "Parar" mata o processo → "Apagar domínio" com instância rodando para ela
  primeiro.

## Arquivos tocados

| Área | Arquivos |
|------|----------|
| Extração do launcher | `scripts/instanceLauncher.mjs` (novo), `scripts/dev.mjs` (usa o módulo extraído) |
| Modo default | `scripts/devArgs.mjs` (default `board`), `scripts/dev.mjs` (spawna `server/controlboard.ts` no modo `board`) |
| Servidor do controlboard | `server/controlboard.ts` (novo), UI estática embutida |
| Testes | `server/__tests__/controlboard.test.ts` (novo), `scripts/__tests__/devArgs.test.mjs` (atualizar) |

## Riscos

- **Estado ativo compartilhado ao listar domínios** → mitigado por percorrer
  sequencialmente, documentado acima; sem paralelismo dentro da rota.
- **Apagar domínio com instância rodando destrói arquivos em uso** → mitigado: para
  instâncias do domínio antes de `deleteDomain()`.
- **Divergência entre `DomainPicker` (produto) e UI do controlboard (dev)** → ambos
  chamam as mesmas funções de `domains.ts`/`files.ts`; só a camada HTTP/UI é duplicada,
  não a lógica de negócio.
