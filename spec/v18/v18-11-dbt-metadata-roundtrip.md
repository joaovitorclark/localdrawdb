# v18-11 — Export dbt com metadados LocalDrawDB + input lê de volta

## Objetivo

Tornar o pacote dbt exportado (`data/output/dbt/`) um formato de troca completo: quem
recebe importa o `schema.yml` (+ models `.sql`) e abre o modelo com tipos, cores,
camadas, grupos, PKs, records e linhagem — paridade com o SQL (v18-01) e o DBML
(v18-10). O canal é o campo **`meta:`** do dbt (sancionado para metadados livres:
o dbt ignora, ferramentas preservam).

## Diagnóstico (2026-07-06)

- Export `schema.yml` **não emite `data_type`** → tipos das colunas se perdem (o
  import já lê `data_type`, o gap é só no export).
- Export não emite `meta:` → layer, group, cores, records, PK explícita/composta e
  linhagem L2 se perdem.
- `schema.yml` avulso (fora de pasta) perde o **schema** das tabelas (import usa o
  diretório-pai como schema; avulso fica sem).
- Linhagem L1 já round-trippa via `ref()`/`source()` nos models `.sql` gerados.

## Formato — `meta.localdrawdb`

Por tabela (models **e** sources):

```yaml
- name: fato_venda
  description: ...
  config: { materialized: table }
  meta:
    localdrawdb:
      schema: silver          # preserva o schema em schema.yml avulso
      layer: prata
      layerColor: "#c0c0c0"   # cor da camada (redundante por tabela; agregada no import)
      group: fatos
      groupColor: "#112233"
      color: "#b08d57"        # cor da tabela
      pk: [venda_key]         # explícita; lista com 2+ = PK composta
      records:                # amostra (bloco Records)
        columns: [venda_key, valor]
        rows: [["1", "99.9"]]
  columns:
    - name: cliente_key
      data_type: bigint       # campo padrão dbt (import já lê)
      meta:
        localdrawdb:
          color: "#ff0000"    # cor do nome da coluna
          map:                # linhagem L2 (campo→campo)
            table: silver.dim_cliente
            column: cliente_key
            note: lookup
```

Chaves ausentes são omitidas (yml limpo). `layerColor`/`groupColor` repetem por tabela
e o import agrega em `Model.layerColors` / `colors['@grupo']` (última ocorrência vence —
são sempre iguais por construção no export).

## Mudanças

### A. `server/dbtExport.ts`
1. `columnEntry`: emite `data_type` (`type` + `(args)` quando houver) e
   `meta.localdrawdb` com `color` (de `model.colors["qn.col"]`) e `map` (de
   `model.lineageFields` com target = a coluna).
2. Entrada de model/source no `schemaYml`/`sourcesYml`: emite `meta.localdrawdb` com
   schema/layer/layerColor/group/groupColor/color/pk/records conforme o `Model`.
   `pk` = colunas PK (flags + `compositePks`).

### B. `server/dbtImport.ts`
1. `parseModelEntry`/`parseSourceTable`: leem `meta.localdrawdb` — `schema` (quando não
   há `defaultSchema` de pasta), `layer`, `group`, `records`, `pk` (1 coluna → flag;
   2+ → `compositePks`, meta vence sobre inferência por tests).
2. Cores/L2 são agregadas no `Model` retornado: `colors` (tabela, `@grupo`,
   `tabela.coluna`), `layerColors`, `lineageFields`.
3. `schemaYmlToModel` e `dbtProjectToModel` propagam esses campos (o project em pasta
   agrega os parciais). `manifestToModel` fica fora do escopo (documentado).

### C. Sem mudança de rota
`runImport` já trata artefatos dbt em conjunto via `dbtFilesToModel`; com o `Model`
carregando cores desde a v18-01, `modelToDbml` regrava tudo.

## Critérios de aceite

- AC1: export dbt de modelo com cores/camadas/grupos/PK composta/records/L2 →
  `schema.yml` contém `data_type` em toda coluna tipada e `meta.localdrawdb` conforme o
  formato acima; YAML válido para o dbt (chaves padrão intactas).
- AC2: importar o pacote gerado (schema.yml + models) num projeto vazio devolve DBML
  com `Colors {}`, `LayerGroup [color:]`, `TableGroup`, `LineageFields`, `Records`,
  tipos e PKs equivalentes ao original.
- AC3: schema.yml de terceiros **sem** `meta.localdrawdb` continua importando como hoje
  (sem regressão nos testes dbt existentes).
- AC4: round-trip dbt não altera linhagem L1 (via ref()/source() dos models .sql).

## Testes (TDD)

- `server/__tests__/dbtMetaRoundtrip.test.ts` (novo):
  - export: `data_type` emitido; `meta.localdrawdb` por tabela e por coluna; omissão
    quando não há metadado.
  - import: meta aplicada (layer/group/schema/pk/records); cores agregadas em
    `colors`/`layerColors`; `map` vira `lineageFields`.
  - round-trip completo: DBML → dbt files → Model → DBML preserva cores, camadas com
    cor, grupos, PK composta, records, L2 e tipos.
  - schema.yml sem meta → comportamento atual (guarda de regressão).
