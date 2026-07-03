# Exemplos de import SQL (versionados)

Estes arquivos ficam no repositório em `examples/input/`. O app importa de **`data/input/`** (pasta local, no `.gitignore`).

## Contrato de dados

- **Fixture versionada:** [`demo_lakehouse_oracle.sql`](demo_lakehouse_oracle.sql) — lakehouse genérico (comércio/vendas) em sintaxe **Oracle**, com FK, linhagem L1/L2, constraints, cores e layout prontos no pacote [`../demo_lakehouse_oracle/`](../demo_lakehouse_oracle/).
- **Não commitar** SQLs de domínios proprietários — mantenha-os em `data/` local.
- Specs, testes e docs do repo referenciam apenas esta demo.

```bash
# Só SQL (import manual)
mkdir -p data/input
cp examples/input/demo_lakehouse_oracle.sql data/input/

# Pacote educativo completo (SQL + DBML + canvas)
mkdir -p data/projects/demo-lakehouse-oracle/input
cp examples/input/demo_lakehouse_oracle.sql data/projects/demo-lakehouse-oracle/input/
cp examples/demo_lakehouse_oracle/project.dbml data/projects/demo-lakehouse-oracle/
cp examples/demo_lakehouse_oracle/canvas.json data/projects/demo-lakehouse-oracle/
```

Depois use **Importar (input/)** na toolbar (se copiou só o SQL) ou abra o projeto com os três arquivos.

**Export LocalDrawDB:** na toolbar, escolha *LocalDrawDB (Spark)* ou *LocalDrawDB (Oracle)* no menu **Exportar** — gera SQL reimportável em `data/output/localdrawdb/`.

## Formato dos `.sql` em `data/input/`

Coloque seus scripts exportados do banco (Oracle, Spark/Delta, ANSI). O import mescla tudo no DBML do projeto.

## Metadados (comentários `-- @…`)

Funcionam em **qualquer** dialeto, acima do `CREATE TABLE`:

| Comentário | Efeito no DBML |
|------------|----------------|
| `-- @layer: bronze` | Entrada no `LayerGroup bronze` |
| `-- @group: ingestao` | Entrada no `TableGroup ingestao` |
| `-- @note: texto` | `Note:` no bloco **Records** (não no `Table`) |
| `-- @fk: col -> schema.tabela.col` | `Ref: tabela.col > schema.tabela.col` |
| `-- @origen: schema.origem` | `Lineage { destino < origem }` (L1 tabela→tabela) |
| `-- @lineage` (bloco-rodapé após o `CREATE`) | `LineageFields { dest.col < orig.col }` (L2) |
| `-- texto` inline na coluna | `[note]` no DBML / `COMMENT ON COLUMN` no Oracle |

### Linhagem L2 (campo→campo): bloco-rodapé `@lineage`

```sql
-- @layer: prata
-- @origen: staging.crm_conta
CREATE TABLE silver.dim_conta (
  sk_conta NUMBER(19) NOT NULL,
  conta_natural_id VARCHAR2(32),
  CONSTRAINT pk_dim_conta PRIMARY KEY (sk_conta)
);
-- @lineage silver.dim_conta
--   conta_natural_id <- staging.crm_conta.conta_id
--   razao_social <- staging.crm_conta.razao_social
```

> **Compat:** o formato antigo `coluna TIPO, -- @map <- ...` inline ainda é importado; o **export** sempre gera o rodapé `@lineage`.

## Relacionamentos (FK)

Ordem de leitura:

1. `CONSTRAINT … FOREIGN KEY … REFERENCES …` no `CREATE TABLE` (Oracle)
2. `FOREIGN KEY (col) REFERENCES tabela (col)` (ANSI)
3. `-- @fk: …` nos comentários

## PK composta

```sql
CONSTRAINT pk_report PRIMARY KEY (periodo, regiao)
```

Gera no DBML:

```dbml
indexes {
  (periodo, regiao) [pk]
}
```

## Cores (somente no DBML, não no SQL)

Persistidas no bloco `Colors {}` do script (ou pintadas no canvas):

```dbml
Colors {
  staging.erp_pedido: #b08d57
  @fatos: #15803d
}
```

Ver pacote completo em [`../demo_lakehouse_oracle/project.dbml`](../demo_lakehouse_oracle/project.dbml).

## Dialetos suportados

| Dialeto | Sinais | Fixture |
|---------|--------|---------|
| **Oracle** | `VARCHAR2`, `NUMBER(`, `CONSTRAINT`, `COMMENT ON` | `demo_lakehouse_oracle.sql` |
| **Spark/Delta** | `STRING`, `USING DELTA` | (export Spark a partir do modelo) |
| **ANSI** | `VARCHAR`, `INTEGER`, `PRIMARY KEY` | DDL genérico |

## Merge no re-import

- **Tabelas:** substituídas por nome qualificado (`schema.tabela`).
- **Refs:** união (não remove refs que existem só no DBML).
- **Linhagem L1/L2:** união (mantém entradas do editor + input; dedupe por par).

## Arquivo de exemplo

### [demo_lakehouse_oracle.sql](demo_lakehouse_oracle.sql) — educativo (Oracle)

- **21 tabelas** mockadas: staging → silver → gold
- **Constraints Oracle** (`CONSTRAINT pk_/fk_`), `COMMENT ON TABLE/COLUMN`
- **FK** no DDL + `@fk`; **PK composta**; **fan-in L1**; **L2** via rodapé `@lineage`
- **Tabela larga** `silver.fato_pedido_item` (52 colunas) — scroll no canvas
- **Pacote com layout e cores:** [`../demo_lakehouse_oracle/`](../demo_lakehouse_oracle/)
