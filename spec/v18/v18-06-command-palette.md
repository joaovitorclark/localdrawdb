# v18-06 — Command palette (Cmd/Ctrl+K)

> **Para agentes executores (Sonnet/multi-agente):** contexto zero assumido. Tarefas na
> ordem, TDD (teste → falhar → implementar → passar). O grosso da lógica testável vive
> em `src/palette/registry.ts` (funções puras); a UI é acoplamento fino. Gate final:
> `npm run typecheck && npm test` + `node scripts/verify-palette.mjs` (servidor em `:5192`).
> Sem dependências novas (o bundle já está no limite — ver v18-09).

## Objetivo

Num modelo com 67+ tabelas, achar uma tabela ou disparar uma ação exige conhecer o
canto certo da UI (busca escondida no painel Camadas, ações espalhadas na toolbar). Um
palette único (Cmd/Ctrl+K) dá acesso a tudo por teclado, **delegando aos handlers já
existentes** (não reimplementa nada).

## Contexto do código (âncoras verificadas em 2026-07-06)

- **Atalhos globais** já são capturados **antes** do CodeMirror num único listener:
  `src/App.tsx:603-630` — `window.addEventListener('keydown', onKey, true)` (fase de
  captura), com `e.preventDefault()` + `e.stopPropagation()` por atalho. É aqui que
  entra o `Cmd/Ctrl+K` (mesmo padrão dos atalhos `z`/`y`/`s`).
- **Foco/seleção de tabela:** `focusTable(tableId, { pan })` (`src/App.tsx:644-651`) faz
  `setFocusTableId` + `useInteraction.getState().selectTable(tableId)` + `setFocusNonce`.
  `focusTableWithPan` (653-656) é o atalho "centra e seleciona". O `focusTableId`/
  `focusNonce` chegam ao `Canvas` (`src/App.tsx:1398-1400`) e movem a viewport via
  `FocusTableHelper` (`src/canvas/Canvas.tsx:550` e 166-190). **Reutilize
  `focusTableWithPan`** — não recriar o mecanismo de centragem.
- **Ações existentes (handlers no App.tsx):**
  - Salvar: `handleSave` (`358`).
  - Undo/Redo: `undo`/`redo` (usados em `603-630`; estados `past`/`future`).
  - Organizar DBML: `handleOrganize` (`1257`).
  - Organizar canvas (autolayout): `handleAutolayout` (`683`).
  - Exportar (por formato): `handleExportOption(opt)` (`1216`) com a lista
    `api.EXPORT_OPTIONS` (`src/api.ts:96-105`: `{ id, label, format, dialect? }`).
  - Export PNG: `handlePng` (`1228`).
  - Importar: `handleImport` (ligado ao botão em `App.tsx:1293`).
  - Auto-save: `setAutoSave((a) => !a)` (`169`, botão em `1313`).
  - Modo linhagem: `useInteraction.getState().toggleLineageMode` (ver
    `src/canvas/LayersPanel.tsx:33-34`).
- **Tabelas do modelo atual:** `activeModel.tables` (cada uma tem `.id` no formato
  `schema.tabela`, ex.: `gold.dim_customer`).
- **Estilo:** dropdowns/popovers já seguem uma família visual (ver `ExportMenu`
  `src/ExportMenu.tsx` e `StatusLog`/`ProblemsPanel` via portal). O palette usa a mesma
  linguagem (`src/styles.css`).

## Tarefas

### Tarefa 1 — Registry de comandos + filtro (núcleo puro)

**Arquivos:** `src/palette/registry.ts` (novo); teste
`src/palette/__tests__/registry.test.ts` (novo). **Roda em node — sem DOM.**

**Tipos e funções (produz):**
```ts
export type Command = {
  id: string;
  label: string;          // pt-BR
  kind: 'table' | 'action';
  hint?: string;          // atalho legível, ex.: '⌘S' (opcional)
  run: () => void;
};
export type PaletteItem = Command & { score: number };

// Monta a lista de tabelas + ações a partir das dependências injetadas (handlers).
export function buildCommands(deps: {
  tables: { id: string }[];
  actions: Command[];     // ações já prontas, montadas no App
  onFocusTable: (id: string) => void;
}): Command[];

// Filtro fuzzy por substring das PARTES do nome (case-insensitive) + ações.
export function filterCommands(all: Command[], query: string, limit?: number): PaletteItem[];
```

**Regras (testar todas):**
- `filterCommands(all, '')` → lista inicial (ações primeiro? Não: ver ordenação abaixo)
  limitada a `limit` (default 12).
- Substring case-insensitive: `dim_cust` casa `gold.dim_customer`; `CUSTOMER` também.
- Match nas partes: buscar `customer` casa `gold.dim_customer` (parte após o ponto).
- **Ordenação:** quando o termo casa com tabela **e** ação, **tabelas vêm primeiro**
  (o usuário busca objeto). Empate → ordem alfabética do label.
- Limite: nunca retorna mais que `limit` itens.

**Passos:**
1. Teste com um `all` fixo (2-3 tabelas + 2-3 ações) cobrindo: vazio→limite,
   substring, partes, ordenação tabela-antes-de-ação, `limit`.
2. Ver falhar; implementar filtro trivial (sem lib). `score` pode ser simples
   (0 = começa com o termo, 1 = contém) — só o suficiente para estabilizar a ordem.

### Tarefa 2 — Componente `CommandPalette`

**Arquivos:** `src/palette/CommandPalette.tsx` (novo); `src/styles.css`.

**Props:** `{ open: boolean; commands: Command[]; onClose: () => void }`.

**Comportamento:**
- Modal centrado com input focado no mount (`useEffect` + `ref.focus()`), lista abaixo
  (máx. 12 visíveis, scroll interno).
- `↑`/`↓` movem a seleção (índice em `useState`), `Enter` executa
  `items[sel].run()` e fecha, clique também.
- `Escape` fecha; clique-fora (no backdrop) fecha (padrão do `ExportMenu`).
- Recalcula `filterCommands(commands, query)` a cada tecla; reseta `sel` para 0 quando o
  query muda.

### Tarefa 3 — Ligação no App: atalho global + montagem das ações

**Arquivos:** `src/App.tsx`.

**Passos:**
1. Estado `const [paletteOpen, setPaletteOpen] = useState(false)`.
2. No listener de `App.tsx:603-630`, adicionar antes dos outros ramos:
   ```ts
   if (k === 'k') { e.preventDefault(); e.stopPropagation(); setPaletteOpen((o) => !o); return; }
   ```
   (Fase de captura já vence o CodeMirror — AC4.)
3. Montar `const paletteCommands = useMemo(() => buildCommands({...}), [...])` com as
   ações mapeadas para os handlers existentes:
   Salvar→`handleSave`, Organizar DBML→`handleOrganize`, Organizar canvas→
   `handleAutolayout`, cada `api.EXPORT_OPTIONS` → `() => handleExportOption(opt)`
   (label `Exportar ${opt.label}`), PNG→`handlePng`, Importar→`handleImport`, Undo→
   `undo`, Redo→`redo`, Auto-save→`() => setAutoSave(a => !a)`, Modo linhagem→
   `() => useInteraction.getState().toggleLineageMode()`. `onFocusTable` =
   `focusTableWithPan`.
4. Renderizar `<CommandPalette open={paletteOpen} commands={paletteCommands}
   onClose={() => setPaletteOpen(false)} />` no fim do JSX (perto dos modais, ~1478).
5. Botão discreto de busca na toolbar que faz `setPaletteOpen(true)` (opcional visual;
   pode reaproveitar um ícone da v18-08 se já existir — senão texto "Buscar ⌘K").

### Tarefa 4 — Verificação headless

**Arquivo:** `scripts/verify-palette.mjs` (novo, boilerplate de `verify-render.mjs`).

```js
await page.waitForSelector('.react-flow__node', { timeout: 15000 });
// Abrir com Cmd+K (Meta no headless roda em Linux? usar Control como fallback)
await page.keyboard.press('Control+KeyK');
await page.waitForSelector('.command-palette input', { timeout: 3000 });
await page.fill('.command-palette input', 'dim_cust');
await page.keyboard.press('Enter');
// asserta seleção da tabela no canvas
await page.waitForSelector('.react-flow__node.selected', { timeout: 3000 });
// Reabrir e disparar uma ação de export, checar arquivo de saída
await page.keyboard.press('Control+KeyK');
await page.fill('.command-palette input', 'Exportar Oracle');
await page.keyboard.press('Enter');
// (verificar data/output/... conforme faz verify-colors-roundtrip.mjs)
```
(No editor DBML focado: clicar no editor, `Control+KeyK`, e asserar que o palette abre —
AC4.)

## Critérios de aceite

- AC1: `Cmd/Ctrl+K` abre com foco no input; `Escape`/clique-fora fecham.
- AC2: digitar `dim_cust` lista `gold.dim_customer`; `Enter` centra e seleciona a tabela
  (via `focusTableWithPan`).
- AC3: "Exportar Oracle DDL" pelo palette produz o mesmo efeito do menu Exportar
  (mesmo arquivo em `data/output/`).
- AC4: palette abre mesmo com o editor DBML focado (captura no `window` vence o
  CodeMirror; sem inserir "k" no texto).
- AC5: navegação 100% por teclado (abrir → filtrar → ↑/↓ → Enter) sem mouse.

## Fora de escopo

- Histórico de comandos recentes, fuzzy scoring avançado, ícones por comando (v18-08).
- Overlay de atalhos `?` (é a **v18-07**, que consome este registry).
