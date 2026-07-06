# v18-07 — Overlay de atalhos `?` + descoberta de gestos

> **Para agentes executores (Sonnet/multi-agente):** contexto zero assumido. Tarefas na
> ordem, TDD (teste → falhar → implementar → passar). A parte testável é a derivação de
> dados (atalhos a partir do registry + gestos curados); o overlay é JSX fino. Gate
> final: `npm run typecheck && npm test` + `node scripts/verify-help.mjs` (`:5192`).

## Objetivo

Os recursos mais poderosos do canvas são invisíveis: arrastar coluna→coluna cria FK,
clicar coluna abre o painel de campo, ⓘ abre metadados, hover destaca relações, Delete
remove ref. Nada na UI ensina isso. Dar um ponto único de descoberta via `?`.

Depende de **v18-06** (o overlay lista os comandos do `CommandRegistry`, sem duplicar
strings).

## Contexto do código (âncoras verificadas em 2026-07-06)

- **Listener global de teclado:** `src/App.tsx:603-630` — hoje só trata `Cmd/Ctrl+*`
  (`if (!(e.metaKey || e.ctrlKey)) return;` na linha 605). O `?` é **sem modificador**,
  então **não** cabe nesse `return` cedo — precisa de um ramo próprio (ou listener
  próprio) que ignore quando o foco está num campo de texto/editor.
- **Registry de comandos:** `src/palette/registry.ts` (criado na v18-06) — tipo
  `Command { id, label, kind, hint?, run }`. O overlay deriva a coluna "Atalhos" dos
  comandos que têm `hint`.
- **Detecção de "estou digitando":** o alvo do evento é `document.activeElement` /
  `e.target`. O editor CodeMirror renderiza dentro de `.cm-editor` (classe do
  `@uiw/react-codemirror`); inputs comuns são `INPUT`/`TEXTAREA` ou
  `[contenteditable]`. O `?` **não** deve abrir quando o foco cai em qualquer um desses.
- **Padrão de modal/portal:** `StatusLog`/`ProblemsPanel` usam `createPortal` +
  fecha-ao-clicar-fora; `ExportMenu` fecha com `Escape`. Reusar essa linguagem.

## Tarefas

### Tarefa 1 — Dados: gestos curados + derivação de atalhos (puro)

**Arquivos:** `src/help/gestures.ts` (novo); teste `src/help/__tests__/help.test.ts` (novo).

**Produz:**
```ts
// Lista curada e estática (dados, não JSX) — testável.
export type Gesture = { gesture: string; effect: string };
export const CANVAS_GESTURES: Gesture[];

// Deriva a lista de atalhos a partir dos comandos do registry (só os que têm hint).
import type { Command } from '../palette/registry';
export type ShortcutRow = { keys: string; label: string };
export function shortcutsFromCommands(commands: Command[]): ShortcutRow[];

// Formata a tecla por plataforma (⌘ no Mac, Ctrl fora).
export function formatShortcut(mac: boolean, spec: { mod?: boolean; shift?: boolean; key: string }): string;
```

`CANVAS_GESTURES` (curado): hover destaca FKs; arrastar coluna→coluna cria `Ref:`;
clicar coluna abre o painel do campo; ⓘ abre metadados; Cmd/Ctrl+clique ou arrasto
seleciona várias; no modo linhagem, portas nas bordas editam linhagem; Delete remove
ref selecionada; Escape limpa seleção.

**Regras testáveis:**
- `shortcutsFromCommands` inclui **só** comandos com `hint` (ex.: Salvar `⌘S`, Undo
  `⌘Z`, Redo `⌘⇧Z`, Palette `⌘K`) e ignora os sem atalho.
- `formatShortcut(true, { mod:true, key:'S' })` → `⌘S`; `formatShortcut(false, ...)` →
  `Ctrl+S`; com `shift` → `⌘⇧S` / `Ctrl+Shift+S`.
- Atalhos fixos que não vêm do registry (Delete, Escape, `?`) podem ser um array
  estático concatenado — teste que eles aparecem na lista final.

**Passos:** teste primeiro (node, sem DOM) com um `commands` fixo; ver falhar; implementar.

### Tarefa 2 — Componente `ShortcutsOverlay`

**Arquivos:** `src/help/ShortcutsOverlay.tsx` (novo); `src/styles.css`.

**Props:** `{ open: boolean; shortcuts: ShortcutRow[]; gestures: Gesture[]; onClose: () => void }`.

Duas colunas: **Atalhos** (à esquerda) e **Gestos do canvas** (à direita). `Escape` e
clique-fora fecham. Scroll interno se estourar a altura (nunca corta conteúdo em
1280×720). Sem tour guiado, sem tooltips de primeira visita (YAGNI).

### Tarefa 3 — Ligação no App: tecla `?` + botão flutuante

**Arquivos:** `src/App.tsx`; `src/styles.css`.

**Passos:**
1. Estado `const [helpOpen, setHelpOpen] = useState(false)`.
2. Handler de `?` **fora** do `return` de modificador. Opção recomendada: um
   `useEffect` próprio com listener em `window` (fase de captura), que:
   ```ts
   const onKey = (e: KeyboardEvent) => {
     if (e.key !== '?') return;
     const el = e.target as HTMLElement;
     if (el.closest?.('.cm-editor, input, textarea, [contenteditable]')) return; // digitando
     e.preventDefault();
     setHelpOpen((o) => !o);
   };
   ```
3. Montar `shortcutsFromCommands(paletteCommands)` (reusa o registry da v18-06) +
   atalhos fixos; passar ao overlay junto de `CANVAS_GESTURES`.
4. Botão "?" discreto no canto inferior direito do canvas → `setHelpOpen(true)`.
5. Renderizar `<ShortcutsOverlay ... />` perto dos outros modais.

### Tarefa 4 — Verificação headless

**Arquivo:** `scripts/verify-help.mjs` (novo, boilerplate de `verify-render.mjs`).

```js
await page.waitForSelector('.react-flow__node', { timeout: 15000 });
// 1) ? abre o overlay
await page.keyboard.press('Shift+Slash'); // '?'
await page.waitForSelector('.shortcuts-overlay', { timeout: 3000 });
// 2) Escape fecha
await page.keyboard.press('Escape');
if (await page.locator('.shortcuts-overlay').count()) throw new Error('overlay não fechou com Escape');
// 3) ? dentro do editor NÃO abre
await page.click('.cm-editor');
await page.keyboard.press('Shift+Slash');
await page.waitForTimeout(300);
if (await page.locator('.shortcuts-overlay').count()) throw new Error('? abriu com editor focado');
```

## Critérios de aceite

- AC1: `?` abre o overlay; `Escape` e clique-fora fecham; `?` dentro do editor DBML ou
  de qualquer input **não** abre (digitação normal).
- AC2: todo comando do registry com `hint` aparece na coluna Atalhos (derivado, não
  hardcoded); atalhos fixos (Delete/Escape/`?`) também aparecem.
- AC3: overlay legível em 1280×720 (scroll interno se precisar; nunca corta conteúdo).
- AC4: formatação por plataforma (`⌘` no Mac, `Ctrl+` fora) — testada por unit.

## Fora de escopo

- Onboarding/tour guiado, tooltips de primeira visita, animações.
- Tooltips por elemento (isso é a **v18-08**).
