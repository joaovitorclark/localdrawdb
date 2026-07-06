# v18-02 — Estado inicial limpo (sem seleção nem popups)

> **Para agentes executores (Sonnet/multi-agente):** esta spec assume contexto zero.
> Execute as tarefas **na ordem**; cada uma tem teste próprio. Ciclo por tarefa:
> escrever o teste → `npx vitest run <arquivo>` (ver FALHAR) → implementar → ver passar.
> Gate final do item: `npm run typecheck && npm test` (tudo verde) + script headless.
> Não altere nada fora dos arquivos listados.
>
> ⚠️ **Ambiente de teste (verificado):** o vitest deste repo roda em `node` (não há
> `jsdom`/`happy-dom` instalado nem `test.environment` em `vite.config.ts`). **Não existe
> `localStorage` nos testes.** Por isso os estados persistidos são desenhados como
> **função pura** que recebe a string crua (`parse...(raw, default)`) — testável sem DOM;
> o acesso a `localStorage` fica só no wrapper (coberto pelo headless). **Não** use
> `// @vitest-environment jsdom` (jsdom não está no `package.json`).

## Objetivo

Abrir o app deve mostrar um workspace neutro: canvas com o modelo, **nenhuma tabela
selecionada**, painéis transitórios fechados. Hoje (reproduzido em browser limpo, sem
localStorage) o app abre com a primeira tabela selecionada, o painel "Páginas no
canvas" expandido e o painel "Dados (amostra)" aberto.

## Contexto do código (âncoras verificadas em 2026-07-06)

- **Causa da seleção inicial (investigada — não re-investigar):** `src/App.tsx:679-681`
  tem `useEffect(() => { syncCanvasToEditorLine(editorCursorLineRef.current); },
  [tableIdsKey, syncCanvasToEditorLine])`. No mount, `editorCursorLineRef.current`
  é `0` (linha 1 do DBML = primeira tabela), então o sync editor→canvas roda sem o
  usuário ter tocado no editor e chama `focusTable` (`src/App.tsx:644`), que faz
  `useInteraction.getState().selectTable(tableId)` — a primeira tabela nasce
  selecionada e a `SelectionBar` (renderizada em `src/canvas/Canvas.tsx:503`) aparece.
- A seleção vive em `src/store/interaction.ts` (zustand, **sem** persistência — o
  problema não é storage).
- **PagesPanel** (`src/canvas/PagesPanel.tsx`): já tem colapso persistido
  (`localStorage`, linhas 17/41), mas o default sem chave salva é **expandido**
  (`loadCollapsed` retorna `false` quando não há chave).
- **RecordsPanel** (`src/records/RecordsPanel.tsx:67`): `const [open, setOpen] =
  useState(true)` — sempre aberto, sem persistência.
- Padrão de persistência do repo: `LayersPanel` (`src/canvas/LayersPanel.tsx:14-25`)
  usa `COLLAPSE_KEY = 'localdrawdb.layersPanelCollapsed'` com valores `'1'`/`'0'`.

## Tarefas

### Tarefa 1 — Sync editor→canvas não roda antes de interação do usuário

**Arquivos:** `src/App.tsx` (efeito das linhas 679-681), `src/editor/syncEditorCanvas.ts`
(helpers puros; teste em `src/editor/__tests__/syncEditorCanvas.test.ts`).

**Decisão:** o sync no mount só é legítimo depois que o usuário moveu o cursor no
editor. Introduzir um sentinela: `editorCursorLineRef` inicia em `-1` (nunca houve
cursor) e `syncCanvasToEditorLine` retorna cedo para `line0 < 0`. O callback do editor
(`handleEditorCursorLine`) continua passando linhas reais (≥ 0) — a primeira interação
habilita o sync.

**Passos:**
1. Teste novo em `src/editor/__tests__/syncEditorCanvas.test.ts` para um helper puro
   `shouldSyncCursorLine(line0: number): boolean` (novo, em `syncEditorCanvas.ts`):
   ```ts
   import { shouldSyncCursorLine } from '../syncEditorCanvas';
   it('não sincroniza antes de interação (linha sentinela -1)', () => {
     expect(shouldSyncCursorLine(-1)).toBe(false);
     expect(shouldSyncCursorLine(0)).toBe(true);
     expect(shouldSyncCursorLine(12)).toBe(true);
   });
   ```
2. Ver falhar; implementar `export const shouldSyncCursorLine = (line0: number) =>
   line0 >= 0;` em `src/editor/syncEditorCanvas.ts`.
3. Em `src/App.tsx`: inicializar `editorCursorLineRef = useRef(-1)` (procurar a
   declaração atual, que inicia em `0`) e, no começo de `syncCanvasToEditorLine`
   (linha ~657), adicionar `if (!shouldSyncCursorLine(line0)) return;`.
4. Gate da tarefa + conferir que os testes existentes de `syncEditorCanvas` continuam
   verdes.

### Tarefa 2 — RecordsPanel fecha por default e persiste

**Arquivos:** `src/records/RecordsPanel.tsx`; teste
`src/records/__tests__/recordsPanelState.test.ts` (novo).

**Passos:**
1. Extrair o **núcleo puro** (recebe a string crua — testável em node, sem DOM) e o
   wrapper de `localStorage`, exportados no próprio arquivo:
   ```ts
   export const RECORDS_OPEN_KEY = 'localdrawdb.recordsPanelOpen';
   // PURO (sem DOM): '1' → true; qualquer outra coisa (inclusive null) → false.
   export function parseRecordsOpen(raw: string | null): boolean {
     return raw === '1';
   }
   // Wrapper (não testado por unit; coberto pelo headless):
   export function loadRecordsOpen(): boolean {
     try { return parseRecordsOpen(localStorage.getItem(RECORDS_OPEN_KEY)); } catch { return false; }
   }
   ```
2. Teste **puro** (roda em `node`, sem `localStorage`):
   ```ts
   import { parseRecordsOpen } from '../RecordsPanel';
   it('fechado por default; aberto só quando persistido "1"', () => {
     expect(parseRecordsOpen(null)).toBe(false);
     expect(parseRecordsOpen('0')).toBe(false);
     expect(parseRecordsOpen('1')).toBe(true);
   });
   ```
3. Trocar `useState(true)` (linha 67) por `useState(loadRecordsOpen)` e gravar no
   toggle: `localStorage.setItem(RECORDS_OPEN_KEY, next ? '1' : '0')` (espelhar o
   padrão do PagesPanel linhas 30-45).

> Se a **v18-05** já foi feita antes desta tarefa, `RecordsPanel` já usa
> `useCollapsePersist('ldb.panel.records', true)` — nesse caso **não** crie
> `parseRecordsOpen`/`RECORDS_OPEN_KEY`; o default fechado já vem do hook. As duas specs
> convergem no mesmo comportamento; evite duplicar a persistência.

### Tarefa 3 — PagesPanel colapsado por default

**Arquivos:** `src/canvas/PagesPanel.tsx`; teste
`src/canvas/__tests__/pagesPanelState.test.ts` (novo).

**Passos:** igual à Tarefa 2, mas invertendo o default do `loadCollapsed` existente
(`PagesPanel.tsx:15-21`): sem chave salva → `true` (colapsado). Extrair o núcleo puro
`parsePagesCollapsed(raw: string | null): boolean` (`raw === '1' ? true : raw === '0' ?
false : true` — default colapsado) e testar os 3 casos em `node`:
```ts
import { parsePagesCollapsed } from '../PagesPanel';
it('colapsado por default; respeita valor salvo', () => {
  expect(parsePagesCollapsed(null)).toBe(true);   // default novo
  expect(parsePagesCollapsed('0')).toBe(false);   // quem expandiu antes continua expandido
  expect(parsePagesCollapsed('1')).toBe(true);
});
```
O wrapper `loadCollapsed()` passa a chamar `parsePagesCollapsed(localStorage.getItem(...))`.
Quem já tem preferência salva não muda de comportamento.

> Mesma ressalva da Tarefa 2: se a **v18-05** já rodou, o `PagesPanel` já usa
> `useCollapsePersist('ldb.panel.pages', true)` — não duplicar.

### Tarefa 4 — Verificação headless

**Arquivo:** `scripts/verify-initial-state.mjs` (novo — copiar o boilerplate de
`scripts/verify-render.mjs`: `playwright-core` + Chrome do sistema + servidor em
`:5192`).

Assertivas (contexto limpo, sem localStorage):
```js
await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.waitForSelector('.react-flow__node', { timeout: 15000 });
await page.waitForTimeout(800);
// 1) zero nós selecionados e sem barra de seleção
if (await page.locator('.react-flow__node.selected').count()) throw new Error('nó selecionado no load');
if (await page.locator('.selection-bar').count()) throw new Error('SelectionBar visível no load');
// 2) painéis transitórios fechados
if (await page.locator('.pages-panel:not(.is-collapsed)').count()) throw new Error('PagesPanel aberto');
if (await page.locator('.records-panel.is-open').count()) throw new Error('RecordsPanel aberto');
```
(Conferir os nomes reais das classes em `src/styles.css` antes de assertar —
`.selection-bar` deve ser validado com grep.)

## Critérios de aceite

- AC1: load em browser limpo → zero nós `selected`, `SelectionBar` ausente do DOM.
- AC2: clicar numa linha do editor DBML **depois** do load ainda seleciona/centra a
  tabela correspondente (o sync pós-interação não pode quebrar).
- AC3: PagesPanel e RecordsPanel iniciam fechados; abrir + recarregar → escolha persiste.
- AC4: selecionar tabela no canvas e recarregar → seleção não volta.

## Fora de escopo

Clique-fora para fechar popups e o mecanismo unificado de colapso → **v18-05**.
