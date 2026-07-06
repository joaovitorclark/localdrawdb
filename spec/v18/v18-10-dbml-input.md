# v18-10 — Input lê `.dbml` (formato de troca nativo, sem perdas)

## Objetivo

O jeito sem perdas de mandar um modelo para outra pessoa é o próprio DBML (fonte de
verdade: carrega `Colors`, `Lineage`, `LineageFields`, `Records`, `TableGroup`,
`LayerGroup [color:]`, notas, Dbt). Hoje `data/input/` só aceita
`.sql/.yml/.yaml/.json`. Passar a aceitar `.dbml` fecha o ciclo: exportar = enviar o
`project.dbml`; importar = soltar o arquivo em `input/` e clicar Importar.

## Comportamento

1. `IMPORT_EXTS` (`server/files.ts`) ganha `.dbml`.
2. `runImport` (`server/routes.ts`): arquivos `.dbml` são parseados com `dbmlToModel`
   e mesclados via `mergeModel` **antes** dos SQL/dbt (mesma semântica de merge:
   incoming vence por tabela; cores/linhagem mesclam por chave).
3. DBML inválido não aborta o import: gera warning `"<arquivo>: DBML inválido: <msg>"`
   e segue para os demais arquivos (mesmo contrato do baseDbml inválido).
4. Fidelidade é a do modelo canônico (comentários soltos do DBML de origem não são
   preservados — igual ao Organize). Cores, linhagem L1/L2, records, grupos, camadas
   com cor, notas e PKs compostas viajam integralmente.

## Critérios de aceite

- AC1: `model.dbml` com Colors/LayerGroup[color]/Lineage/LineageFields/Records em
  `input/` → `POST /api/import` devolve DBML com tudo presente; contagem em `imported`.
- AC2: `.dbml` inválido → warning, demais arquivos importados normalmente.
- AC3: merge com projeto existente: tabela homônima é substituída, cores mesclam por
  chave (incoming vence), refs deduplicam.

## Testes (TDD)

- `server/__tests__/routesImport.test.ts` (estender): fixture `.dbml` completo → POST
  `/api/import` com asserts de Colors/LayerGroup[color]/LineageFields no dbml devolvido;
  caso inválido → warning sem abortar.
