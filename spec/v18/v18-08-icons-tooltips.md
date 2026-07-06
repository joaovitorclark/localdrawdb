# v18-08 — Ícones SVG + tooltips próprios

> **Para agentes executores (Sonnet/multi-agente):** contexto zero assumido. Tarefas na
> ordem, TDD onde faz sentido (o `Tooltip` e o teste `no-ui-emoji` são unit; ícones são
> substituição mecânica). Gate final: `npm run typecheck && npm test` +
> `node scripts/verify-render.mjs` (screenshots) + export PNG fiel.
> Não altere emoji que faça parte de **dados do usuário** (notas, records) — só UI.

## Objetivo

A UI mistura emoji e glifos tipográficos (📌 ⓘ 🔑 📄 ↶ ↷ ● ⚠ ✕ ▾ ▸) com texto —
render inconsistente entre plataformas, peso visual desigual, ruim em zoom baixo.
Tooltips hoje são `title=` nativo (lentos, invisíveis para teclado). Trocar por um set
SVG mínimo `currentColor` + um tooltip próprio acessível.

Depende de **v18-03** (toolbar consolidada primeiro, para não iconizar botão que sai —
ver nota sobre o `.savestate` abaixo).

## Contexto do código (âncoras verificadas em 2026-07-06)

**Glifos de UI a substituir (arquivo:linha → ícone do novo set):**
- `src/App.tsx:1280` `↶` → `<Undo/>`; `:1283` `↷` → `<Redo/>`.
- `src/App.tsx:1324/1326/1327` `⚠`/`●`/`✓` no `.savestate` — **a v18-03 remove/funde
  esse span no StatusLog**. Se a v18-03 já foi feita, iconizar lá (StatusLog); se não,
  coordenar. Não duplicar.
- `src/canvas/TableNode.tsx:83` `ⓘ` → `<Info/>`; `:121` `●` (cor) → `<Dot/>`;
  `:129` `✕` → `<Close/>`.
- `src/canvas/TableColumnList.tsx:84` `🔑 ` (PK) → `<Key/>`.
- `src/ProjectSwitcher.tsx:91` `📌` → `<Pin/>`; `:115` `●` (dirty) → `<Dot/>`;
  `:117` `▾` → `<Chevron/>`; `:134` `✓` → `<Check/>`; `:162` `✕` → `<Close/>`.
- `src/canvas/ProblemsPanel.tsx:56` `⚠` → `<Warning/>`.
- `src/canvas/ColumnMappings.tsx:102` `📄` → `<Doc/>`; `:114` `✕` → `<Close/>`.
- Chevrons de colapso (todos `▾`/`▸`/`◂`): `LayersPanel.tsx:67`, `PagesPanel.tsx:72`,
  `RecordsPanel.tsx:148`, `ColumnPanel.tsx:128`, `GroupNode.tsx:50`, `Outline.tsx:36`,
  `ExternalGroupNode.tsx:28`, `ExportMenu.tsx:38` → `<Chevron dir="down|right|left"/>`.
- `✕` de fechar em `GroupNode.tsx:99`, `ColumnPanel.tsx:133/188`, `RelationEdge.tsx:100`,
  `LineageEdge.tsx:36` → `<Close/>`.
- `●`/`○` do modo linhagem `LayersPanel.tsx:133` → `<Dot filled|outline/>`.

**Emoji "de verdade" (pictográfico) — alvo do teste `no-ui-emoji`:** `📌` (Pin), `🔑`
(Key), `📄` (Doc). Glifos tipográficos (`↶ ↷ ● ○ ✕ ✓ ▾ ▸ ◂ ⚠ ⓘ`) também migram para o
set, mas o teste de regressão foca no bloco emoji Unicode (evita falso-positivo com
setas/checks que são pontuação).

**Tooltips (`title=`):** há ~46 usos de `title=` em `.tsx`. Exemplos interativos a
migrar: toolbar (`App.tsx:1279,1282,1285,1289,1301,1312`), `ProblemsPanel.tsx:53`,
`StatusLog.tsx:47`, `LayersPanel.tsx:65,93,131,159`, `PagesPanel.tsx:70`. `title` em
texto **estático/informativo** (ex.: chips com o id completo, `SelectionBar.tsx:35`)
pode ficar.

## Tarefas

### Tarefa 1 — Set de ícones inline

**Arquivos:** `src/icons.tsx` (novo); teste `src/__tests__/icons.test.tsx` opcional
(só smoke de render — **precisa de DOM**, e não há jsdom no repo → **pular o unit**,
cobrir por screenshot). 

Componentes SVG 16×16, `stroke="currentColor"`, `strokeWidth={1.5}`,
`fill="none"` (exceto `Dot`), `aria-hidden` por default, `focusable={false}`:
`Undo, Redo, Pin, Info, Key, Dot, Doc, Search, Chevron, Close, Check, Warning, Layers`.
`Chevron` recebe `dir: 'up'|'down'|'left'|'right'` (rotaciona via `transform`).
Sem biblioteca externa (bundle — v18-09). Props: `{ className?, size?, dir? }`.

### Tarefa 2 — Tooltip próprio acessível

**Arquivos:** `src/Tooltip.tsx` (novo); `src/styles.css`.

**API:** `<Tooltip label="Salvar (⌘S)"><button .../></Tooltip>` — envolve **um** filho
interativo. Comportamento:
- Aparece em `mouseenter` **e** `focus` (teclado), some em `mouseleave`/`blur`/`Escape`.
- Delay de 300ms na aparição (hover); em `focus` pode ser imediato.
- `role="tooltip"` + `id` gerado, ligado ao alvo por `aria-describedby`.
- Posiciona acima; se não couber (perto do topo), abaixo (medir com `getBoundingClientRect`).

**Teste:** o repo roda em `node` sem DOM — testar a **lógica pura** de posicionamento
extraída: `pickTooltipSide(anchorTop: number, tooltipH: number, margin: number): 'top'|'bottom'`
(`src/__tests__/tooltip.test.ts`), não o componente React. Ex.: âncora colada no topo →
`'bottom'`; com espaço acima → `'top'`.

### Tarefa 3 — Migração dos glifos para ícones

**Arquivos:** os listados no "Contexto do código".

Substituir cada glifo pelo componente correspondente. **Todo botão que fica só com
ícone ganha `aria-label`** (ex.: undo/redo, close, pin). Onde havia `📌`/`🔑`/`📄`,
remover o caractere e o espaço. Rodar `npm run typecheck` a cada arquivo.

### Tarefa 4 — Migração dos tooltips + guard anti-emoji

**Arquivos:** consumidores interativos; teste `src/__tests__/no-ui-emoji.test.ts` (novo).

1. Trocar `title="..."` de **controles interativos** por `<Tooltip label="...">`.
2. Teste de regressão (puro, lê os `.tsx` como texto):
   ```ts
   import { readFileSync } from 'node:fs';
   import { globSync } from 'node:fs'; // ou listar os arquivos alvo explicitamente
   const FILES = ['src/App.tsx','src/canvas/TableNode.tsx','src/canvas/TableColumnList.tsx',
     'src/ProjectSwitcher.tsx','src/canvas/ColumnMappings.tsx','src/canvas/ProblemsPanel.tsx'];
   const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}]/u;
   it('sem emoji pictográfico de UI', () => {
     for (const f of FILES) expect(EMOJI.test(readFileSync(f,'utf8'))).toBe(false);
   });
   ```
   (Ajustar a lista `FILES` aos arquivos realmente migrados. Não incluir arquivos de
   dados/testes.)

### Tarefa 5 — Verificação visual + PNG fiel

- `node scripts/verify-render.mjs` verde (zero erros de console) e atualizar screenshots.
- **Export PNG:** os ícones SVG inline precisam renderizar no `html-to-image`
  (`src/exportPng.ts`). Rodar o fluxo de PNG (botão/menu) e conferir que os ícones
  aparecem no `data/output/…/diagram.png` (SVG inline com `currentColor` costuma
  funcionar; se sumir, embutir `stroke`/`fill` explícito em vez de depender de CSS).

## Critérios de aceite

- AC1: zero emoji pictográfico (`📌 🔑 📄` etc.) nos componentes migrados
  (`no-ui-emoji.test.ts` verde); ícones herdam a cor do texto (hover/disabled de graça).
- AC2: tooltip aparece em hover **e** em focus de teclado; some em blur/`Escape`;
  `aria-describedby` liga alvo↔tooltip.
- AC3: todo botão só-ícone tem `aria-label`.
- AC4: export PNG continua fiel (ícones visíveis no PNG gerado).
- AC5: sem regressão de layout perceptível (comparar screenshots `verify-render`).

## Fora de escopo

- Emoji em **conteúdo de dados** (notas do usuário, records) — intocável.
- Biblioteca de ícones externa (proibida pelo orçamento de bundle — v18-09).
- Redesenho de cores/tema.
