# v15-05 — Bug (Windows): rename de tabela não propaga TODAS as refs

## Sintoma
No Windows, ao renomear uma tabela com **muitas constraints/refs** (ex.: `fct_marketing_wide`
com ~15 FKs, ou `gold.dim_product` → `gold.dim_productos`), o app abriu o modal de confirmação
de renomeação ("pediu pra editar a referência") e reportou `Edição aplicada (17 refs atualizadas)`,
mas **não atualizou todas** as referências. Não reproduz no macOS.

## Estado atual (código)
- Modal: `src/editor/RenameConfirmModal.tsx`; fluxo em `src/App.tsx` `handleEditorCommit` →
  `analyzeRenames` (`src/dsl/reconcile.ts`) → `applyRenames` (`src/App.tsx`) → `renameTable`
  (`src/dsl/edit.ts`).
- `renameTable` faz **um replace global** com `tableIdReplaceRegex(old)`:
  ```
  (?<![\w.])<old>(?=\.[A-Za-z_][\w]*|(?![\w.]))   // qualificado
  ```
- Contagem/impacto: `countRenameRefs` (`src/dsl/reconcile.ts`) e `splitDbmlBlocks`
  (`src/dsl/blocks.ts`).
- Arquivo lido/gravado pelo servidor: `server/files.ts` (`readFileSync`/`writeFile` utf8),
  sem normalização de fim de linha.

## Hipótese primária: fim de linha CRLF (Windows)
Git no Windows (`core.autocrlf=true`) grava `project.dbml` com `\r\n`. O servidor lê e envia o
texto com `\r\n`; o browser roda os regexes sobre CRLF. Suspeitas concretas a validar:
1. `splitDbmlBlocks` divide por `\n` deixando `\r` no fim de cada linha/bloco → cabeçalhos
   `Table x\r`, refs `... > gold.dim_product\r` podem escapar de algum casamento por token/limite.
2. `countRenameRefs`/análise de impacto conta menos ocorrências → o modal propaga só um subconjunto.
3. Refs **inline** (`col [ref: > tabela.col]`) vs `Ref:` de topo podem casar diferente com CRLF.

## Plano de investigação (Fase 1 — antes de qualquer fix)
1. **Repro sintético (macOS):** montar um DBML com `\r\n` e 20+ refs para `gold.dim_product`
   (inline + `Ref:` + `TableGroup` + `Lineage`/`LineageFields`), rodar `renameTable`/`applyRenames`
   e conferir se **todas** as ocorrências mudam. Test em `src/dsl/__tests__/`.
2. Instrumentar: comparar contagem `countRenameRefs` vs ocorrências reais em texto LF vs CRLF.
3. Confirmar em qual camada some (regex do `renameTable`, `splitDbmlBlocks`, ou a contagem).

## Correção proposta (dependente da investigação)
- **Normalizar fim de linha para `\n`** o mais cedo possível: ao carregar o projeto
  (`src/App.tsx` load) e/ou no servidor (`server/files.ts` na leitura), converter `\r\n`→`\n`.
  O editor já trabalha em LF; salvar em LF é aceitável e determinístico.
- Garantir que `renameTable` e `renameColumnAllRefs` sejam **CRLF-safe** (defensivo) mesmo que a
  normalização exista.

## Arquivos prováveis
`src/dsl/edit.ts` (regex CRLF-safe), `src/App.tsx` (normalização no load), `server/files.ts`
(normalização na leitura), `src/dsl/blocks.ts` (se `splitDbmlBlocks` for a causa) + testes.

## Critérios de aceite
- Test com entrada CRLF + 20 refs: `renameTable` atualiza **100%** das ocorrências (inline,
  `Ref:`, `TableGroup`, `Lineage`, `LineageFields`).
- Repro documentado; fix verificado (idealmente em Windows real, ou repro CRLF sintético verde).
- Nenhuma regressão nos testes de rename existentes (`renameDetect`, `reconcile`, `propagateKeyRename`).

## Risco
Normalizar fim de linha muda o arquivo salvo (LF). Aceitável e desejável (consistência). Conferir
que o diff de "primeiro save no Windows" não assuste (documentar).
