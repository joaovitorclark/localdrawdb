# v18-05 — Painéis colapsáveis com estado persistido

## Objetivo

Em 1280×720 os painéis fixos (Camadas à direita, Dados embaixo, popup de páginas,
barra de seleção) deixam ~30% do canvas visível. Todo painel flutuante deve ser
colapsável a uma forma mínima, com estado persistido, devolvendo o canvas ao usuário.

Depende de **v18-02** (defaults do estado inicial definidos lá; aqui é o mecanismo).

## Comportamento esperado

1. **Camadas e tabelas** (`LayersPanel`): já tem colapso via `COLLAPSE_KEY` — vira o
   padrão de referência. Colapsado = uma pílula compacta ("Camadas ▸") no canto.
2. **Dados (amostra)** (`RecordsPanel`): header clicável colapsa para uma barra de
   28px com o título e contagem ("Dados (amostra) · 2 tabela(s)"). Persistido.
3. **Páginas no canvas** (`PagesPanel`): idem, colapsa para pílula.
4. **Problemas** (`ProblemsPanel`): mantém o comportamento flutuante v15-03; só ganha
   persistência do estado aberto/fechado se ainda não tiver.
5. **Padrão único**: um hook `useCollapsePersist(key: string, defaultCollapsed:
   boolean)` em `src/canvas/useDraggablePanel.ts` ou arquivo novo
   `src/hooks/useCollapsePersist.ts`; chaves `ldb.panel.<nome>` no localStorage.
   `LayersPanel` migra para o hook (mantendo a chave antiga como fallback de leitura).
6. Colapsar/expandir não dispara re-layout do canvas nem perde estado interno do
   painel (filtros, busca).

## Arquivos

- `src/hooks/useCollapsePersist.ts` (novo) — hook + leitura/gravação localStorage.
- `src/canvas/LayersPanel.tsx`, `src/records/RecordsPanel.tsx`,
  `src/canvas/PagesPanel.tsx`, `src/canvas/ProblemsPanel.tsx` — adoção.
- `src/styles.css` — estados colapsados (pílula/barra).

## Critérios de aceite

- AC1: cada um dos 4 painéis colapsa/expande por clique no header; estado sobrevive a
  reload (localStorage `ldb.panel.*`).
- AC2: com todos colapsados em 1280×720, a área de canvas visível é ≥ 80% do viewport
  (medível no headless: bounding boxes dos painéis).
- AC3: filtro digitado no LayersPanel permanece após colapsar/expandir.
- AC4: sem regressão nos scripts headless existentes de painéis
  (`verify-problems-badge.mjs`, `verify-records.mjs`).

## Testes (TDD)

- `src/hooks/__tests__/useCollapsePersist.test.ts`: default, toggle, persistência,
  fallback da chave antiga do LayersPanel.
- Headless `scripts/verify-collapse.mjs`: colapsa os 4, mede área livre, recarrega e
  asserta persistência.
