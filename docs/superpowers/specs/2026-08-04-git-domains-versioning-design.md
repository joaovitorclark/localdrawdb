# Spec A — Domínios versionados (git) e sistema de projetos

**Data:** 2026-08-04
**Status:** aprovado (aguardando revisão do usuário)
**Branch alvo:** `feature/git-domains`
**Depende de:** nada (base). A [Spec B — pacote portátil Windows](2026-08-04-windows-portable-package-design.md) depende desta.

## Objetivo

Substituir o modelo atual (`data/projects/<slug>/`, registry único `projects.json`,
projeto sempre local/gitignored) por uma hierarquia de dois níveis —
**domínios** (opcionalmente ligados a um repositório git) contendo **projetos** —
para que modelos possam ser compartilhados em equipe via git: clonar, ver status,
trocar de branch, atualizar (pull) e publicar (commit+push) direto pela UI, sem
sair do LocalDrawDB. Inspirado no fluxo de versionamento do Oracle SQL Developer
Data Modeler (ver pesquisa abaixo).

Muda também o modelo de execução: cada processo do servidor passa a servir **um
projeto por vez** (contexto ativo), escolhido numa tela de "picker" no boot — em
vez do padrão atual de subir todos os projetos de uma vez (`./ldb`) ou uma
instância com seletor embutido (`./ldb --shared`).

### Referência: Oracle SQL Developer Data Modeler

- Distribuição: ZIP portátil com JDK embutido, sem instalador
  ([oracle.com/tools/downloads](https://www.oracle.com/database/sqldeveloper/technologies/sql-data-modeler/download/)).
- Versionamento: repositório de arquivos (SVN, depois Git), um arquivo por
  objeto/tabela para facilitar diff/merge; painel de **"Outgoing Changes" /
  "Incoming Changes"** deixa claro o que está pendente de commit vs. o que
  existe no remoto e ainda não foi puxado
  ([thatjeffsmith.com](https://www.thatjeffsmith.com/archive/2015/05/sql-developer-data-modeler-pending-changes-versioning/),
  [ADTmag](https://adtmag.com/articles/2011/01/31/oracle-sql-data-modeler.aspx)).
- Merge de conflito é manual/colaborativo; branching é possível mas
  desencorajado para modelos de dados.

## Escopo

### Dentro

- Hierarquia `domínio → projeto → arquivos`, com domínio podendo ou não ser um
  repositório git.
- Migração automática e idempotente do layout atual (`data/projects/<slug>/`)
  para um domínio `local` (sem git) no primeiro boot pós-upgrade.
- CRUD de domínios: clonar por URL, anexar git a domínio local existente, criar
  domínio 100% local.
- CRUD de projetos dentro de um domínio (criar, renomear, duplicar, excluir —
  paridade com o que já existe hoje).
- Operações git por domínio: status (branch, ahead/behind, arquivos
  modificados), trocar/criar branch, pull (atualizar), commit+push (publicar),
  montar link de abrir PR/MR.
- Assistente de credenciais (token) integrado à UI, delegando o armazenamento
  ao credential helper do git do sistema.
- Tela de escolha (picker) como novo ponto de entrada, reutilizável tanto no
  boot quanto no botão "trocar projeto" dentro do app.
- Toda a camada de arquivos/paths usa `path.join`/`path.sep` (nada de `/`
  hardcoded) — arquitetura é a mesma em Windows, Linux e macOS; só a
  [Spec B](2026-08-04-windows-portable-package-design.md) adiciona um
  empacotamento extra específico do Windows por cima dela.

### Fora (YAGNI / v1)

- Resolução de merge conflict dentro do app (usuário resolve fora, via
  git/editor externo).
- Múltiplos remotes por domínio.
- Criação de PR/MR via API do provedor (GitHub/GitLab/etc.) — só o link.
- OAuth próprio / gestão de expiração e renovação automática de token.
- SSH no assistente de credenciais (documentado como alternativa manual).
- Sistema de versões/snapshots nomeados dentro do app — `git log`/branches já
  cobrem histórico e rollback.
- Empacotamento Linux/macOS equivalente ao da Spec B (fica pra depois, se
  fizer sentido; a arquitetura já não impede).

## Decisões de design

| Decisão | Escolha | Por quê |
|---|---|---|
| Mapeamento domínio↔repo | 1 domínio = 1 pasta = 0 ou 1 repo git; 1 repo pode conter N projetos (subpastas) | Usuário confirmou: flexível — de "1 repo por projeto" a "1 repo pra vários projetos", mas dentro de 1 pasta de projeto tudo é único (dbml+canvas+input+docs). |
| `canvas.json` versionado? | Sim, entra no git junto com `project.dbml` | Design completo (layout incluso) vira fonte de verdade compartilhada — quem dá pull vê o mesmo canvas de quem editou. |
| Backend git | Shell-out pro `git` do sistema (sem lib JS) | Robusto, cobre auth/SSH/LFS de graça; custo (exigir git instalado) é aceitável e documentado. |
| Escopo do "Publicar" | `git add -A && commit && push` na raiz do **domínio** | Git opera por repo; um commit pode tocar vários projetos do mesmo domínio — normal e esperado. |
| Pull com mudança pendente | Bloqueia com aviso, nunca merge automático | Zero risco de perda de dado/conflito surpresa; usuário resolve (salvar/commitar) antes. |
| Abrir PR | Heurística de URL por host (GitHub/GitLab/Bitbucket/Azure DevOps); host desconhecido só mostra a URL do remote | Cobre os provedores pedidos sem side-load de API/tokens de app. |
| Credenciais | Delegadas ao credential helper do SO via `git credential approve`; assistente na UI só gera o token guiado (deep-link) e entrega pro helper | App nunca guarda segredo em arquivo próprio; ainda assim cobre quem não tem familiaridade com git (gatilho automático em falha de auth + tela "Credenciais"). |
| Migração dos 5 projetos atuais | Automática, cria domínio `local` sem intervenção do usuário | Zero fricção pós-upgrade; git é opt-in depois. |
| Escopo de execução | 1 processo = 1 projeto ativo por vez, trocável via botão "voltar à tela de escolha" (sem matar o processo) | Atende ao pedido explícito de "executar só dentro do projeto"; evita reintroduzir a complexidade de estado multi-projeto simultâneo que a spec anterior já tinha achado arriscada (undo/redo, autosave por projeto). |
| Docs do modelo | Pasta `docs/` dentro de cada projeto, versionada junto | Separado da documentação do próprio LocalDrawDB (`README.md`, `spec/`, `docs/superpowers/`), que não muda de lugar. |
| Compat retroativa de rotas antigas | Não mantida | Usuário confirmou que reestruturar persistência/projetos é aceitável nesta mudança. |

## Arquitetura

### Layout em disco

```
data/
  domains/
    <domain-slug>/            # pasta = working copy de um repo git, ou pasta comum
      .git/                   # só existe se o domínio foi clonado/anexado a um repo
      domain.json             # { id, slug, name, hasGit, remoteUrl? }
      projects/
        <project-slug>/
          project.dbml
          canvas.json
          input/               # .sql/.yml para Importar (input/) — mesmo formato de hoje
          docs/                # notas/dicionário de dados do modelo, versionado junto
  domains.json                 # registry: [{ id, slug, name, path }]
```

- `examples/` permanece como está hoje (fixtures do próprio repo do app, não é
  dado de usuário).
- Migração (idempotente, no boot): se existir `data/projects/<slug>/` e não
  existir `data/domains/`, cria `data/domains/local/` (sem `.git`), move os
  projetos existentes para dentro como estão, registra em `domains.json`. Se já
  existir `data/domains/`, não faz nada.

### Camada de servidor

- `server/domains.ts` (novo, substitui parte de `server/files.ts`):
  `domainDir(slug)`, `listDomains()`, `createLocalDomain(name)`,
  `cloneDomain(url)`, `attachGit(domainId, remoteUrl?)`, `listProjects(domainId)`.
- `server/git.ts` (novo): wrapper fino sobre `child_process.execFile('git', [...])`
  com cwd = raiz do domínio — `status()`, `currentBranch()`, `switchBranch()`,
  `pull()`, `commitAndPush(message)`, `remoteUrl()`, `credentialApprove(host,
  username, token)`.
- `server/prUrl.ts` (novo): dado `remoteUrl` + `branch`, retorna a URL de
  compare/PR pro host detectado (github.com, gitlab.com, bitbucket.org,
  dev.azure.com) ou `null` pra host desconhecido (front mostra só a URL crua).
- Rotas novas: `GET/POST /api/domains`, `POST /api/domains/:id/clone`,
  `POST /api/domains/:id/attach-git`, `GET /api/domains/:id/git-status`,
  `POST /api/domains/:id/git/{pull,push,switch-branch,credential}`,
  `GET /api/domains/:id/projects`, mais os endpoints de projeto existentes
  reancorados em `domainId`.
- **Contexto ativo:** o processo guarda `{ domainId, projectId }` em memória
  (não em disco — cada relançamento volta pro picker); `POST
  /api/context/activate` troca sem reiniciar o processo.

### UI

- Nova tela `src/domains/DomainPicker.tsx`: lista domínios (badge 🔒 Local / 🌿
  Git+branch) e projetos; ações de criar/clonar/anexar domínio e criar/abrir
  projeto. É a tela de boot e o destino do botão "trocar projeto".
- Painel de git na toolbar (`src/domains/GitPanel.tsx`), visível quando o
  projeto ativo pertence a um domínio git: branch (dropdown trocar/criar),
  indicador `● N não commitado / ↑N / ↓N / ✓ em dia`, botões Atualizar /
  Publicar / Abrir PR / Credenciais. Domínio local mostra só "Anexar
  repositório".
- Assistente de credenciais `src/domains/CredentialsWizard.tsx`: explicação →
  deep-link de criação de token por host → campo colar token (+ usuário se
  necessário) → salva via `credentialApprove` → reexecuta a ação que falhou.

## Critérios de aceitação

1. Boot numa instalação existente migra os 5 projetos atuais para
   `data/domains/local/projects/` sem perda, sem intervenção do usuário, e é
   idempotente (rodar duas vezes não duplica nem quebra nada).
2. Picker lista domínios e projetos corretamente, com badge de status git.
3. Criar domínio local, clonar por URL e anexar git a domínio local funcionam.
4. Abrir um projeto ativa o contexto; canvas carrega normalmente com todas as
   features atuais intactas (editor, undo/redo, import/export, records,
   linhagem, camadas, etc.).
5. Botão "trocar projeto" volta ao picker sem matar o processo/servidor.
6. Painel de git mostra branch, ahead/behind e arquivos modificados
   corretamente; trocar de branch funciona; pull com mudança pendente é
   bloqueado com mensagem clara; pull limpo atualiza os arquivos e a UI
   recarrega o projeto.
7. Publicar cria commit com mensagem editável e faz push da branch ativa;
   botão Abrir PR abre a URL certa para GitHub/GitLab/Bitbucket/Azure DevOps, e
   mostra só a URL crua para host desconhecido.
8. Falha de autenticação em clone/pull/push dispara o assistente de
   credenciais; salvar o token faz a operação funcionar na sequência sem
   reiniciar o app.
9. `npm test` verde, incluindo os testes novos listados abaixo.
10. `npm run typecheck` verde.

## Testes novos

- `server/__tests__/domains.test.ts`: registry (CRUD), migração idempotente
  (rodar 2x), slug único, `createLocalDomain`, `attachGit`.
- `server/__tests__/git.test.ts`: wrapper de comandos git com `child_process`
  mockado — status parsing, bloqueio de pull com mudança pendente,
  commit+push, propagação de stderr em erro.
- `server/__tests__/prUrl.test.ts`: montagem de URL por host (GitHub, GitLab,
  Bitbucket, Azure DevOps) e fallback pra host desconhecido.
- `src/domains/__tests__/DomainPicker.test.tsx`: listagem, criação, abertura de
  projeto.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Perda de dado na migração | Idempotente, só move quando `data/domains/` não existe; nunca sobrescreve; coberto por teste. |
| Usuário sem `git` instalado tenta usar recursos git | Detecção no boot; ações git mostram aviso com link de instalação em vez de falhar silenciosamente; domínios locais continuam 100% funcionais. |
| Commit acidental de segredo (token) em arquivo versionado | Token nunca é escrito em arquivo do domínio/projeto — só via `git credential approve` no helper do SO. |
| Merge conflict trava o usuário | Fora de escopo v1: mensagem de erro clara aponta para resolver via git/editor externo; não tentamos resolver dentro do app. |
| Regressão de features atuais (undo/redo, autosave, export, records, linhagem) | Contexto ativo por processo simplifica o problema (volta a ser essencialmente single-project em runtime); suíte de testes existente deve continuar verde antes de mesclar. |

## Arquivos tocados (estimativa — plano detalhado fica para a fase de `writing-plans`)

- Novos: `server/domains.ts`, `server/git.ts`, `server/prUrl.ts`,
  `server/routes/domainRoutes.ts`, `src/domains/DomainPicker.tsx`,
  `src/domains/GitPanel.tsx`, `src/domains/CredentialsWizard.tsx`, testes
  correspondentes.
- Modificados: `server/files.ts` (paths reancorados em domínio/projeto),
  `server/routes.ts` (remove rotas legadas de projeto único, registra as
  novas), `server/index.ts` (chama migração no boot), `src/App.tsx` (contexto
  ativo, botão "trocar projeto", ponto de entrada no picker), `src/api.ts`
  (client das novas rotas), `scripts/dev.mjs` / `scripts/registry.mjs` (CLI
  `./ldb` passa a operar sobre domínios/projetos).
- Removidos/depreciados: `data/projects.json` (substituído por
  `domains.json` + `domain.json` por domínio), lógica de
  `multi-project-spec.md` F0–F4 (superada por esta spec).
