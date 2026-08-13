# LocalDrawDB

## Requisitos

- **Node.js 20 LTS ou superior** (22 LTS recomendado para instalação nova)
- **npm 10+** (incluso no instalador oficial do Node)

Verifique antes de começar:

```bash
node -v   # v20.x ou v22.x
npm -v    # 10.x ou superior
```

Com [nvm](https://github.com/nvm-sh/nvm) ou [fnm](https://github.com/Schniz/fnm): na pasta do projeto, `nvm install` / `fnm install` (lê `.nvmrc`).

Nenhum banco, nenhum Docker.

## Rodando

```bash
npm install
npm run dev          # sobe TODOS os projetos, cada um na sua porta (o terminal lista as URLs)
npm run dev:shared   # 1 instância única servindo todos, com o seletor de projeto na UI
# Ctrl-C encerra todas as instâncias do conjunto
```

> `npm run dev` sem argumentos abre **um servidor por projeto** (cada um numa porta). Para
> rodar **só alguns**, passe os slugs (ver abaixo); para a **instância única** de antes, use
> `npm run dev:shared` (ou `./ldb --shared`).

Produção (um processo serve UI + API):

```bash
npm run build
npm start          # http://localhost:5174
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

- O argumento é o **slug** do projeto (`./ldb --list` mostra todos). Aceita **substring única**
  (`lakehouse` → `exemplo-lakehouse-medallion`); se for ambíguo ou inexistente, lista os
  candidatos e aborta sem subir nada.
- Numa instância **fixada**, a UI mostra um rótulo **📌 \<projeto\>** no lugar do seletor —
  trocar/criar/excluir projeto fica desabilitado (cada instância serve só o seu projeto, e
  não interfere nas outras).
- **`--preview`** sobe, por projeto, **só** o servidor de produção (serve o `dist/` buildado
  + a API na mesma porta, **sem Vite**). É a forma leve de manter vários projetos abertos:
  rode em modo dev (com HMR) o que você está editando e `--preview` nos que são só de leitura.
  Subir **tudo em modo dev** continua pesado por natureza (N Vites) — a economia vem de
  rodar só o necessário e usar `--preview` para o resto.

`Ctrl-C` encerra todas as instâncias do conjunto. Detalhes em
[`spec/per-project-ports-spec.md`](spec/per-project-ports-spec.md).

## Distribuição Windows (sem instalar Node)

Pra usuários Windows que não querem instalar Node.js: baixe o pacote portátil
(`LocalDrawDB-win.zip`) na [página de Releases](https://github.com/joaovitorclark/localdrawdb/releases/latest),
extraia numa pasta qualquer e dê duplo-clique em
`LocalDrawDB.exe` — sem instalador, sem precisar de administrador. Os dados
ficam na pasta `data/` ao lado do executável, então mover a pasta inteira
(inclusive pra um pendrive) leva tudo junto.

O app abre numa **janela de aplicativo** (sem barra de endereço nem abas),
usando o Microsoft Edge que já vem no Windows — e cria um atalho na Área de
Trabalho na primeira execução. Se o Edge não estiver disponível, ele abre no
navegador padrão normalmente. Apagar o atalho não o faz voltar; para recriá-lo,
apague `data/.desktop-shortcut-attempted` e abra o app de novo.

A janela usa um perfil próprio do Edge em `data/edge-profile/` (não interfere
no seu Edge do dia a dia). Apagar essa pasta é seguro — ela é recriada no
próximo uso.

Recursos de git (clonar, pull, commit, push) dependem do
[Git for Windows](https://git-scm.com/download/win) instalado; sem ele o app
funciona normalmente com domínios locais e avisa nas ações de git.

Se você já usa **WSL**, não precisa deste pacote — rode o fluxo normal
(`npm install && npm run dev`) dentro dele.

Para gerar o pacote (mantenedores do projeto): `npm run build:win` — detalhes
em [`scripts/build-win/README.md`](scripts/build-win/README.md).

## Como usar

- **Editor (esquerda)**: DBML com realce de sintaxe, **Outline** (filtro + clique para ir à linha/tabela), fold de comentários.
- **Undo/Redo** (↶ ↷ ou Cmd/Ctrl+Z e Cmd/Ctrl+Shift+Z): histórico global (texto + canvas).
- **Organize**: reordena o DBML em `tabelas → refs → records → lineage` (preserva comentários).
- **+ Tabela / + Metadados**: nova tabela ou snippet de colunas lakehouse padrão.
- **Importar (input/)**: mescla arquivos de `data/input/` — `.sql` (Spark, Oracle, `@layer`/`@group`/`@note`/`@fk`, `COMMENT ON`, PK composta), **`.dbml`** (formato nativo, sem perdas — mande seu `project.dbml` para alguém importar) e **pacotes dbt** (`schema.yml`/models; metadados LocalDrawDB viajam em `meta.localdrawdb`). Exemplos versionados em [`examples/input/`](examples/input/) — copie para `data/input/` ou use o pacote [`examples/demo_lakehouse_oracle/`](examples/demo_lakehouse_oracle/) (SQL + DBML + canvas prontos).
- **Exportar** (menu + botão): escolha o formato e gera artefatos em `data/output/`:
  - **LocalDrawDB (Spark/Oracle)** — SQL reimportável com metadados (`@map`, `@layer`, `INSERT`, cores via `@colors`/`@layercolors`): quem importa abre o modelo com as mesmas cores e linhagem (só as posições do canvas não viajam)
  - **Spark DDL** — `CREATE TABLE` Delta por schema
  - **Oracle DDL / PostgreSQL DDL** — `CREATE TABLE` + `ALTER TABLE` FK (sem metadados)
  - **erwin (ANSI)**, **dbt**, **Mermaid**
- **Export PNG**: download + `data/output/diagram.png`

### Interações no canvas

- **Hover** numa tabela destaca relações FK (verde) e esmaece o resto.
- **Crow's foot** nas pontas das relações.
- **Arrastar coluna → coluna** cria `Ref:` no DBML; reconectar ou Delete remove.
- **Painel Camadas** (canto superior direito): visibilidade por camada, esmaecer, **Mostrar linhagem**, busca de tabelas, **Organizar canvas**, modo linhagem.
- **Problemas** (canto inferior esquerdo): avisos/erros de modelo (PK ausente, ref inválida, linhagem quebrada).
- **Clicar coluna** → painel PK/FK/not null; **ⓘ** no header → metadados (sample, linhagem, FKs).
- **Cor por tabela** (●) e **TableGroup** / **LayerGroup** no DBML.

### Linhagem (tabela → tabela)

- Bloco `Lineage { destino < origem }` no DBML (distinto de FK).
- **Mostrar linhagem**: exibe arestas tracejadas sem entrar no modo edição.
- **Modo linhagem**: tabelas compactas, portas nas bordas (estilo draw.io); FKs ocultas; arrastar entre portas cria linhagem.

### Records (dados de exemplo)

Blocos `Records` preservados; painel **Dados (amostra)** filtra por tabela/grupo selecionado. `@note` no import SQL vai para Records, não para o `Table`.

> Identidade visual **Seguros Unimed** (azul-marinho + verde). Specs em [`spec/`](./spec).

## Salvamento

- **Salvar** (botão ou Cmd/Ctrl+S): grava `data/project.dbml` + `data/canvas.json`.
- **Auto-save** (toggle verde/vermelho na toolbar): salva automaticamente após 1,5s quando há alterações pendentes (desligado por padrão).
- Estados: **Salvando… / Salvo ✓ / ● Não salvo / ⚠ Falha ao salvar**.

## Contrato de dados

O repositório público contém **apenas** a fixture genérica [`examples/input/demo_lakehouse_oracle.sql`](examples/input/demo_lakehouse_oracle.sql) (+ pacote [`examples/demo_lakehouse_oracle/`](examples/demo_lakehouse_oracle/) com DBML e canvas). Não versionamos modelos ou SQLs de domínios proprietários.

- **Copie** os exemplos para `data/input/` antes de importar.
- **Seu modelo** vive em `data/project.dbml` + `data/canvas.json` (gitignored).
- Trabalho local com dados sensíveis: branch `local/wip` ou pasta `data/` — **sem push**.

## Pasta `data/` (nunca versionada)

```
data/                          # gitignored — seu workspace local
├─ projects/<slug>/
│  ├─ input/                   # .sql para Importar (input/)
│  ├─ project.dbml             # fonte de verdade do modelo
│  └─ canvas.json              # posições, cores, páginas, grupos colapsados
└─ output/                     # exports (spark/, oracle/, dbt, PNG, …)

examples/                      # versionado — demos educativas
├─ input/                      # demo_lakehouse*.sql → copiar para data/…/input/
└─ demo_lakehouse_oracle/      # SQL + project.dbml + canvas.json prontos
```

## Exports

| Alvo | Saída | Observação |
|------|-------|------------|
| Spark/Databricks | `data/output/spark/<schema>.sql` | `CREATE TABLE ... USING DELTA` |
| dbt | `data/output/dbt/` | models `.sql` + `schema.yml` (+ `data_type` e `meta.localdrawdb`: cores, camadas, grupos, PK, records, linhagem L2) + `dbt_project.yml` — reimportável |
| erwin | `data/output/erwin/modelo.sql` | DDL ANSI para Reverse Engineer |
| Mermaid | `data/output/mermaid/modelo.mmd` | `erDiagram` |
| PNG | download + `data/output/diagram.png` | captura do canvas |

## Testes & verificação

```bash
npm test           # Vitest
npm run typecheck
node scripts/verify-render.mjs   # headless (Chrome + servidor :5192)
```
