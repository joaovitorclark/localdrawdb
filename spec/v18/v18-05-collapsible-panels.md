# v18-05 — Painéis colapsáveis com estado persistido

> **Para agentes executores (Sonnet/multi-agente):** esta spec assume contexto zero.
> Execute as tarefas **na ordem**; cada uma tem teste próprio. Ciclo por tarefa:
> escrever o teste → `npx vitest run <arquivo>` (ver FALHAR) → implementar → ver passar.
> Gate final do item: `npm run typecheck && npm test` (tudo verde) + `node scripts/verify-collapse.mjs`.
> Não altere nada fora dos arquivos listados.
>
> ⚠️ **Ambiente de teste (verificado):** o vitest deste repo roda em `node`
> (não há `jsdom`/`happy-dom` instalado nem `test.environment` configurado em
> `vite.config.ts`). **Não existe `localStorage` nos testes.** Por isso o mecanismo de
> colapso é desenhado como **função pura** (`parseCollapsed(raw, default)`) que recebe a
> string crua e é testável sem DOM; o acesso a `localStorage` fica só no hook (não
> testado por unit, coberto pelo headless). Não use `// @vitest-environment jsdom`
> (jsdom não está no `package.json`).

## Objetivo

Em 1280×720 os painéis fixos (Camadas à direita, Dados embaixo, Páginas no dock
esquerdo) deixam ~30% do canvas visível. Todo painel deve ser colapsável a uma forma
mínima, com o estado persistido, devolvendo o canvas ao usuário. Esta spec entrega o
**mecanismo único** de colapso; os *defaults* de estado inicial vêm da **v18-02**.

Depende de **v18-02** (defaults do estado inicial já definidos lá).

## Contexto do código (âncoras verificadas em 2026-07-06)

- **LayersPanel** (`src/canvas/LayersPanel.tsx`): já é o padrão de referência —
  `COLLAPSE_KEY = 'localdrawdb.layersPanelCollapsed'` (linha 14), `loadCollapsed()`
  (16-22), `useState(loadCollapsed)` (25), `toggleCollapsed()` grava `'1'`/`'0'`
  (47-57), classe `layers-panel is-collapsed` (60), botão de colapso (61-68). Tem
  também estado interno **filtro de tabelas** `tableQuery` (`useState('')`, linha 26) —
  é o estado que o AC3 exige preservar.
- **PagesPanel** (`src/canvas/PagesPanel.tsx`): mesmo padrão —
  `COLLAPSE_KEY = 'localdrawdb.pagesPanelCollapsed'` (13), `loadCollapsed` (15-21),
  `useState(loadCollapsed)` (30), `toggleCollapsed` (37-47), classe
  `pages-panel is-collapsed` (65). **Retorna `null`** se não há páginas selecionáveis
  (linha 35) — não confundir "ausente" com "colapsado" no headless.
- **RecordsPanel** (`src/records/RecordsPanel.tsx`): `const [open, setOpen] =
  useState(true)` (linha 67) — **sem persistência**; classe `records-panel is-open`
  (146); botão-toggle (147-149). Também retorna `null` quando não há tabela/grupo
  selecionado (127-128). A v18-02 troca o default para fechado; aqui ele adota o hook.
- **ProblemsPanel** (`src/canvas/ProblemsPanel.tsx`): é um **badge + popover transitório
  via portal** (v15-03); já fecha com clique-fora (22-32). Popover transitório **não**
  deve persistir aberto — fica **fora de escopo** de persistência (ver "Fora de escopo").
- **Padrão de hook com localStorage já existente:** `useDraggablePanel`
  (`src/canvas/useDraggablePanel.ts:5-25`) — leitura no init + `useEffect` que grava.
- Render dos painéis no `App.tsx`: `PagesPanel` dentro de `CanvasLeftDock` (linhas
  1406-1412), `LayersPanel` à direita (1457-1463), `RecordsPanel` no rodapé (1465-1475).

## Tarefas

### Tarefa 1 — Hook `useCollapsePersist` com núcleo puro testável

**Arquivos:** `src/hooks/useCollapsePersist.ts` (novo); teste
`src/hooks/__tests__/useCollapsePersist.test.ts` (novo).

**Interface (produz):**
```ts
// Núcleo PURO (testável em node, sem DOM):
export function parseCollapsed(raw: string | null, defaultCollapsed: boolean): boolean;
// Wrapper com localStorage (não testado por unit):
export function readCollapsed(key: string, defaultCollapsed: boolean): boolean;
export function writeCollapsed(key: string, collapsed: boolean): void;
// Hook React:
export function useCollapsePersist(
  key: string,
  defaultCollapsed: boolean,
): readonly [boolean, () => void];
```

**Regras de `parseCollapsed`:** `'1'` → `true`; `'0'` → `false`; `null`/qualquer outra
→ `defaultCollapsed`. (Preserva quem já tem preferência salva e respeita o default novo
para quem não tem.)

**Passos:**
1. Teste (puro, roda em node):
   ```ts
   import { parseCollapsed } from '../useCollapsePersist';
   it('parseCollapsed respeita valor salvo e cai no default', () => {
     expect(parseCollapsed('1', false)).toBe(true);
     expect(parseCollapsed('0', true)).toBe(false);
     expect(parseCollapsed(null, true)).toBe(true);
     expect(parseCollapsed(null, false)).toBe(false);
     expect(parseCollapsed('lixo', true)).toBe(true);
   });
   ```
2. Ver falhar; implementar. `readCollapsed` = `try { parseCollapsed(localStorage.getItem(key), d) } catch { return d }`.
   `writeCollapsed` = `try { localStorage.setItem(key, collapsed ? '1' : '0') } catch {}`.
   `useCollapsePersist` = `useState(() => readCollapsed(key, default))` + `toggle` que
   inverte e chama `writeCollapsed`.
3. Convenção de chaves: `ldb.panel.<nome>` → `ldb.panel.layers`, `ldb.panel.pages`,
   `ldb.panel.records`.

### Tarefa 2 — RecordsPanel adota o hook (com o default fechado da v18-02)

**Arquivos:** `src/records/RecordsPanel.tsx`.

**Passos:**
1. Substituir `const [open, setOpen] = useState(true)` (linha 67) por:
   ```ts
   const [collapsed, toggleCollapsed] = useCollapsePersist('ldb.panel.records', true);
   const open = !collapsed;
   ```
   (Se a v18-02 já introduziu `loadRecordsOpen`/`RECORDS_OPEN_KEY`, **remover** e migrar
   para o hook — o hook passa a ser a única fonte. Manter o default fechado.)
2. Trocar `onClick={() => setOpen((o) => !o)}` (linha 147) por `onClick={toggleCollapsed}`.
3. Não mudar as condições de `return null` (127-128) — "sem seleção" continua ocultando.

### Tarefa 3 — LayersPanel migra para o hook (com fallback da chave antiga)

**Arquivos:** `src/canvas/LayersPanel.tsx`; teste
`src/hooks/__tests__/useCollapsePersist.test.ts` (estender com o caso de migração).

**Passos:**
1. Adicionar ao hook um leitor com fallback de chave legada (função pura testável):
   ```ts
   export function readCollapsedWithLegacy(
     key: string, legacyKey: string, defaultCollapsed: boolean,
   ): boolean; // lê `key`; se ausente, tenta `legacyKey`; senão default
   ```
   Teste puro do fan-in de chaves (simular com um objeto `{ get(k) }` injetável, ou
   testar só a lógica de precedência com valores crus).
2. Em `LayersPanel`: remover `COLLAPSE_KEY`/`loadCollapsed`/`toggleCollapsed` locais
   (14-57) e usar `useCollapsePersist('ldb.panel.layers', false)`, migrando a leitura
   inicial via `readCollapsedWithLegacy('ldb.panel.layers',
   'localdrawdb.layersPanelCollapsed', false)`. **Default do Layers permanece expandido
   (`false`)** — ele é o índice principal do canvas.
3. **Não** mexer no `tableQuery` (linha 26) — ele fica no componente, garantindo o AC3.

### Tarefa 4 — PagesPanel adota o hook

**Arquivos:** `src/canvas/PagesPanel.tsx`.

**Passos:** igual à Tarefa 3, mas o default de Pages é **colapsado (`true`)** conforme
v18-02. `useCollapsePersist('ldb.panel.pages', true)` com
`readCollapsedWithLegacy('ldb.panel.pages', 'localdrawdb.pagesPanelCollapsed', true)`.
Manter o `return null` da linha 35 (sem páginas → some).

### Tarefa 5 — CSS dos estados colapsados (pílula/barra)

**Arquivos:** `src/styles.css`.

Garantir que colapsado devolva o canvas: `layers-panel.is-collapsed`,
`pages-panel.is-collapsed` viram pílula compacta (só o botão de colapso visível);
`records-panel:not(.is-open)` vira barra fina (~28-32px) com o título/contagem.
Conferir os seletores existentes (grep `is-collapsed`, `records-panel` em `styles.css`)
e só ajustar largura/altura mínimas — **não** redesenhar. Regra de ouro: colapsado não
pode sobrepor uma área maior que o próprio botão/barra.

### Tarefa 6 — Verificação headless

**Arquivo:** `scripts/verify-collapse.mjs` (novo — boilerplate de
`scripts/verify-render.mjs`: `playwright-core` + Chrome do sistema + servidor em `:5192`).

Roteiro:
```js
await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.waitForSelector('.react-flow__node', { timeout: 15000 });
// abrir os painéis para depois colapsar (defaults da v18-02 = fechados)
// 1) LayersPanel: colapsa por clique no header e mede área
const layersBtn = page.locator('.layers-panel__collapse');
await layersBtn.click();
// 2) medir % do viewport livre com todos colapsados
const vw = await page.evaluate(() => innerWidth * innerHeight);
const panelsArea = await page.evaluate(() => {
  const els = document.querySelectorAll('.layers-panel, .pages-panel, .records-panel');
  return [...els].reduce((s, el) => { const r = el.getBoundingClientRect(); return s + r.width * r.height; }, 0);
});
if (panelsArea / vw > 0.20) throw new Error('painéis colapsados ocupam >20% do viewport');
// 3) filtro do LayersPanel sobrevive a colapsar/expandir
await layersBtn.click(); // expande
await page.fill('.layers-panel__search', 'dim');
await layersBtn.click(); await layersBtn.click(); // colapsa e expande
if (await page.inputValue('.layers-panel__search') !== 'dim') throw new Error('filtro perdido no colapso');
// 4) persistência: reload preserva colapso do Layers
await layersBtn.click(); // colapsa
await page.reload({ waitUntil: 'networkidle' });
if (!(await page.locator('.layers-panel.is-collapsed').count())) throw new Error('colapso não persistiu');
```
(Rodar em 1280×720: `context = await browser.newContext({ viewport: { width: 1280, height: 720 } })`.)

## Critérios de aceite

- AC1: cada painel (Camadas, Páginas, Dados) colapsa/expande por clique no header; o
  estado sobrevive a reload (`localStorage` `ldb.panel.*`).
- AC2: com todos colapsados em 1280×720, os painéis ocupam ≤ 20% do viewport (canvas
  ≥ 80% livre) — medido pelos bounding boxes no headless.
- AC3: filtro digitado no `LayersPanel` (`tableQuery`) permanece após colapsar/expandir.
- AC4: quem já tinha `localdrawdb.layersPanelCollapsed`/`localdrawdb.pagesPanelCollapsed`
  salvo mantém o comportamento (migração via `readCollapsedWithLegacy`).
- AC5: sem regressão nos scripts headless existentes de painéis
  (`node scripts/verify-problems-badge.mjs`, `node scripts/verify-records.mjs` se
  existirem — conferir com `ls scripts/verify-*.mjs`).

## Fora de escopo

- `ProblemsPanel`: continua como badge + popover transitório (v15-03); **não** persiste
  aberto/fechado.
- Redesenho visual dos painéis, animações de colapso, e novos painéis.
