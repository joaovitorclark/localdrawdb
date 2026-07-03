# Demo educativa — Lakehouse Oracle

Projeto **genérico** (comércio/vendas) para explorar o LocalDrawDB com dados mockados em volume moderado (**21 tabelas**), sem domínio proprietário.

## O que este pacote demonstra

| Recurso | Onde ver |
|---------|----------|
| **Import Oracle** (`VARCHAR2`, `NUMBER`, `CONSTRAINT`, `COMMENT ON`) | [`../input/demo_lakehouse_oracle.sql`](../input/demo_lakehouse_oracle.sql) |
| **FK** (`FOREIGN KEY` + `@fk`) | staging → silver, fato → dim |
| **PK simples e composta** | `erp_pedido_item`, `bridge_conta_contato`, `report_executivo` |
| **Linhagem L1** (`@origen`, fan-in) | `fato_pedido`, `fato_cliente_mes` |
| **Linhagem L2** (rodapé `@lineage`) | dims, fatos, gold |
| **Records + `@note`** | blocos `Records` no DBML gerado |
| **Camadas** (`LayerGroup`) | bronze / prata / ouro com `[color: …]` |
| **Grupos** (`TableGroup`) | ingestao_oracle, dimensoes, fatos, … |
| **Cores no script** (`Colors {}`) | tabelas + `@grupo` no `project.dbml` |
| **Tabela larga + scroll** | `silver.fato_pedido_item` (52 colunas) |
| **Layout pronto** | `canvas.json` (posições, páginas, largura da tabela larga) |

## Arquivos

```
examples/
├── input/demo_lakehouse_oracle.sql   # SQL Oracle (fonte para import)
└── demo_lakehouse_oracle/
    ├── project.dbml                  # modelo completo (+ Colors, Lineage, Records)
    ├── canvas.json                   # layout educativo (autolayout + páginas por grupo)
    └── README.md                     # este arquivo
```

## Como usar (projeto dedicado)

```bash
# 1) Crie a pasta do projeto (nome livre; slug sugerido abaixo)
mkdir -p data/projects/demo-lakehouse-oracle/input

# 2) Copie SQL + artefatos prontos
cp examples/input/demo_lakehouse_oracle.sql data/projects/demo-lakehouse-oracle/input/
cp examples/demo_lakehouse_oracle/project.dbml data/projects/demo-lakehouse-oracle/
cp examples/demo_lakehouse_oracle/canvas.json data/projects/demo-lakehouse-oracle/

# 3) Suba o app e abra o projeto (ou use ./ldb demo-lakehouse-oracle se o slug existir no registry)
npm run dev
```

Alternativa: copie **só** o SQL para `data/input/` de um projeto existente e clique **Importar (input/)** — o merge preserva refs/linhagem do editor; para a experiência completa (cores + layout), use o par `project.dbml` + `canvas.json`.

## Roteiro sugerido no canvas

1. Painel **Páginas** → filtre por `fatos` ou `dimensoes`.
2. **Mostrar relacionamentos** → FKs verdes; role `silver.fato_pedido_item` (scroll interno).
3. **Mostrar linhagem** → arestas tracejadas L1; painel **Mapeamento L2** para campo→campo.
4. Selecione uma tabela → cor no header (●) e cor do grupo (◑ na caixa `TableGroup`).
5. Painel **Dados (amostra)** → constraints PK/FK e linhas de `INSERT`.

## Regenerar DBML a partir do SQL

Se editar o `.sql`, regenere o modelo:

```bash
npx tsx scripts/gen-demo-oracle-dbml.mjs
```

(O script fica em `scripts/` — ver cabeçalho do SQL.)
