# v18-08 — Ícones SVG + tooltips próprios

## Objetivo

A UI mistura emoji (📌 ⓘ ● ↶ ↷ 🔑) com texto — renderização inconsistente entre
plataformas, peso visual desigual, ruim em zoom baixo. Tooltips hoje são 46 usos de
`title=` nativo (lentos, invisíveis para teclado). Substituir por um set SVG mínimo e
tooltip próprio.

Depende de **v18-03** (toolbar consolidada primeiro, para não iconizar botão que sai).

## Decisão

1. **Set de ícones inline** em `src/icons.tsx`: componentes SVG de 16×16, stroke 1.5,
   `currentColor` — `Undo`, `Redo`, `Pin`, `Info`, `Key` (PK), `Dot` (cor), `Search`,
   `Chevron`, `Close`, `Warning`, `Layers`. Sem biblioteca externa (bundle — v18-09).
   Emoji em **conteúdo de dados** (notas do usuário) não é afetado.
2. **Tooltip próprio** `src/Tooltip.tsx`: wrapper com delay de 300ms, aparece em hover
   **e** focus, posicionado acima/abaixo conforme espaço, `role="tooltip"` +
   `aria-describedby`. Migrar os `title=` de controles interativos; `title` informativo
   em texto estático pode ficar.
3. Botões só-ícone ganham `aria-label` obrigatório.

## Arquivos

- `src/icons.tsx` (novo), `src/Tooltip.tsx` (novo).
- Consumidores: `src/App.tsx` (undo/redo, pin), `src/canvas/TableNode.tsx` (ⓘ, 🔑, ●),
  `src/canvas/LayersPanel.tsx`, `src/ProjectSwitcher.tsx` (📌), `src/canvas/SelectionBar.tsx`.
- `src/styles.css` — `.tooltip`, alinhamento ícone+texto.

## Critérios de aceite

- AC1: zero emoji de UI nos componentes listados (grep por classe de emoji nos .tsx);
  ícones herdam a cor do texto (estados hover/disabled funcionam de graça).
- AC2: tooltip aparece em hover e em focus de teclado; some em blur/`Escape`.
- AC3: todo botão só-ícone tem `aria-label`.
- AC4: export PNG do canvas continua fiel (ícones SVG renderizam no html-to-image —
  verificar no script de PNG existente).

## Testes (TDD)

- Unit: Tooltip (render em focus, delay, `aria-describedby` ligado ao alvo).
- `src/__tests__/no-ui-emoji.test.ts`: varre os .tsx listados e falha se encontrar
  emoji fora de strings de dados/testes.
- Headless: atualizar screenshots dos scripts afetados (`verify-render.mjs`).
