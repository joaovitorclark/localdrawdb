# v18-01 — Export/import de cores no formato LocalDrawDB (Spark/Oracle)

## Objetivo

Quem recebe um arquivo exportado no formato **LocalDrawDB (Spark/Oracle)** deve abrir o
modelo **idêntico** ao original — tabelas pintadas, colunas pintadas, cores de grupo,
linhagem L1/L2, notas, records — com exceção **apenas** do posicionamento no canvas
(posições/tamanhos/páginas não viajam; ficam em `canvas.json`).

## Diagnóstico (verificado em 2026-07-06)

Round-trip real `dbmlToModel → modelToInputSql → sqlToModel`:

| Dado | Export | Import | Status |
|------|--------|--------|--------|
| Tabelas/colunas/tipos/PK/FK | ✓ | ✓ | ok |
| `@layer` / `@group` | ✓ | ✓ | ok |
| Notas (COMMENT ON TABLE/COLUMN, `@note`) | ✓ | ✓ | ok |
| Linhagem L1 (`-- @origen:`) | ✓ | ✓ | ok |
| Linhagem L2 (rodapé `-- @lineage` com `[note:, ref:]`) | ✓ | ✓ | ok |
| Records (INSERT) | ✓ | ✓ | ok |
| **Cor de tabela** (`Colors { schema.tabela: #hex }`) | ✗ | ✗ | **perde** |
| **Cor de grupo** (`Colors { @grupo: #hex }`) | ✗ | ✗ | **perde** |
| **Cor de coluna** (`Colors { schema.tabela.coluna: #hex }`) | ✗ | ✗ | **perde** |

Causa: o `Model` canônico (`server/model.ts`) não tem campo de cores; `dbmlToModel`
ignora o `colors` que `extractRecords` **já retorna** (`ParsedColor[]` em
`src/dsl/dbmlClean.ts`); `modelToDbml` nunca emite `Colors {}`; `sqlExport`/`sqlImport`
não conhecem cor.

## Decisão — formato no SQL

Rodapé global comentado no **fim do arquivo**, espelhando o bloco DBML `Colors {}` e o
padrão já existente do rodapé `-- @lineage` (SQL válido, ignorado por qualquer banco):

```sql
-- @colors
--   silver.dim_cliente: #b08d57
--   @dimensoes: #112233
--   silver.fato_venda.venda_key: #ff0000
```

- Uma entrada por linha: `--   <chave>: <#rrggbb>`. Chave idêntica à do bloco DBML
  (2 partes = tabela, `@nome` = grupo, 3 partes = coluna). Case preservado.
- No export **por dialeto** (`modelToInputSqlByDialect`), cada arquivo recebe só as
  entradas cujas tabelas estão naquele arquivo; entrada de grupo `@g` entra no arquivo
  que contém ao menos uma tabela do grupo `g`.

## Mudanças

### A. `server/model.ts`
- `Model.colors?: Record<string, string>` (chave = mesma sintaxe do bloco Colors).

### B. `server/dbmlIo.ts`
1. `dbmlToModel`: destruturar `colors` de `extractRecords(dbml)` e popular
   `model.colors` (omitir campo quando vazio).
2. `modelToDbml`: emitir bloco `Colors {\n  <chave>: <cor>\n}` ao final quando
   `model.colors` tiver entradas (depois de `Lineage`/`LineageFields`/grupos).

### C. `server/sqlExport.ts`
- `emitColorsFooter(model, tabelasDoArquivo?)`: gera o rodapé `-- @colors` filtrado.
- `modelToInputSql`: anexa o rodapé ao final do conteúdo (após a última tabela).
- `modelToInputSqlByDialect`: anexa por arquivo com o filtro descrito acima.

### D. `server/sqlImport.ts`
- Parser do rodapé: header `/^--\s*@colors\s*$/i`; entradas
  `/^--\s+(@?[A-Za-z0-9_.]+)\s*:\s*(#[0-9a-fA-F]{6})\s*$/`; linha que não casa encerra
  o bloco (mesmo contrato do `-- @lineage`).
- `sqlToModel`: retorna `model.colors` populado.
- Validação: chave de tabela/coluna que não existe no arquivo → warning
  (`@colors: tabela 'x' não encontrada`), consistente com os warnings de `@origen`.
  Chave `@grupo` não valida contra tabelas (grupo pode estar vazio).
- `mergeModel(base, incoming)`: `colors = { ...base.colors, ...incoming.colors }`
  (incoming vence por chave — mesmo critério do resto do merge).

### E. Integração (sem mudança de rota)
A rota de import já faz `dbmlToModel(atual) → mergeModel → modelToDbml`
(`server/routes.ts:81–107`); com A–D, o bloco `Colors {}` passa a fluir de ponta a
ponta sem tocar as rotas. O export (`exportDispatch` → `modelToInputSql`) idem.

## Critérios de aceite

- AC1: projeto com cor de tabela, cor de grupo e cor de coluna → Exportar LocalDrawDB
  (Oracle) → `data/output/localdrawdb/model_oracle.sql` termina com rodapé `-- @colors`
  contendo as 3 entradas.
- AC2: importar esse arquivo num **projeto vazio** → canvas exibe as mesmas cores de
  tabela/grupo/coluna; `project.dbml` gerado contém o bloco `Colors {}` equivalente.
- AC3: linhagem L1/L2, notas e records continuam round-trippando (sem regressão).
- AC4: arquivo exportado continua sendo SQL válido (rodapé 100% comentado); reimportar
  num projeto que **já tem** cores mescla por chave (incoming vence, demais preservadas).
- AC5: export Spark e export por dialeto misto recebem o rodapé com o filtro por arquivo.
- AC6: cor com formato inválido no arquivo (ex.: `#zzz`) é ignorada com warning, sem
  abortar o import.

## Testes (TDD)

- `server/__tests__/colorsRoundtrip.test.ts` (novo):
  - `dbmlToModel` expõe `colors` (tabela, `@grupo`, coluna).
  - `modelToDbml` emite `Colors {}` e omite quando vazio.
  - `modelToInputSql` (spark e oracle) emite rodapé `-- @colors` com as 3 chaves.
  - `sqlToModel` lê o rodapé de volta; chave inexistente gera warning; hex inválido ignora.
  - `mergeModel` mescla por chave com incoming vencendo.
  - Round-trip completo: DBML → SQL → Model → DBML preserva o bloco `Colors {}`.
  - `modelToInputSqlByDialect`: entrada de tabela oracle não aparece no arquivo spark.

## Verificação headless

`scripts/verify-colors-roundtrip.mjs`: sobe servidor com projeto de fixture pintado,
chama a API de export (oracle), copia o arquivo para `data/projects/<vazio>/input/`,
chama a API de import, abre o canvas e asserta as cores computadas nos nós (header da
tabela e nome da coluna) — padrão dos scripts `verify-colors.mjs`/`verify-groupcolor.mjs`.
