# v18-02 — Estado inicial limpo (sem seleção nem popups)

## Objetivo

Abrir o app deve mostrar um workspace neutro: canvas com o modelo, **nenhuma tabela
selecionada**, nenhum popup/painel transitório aberto. Hoje (reproduzido em contexto de
browser limpo, sem localStorage) o app abre com:

- uma tabela selecionada (`gold.dim_customer`) + barra "1 tabela selecionada … Apagar
  selecionadas" no topo do canvas;
- o popup de páginas/grupos ("67 de 67 tabela(s) visíveis…") expandido sobre o canvas;
- o painel "Dados (amostra)" aberto embaixo mostrando "0 linhas".

Como reproduz em contexto limpo, a causa é comportamento determinístico do app (não
estado persistido do usuário) — ex.: seleção/foco inicial disparado por
`focusTableId`/outline, e default `aberto` dos painéis.

## Comportamento esperado

1. **Sem seleção inicial**: nenhum nó `selected` após o load; `SelectionBar` oculta.
2. **Popups fechados por default**: painel de páginas/grupos (`PagesPanel`) inicia
   colapsado; "Dados (amostra)" inicia colapsado quando não há linhas para o contexto.
3. **Clique-fora fecha**: popups transitórios (páginas/grupos, dropdown Exportar, logs
   de status) fecham com clique fora e com `Escape`. (Dropdown Exportar já fecha — os
   demais devem seguir o mesmo padrão.)
4. Estado aberto/fechado que o usuário mudar é persistido (`localStorage`, padrão
   existente `ldb.*` / `COLLAPSE_KEY` do `LayersPanel`) — detalhes em v18-05; aqui só
   os defaults e o clique-fora.
5. Posição/zoom do viewport continuam sendo restaurados (isso é desejável).

## Investigação (primeiro passo)

Localizar a origem da seleção inicial: candidatos em `src/App.tsx` (sync
editor→canvas ao carregar o DBML, `focusTableId`/`focusNonce`), `src/editor/Outline.tsx`
(clique programático?) e `src/canvas/hooks/useCanvasNodes.ts` (flag `selected` derivada).
Registrar a causa na PR antes de corrigir.

## Arquivos

- `src/App.tsx` — origem provável do foco/seleção inicial.
- `src/canvas/PagesPanel.tsx`, `src/records/RecordsPanel.tsx` — default colapsado +
  clique-fora/`Escape`.
- `src/canvas/StatusLog.tsx` — clique-fora/`Escape` (se ainda não tiver).

## Critérios de aceite

- AC1: load em browser limpo → zero nós selecionados, `SelectionBar` ausente do DOM.
- AC2: `PagesPanel` e "Dados (amostra)" iniciam colapsados (dados vazios); expandir,
  recarregar → estado escolhido persiste.
- AC3: popup aberto + clique no canvas → fecha; `Escape` → fecha.
- AC4: selecionar tabela, recarregar → seleção **não** volta.

## Testes (TDD)

- Unit: default de `PagesPanel`/`RecordsPanel` (render inicial colapsado) via testing
  de componente ou extração do estado inicial para função pura testável.
- Headless `scripts/verify-initial-state.mjs`: contexto limpo → asserta ausência de
  `.selection-bar`/nó `.selected`; abre popup, clica no canvas, asserta fechamento.
