# v18-03 — Toolbar: um indicador de estado + hierarquia + idioma

> **Para agentes executores (Sonnet/multi-agente):** contexto zero assumido. Tarefas na
> ordem, TDD (teste → falhar → implementar → passar). Gate final:
> `npm run typecheck && npm test` + `node scripts/verify-toolbar.mjs` com servidor em
> `:5192` (`npm run build` + `PORT=5192 NODE_ENV=production npx tsx server/index.ts`).

## Objetivo

Consolidar a direita da toolbar num **único** indicador de estado, mover Export PNG
para dentro do menu Exportar, unificar idioma (pt-BR) e reservar o destaque verde para
a ação primária real (Salvar com pendência).

## Contexto do código (âncoras verificadas em 2026-07-06)

A toolbar inteira é o `<header className="toolbar">` em **`src/App.tsx:1264-1329`**:

- `:1285-1287` — botão **Organize** com `className="btn-primary"` (verde hoje).
- `:1294` — `<ExportMenu options={api.EXPORT_OPTIONS} onExport={handleExportOption} />`.
- `:1295` — `<button onClick={handlePng}>Export PNG</button>` (botão avulso a remover).
- `:1297-1304` — botão **Salvar** com `className="btn-save"`, desabilitado quando
  `saveState` ∈ {saving, saved, idle}.
- `:1319` — `<StatusLog status={status} logs={logs} />` (dropdown de logs, v15-04) —
  mostra o texto de `status` (ex.: "Pronto", "Carregando…", mensagens de operação).
- `:1320-1328` — `<span className="savestate savestate--${saveState}">` com os textos
  `Salvando… / ⚠ Falha ao salvar / ● Não salvo / Salvo ✓`. **Este span é o segundo
  indicador — será fundido no StatusLog.**
- `saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'` (procurar
  `useState<'idle'` no App.tsx). `status: string` (`src/App.tsx:161`).
- `ExportMenu` (`src/ExportMenu.tsx`): já fecha com clique-fora e Escape; recebe
  `options: { id, label }[]` de `api.EXPORT_OPTIONS` (`src/api.ts`, procurar
  `EXPORT_OPTIONS`).
- Export PNG: `handlePng` usa `src/exportPng.ts` (download + POST `/api/export/png`).
- CSS: `.toolbar`, `.btn-primary`, `.btn-save`, `.savestate`, `.status-log__btn` em
  `src/styles.css` (grep pelos nomes).

## Tarefas

### Tarefa 1 — Fundir o `savestate` no StatusLog (indicador único)

**Arquivos:** `src/canvas/StatusLog.tsx`, `src/App.tsx:1319-1328`,
`src/canvas/__tests__/statusLabel.test.ts` (novo).

**Interface nova (produz):** `statusLabel(saveState, status): { text: string; cls: string }`
exportada de `StatusLog.tsx` — o texto único da direita da toolbar.

**Regras (testar todas):**
| saveState | texto exibido |
|---|---|
| `saving` | `Salvando…` |
| `error` | `⚠ Falha ao salvar` |
| `dirty` | `● Não salvo` |
| `saved`/`idle` + `status` transitório (≠ 'Pronto') | o `status` (ex.: "Import concluído") |
| `saved`/`idle` + status 'Pronto' | `Salvo ✓` |

`cls` = `savestate--${saveState}` (mantém as cores existentes do CSS).

**Passos:**
1. Teste da tabela acima em `statusLabel.test.ts` → falhar.
2. Implementar `statusLabel` e usar dentro do `StatusLog` (o botão-dropdown passa a
   exibir `statusLabel(...)` em vez do `status` cru); `StatusLog` ganha prop
   `saveState`.
3. Em `App.tsx`: passar `saveState` para `<StatusLog>`; **remover** o span
   `.savestate` (linhas 1320-1328). O histórico de logs (ring buffer) não muda.
4. Remover do `src/styles.css` só o que ficou órfão (o seletor `.savestate` continua
   usado pelo `cls`).

### Tarefa 2 — Export PNG entra no menu Exportar

**Arquivos:** `src/App.tsx:1294-1295`, `src/ExportMenu.tsx`.

**Passos:**
1. `ExportMenu` já é genérico (`options` + `onExport(id)`); adicionar em `App.tsx` a
   opção local `{ id: 'png', label: 'PNG do canvas' }` concatenada a
   `api.EXPORT_OPTIONS`, e no `handleExportOption` interceptar `id === 'png'` →
   chamar `handlePng()`.
2. Remover o botão avulso `Export PNG` (linha 1295).
3. Teste: se `handleExportOption` for função pura o suficiente, testar o roteamento
   `'png' → handlePng`; senão, cobrir só no headless (Tarefa 4).

### Tarefa 3 — Idioma e peso visual

**Arquivos:** `src/App.tsx:1285-1287`, `src/styles.css`.

1. Rótulo `Organize` → `Organizar`; remover `className="btn-primary"` dele.
2. `.btn-save` vira o único botão com destaque verde **quando habilitado** (ou seja,
   quando `saveState === 'dirty'`/`'error'`): em `styles.css`, mover o visual verde de
   `.btn-primary` para `.btn-save:not(:disabled)`. Não remover a classe `.btn-primary`
   do CSS se outros componentes a usarem (verificar com grep antes).
3. Varredura de strings da toolbar: nenhum texto em inglês além de nomes de formato
   ("Spark DDL", "dbt", "Mermaid" etc.).

### Tarefa 4 — Verificação headless

**Arquivo:** `scripts/verify-toolbar.mjs` (novo, boilerplate de `verify-render.mjs`).

```js
// 1) indicador único: nenhum .savestate solto na toolbar, StatusLog presente
if (await page.locator('header.toolbar > .savestate').count()) throw new Error('savestate duplicado');
// 2) botão Export PNG não existe; item no menu sim
if (await page.getByRole('button', { name: 'Export PNG' }).count()) throw new Error('botão PNG ainda existe');
await page.locator('.toolbar__export-trigger').click();
await page.getByRole('button', { name: 'PNG do canvas' }).waitFor({ timeout: 3000 });
// 3) rótulo Organizar
await page.getByRole('button', { name: 'Organizar' }).waitFor({ timeout: 3000 });
```

## Critérios de aceite

- AC1: a toolbar tem **um** elemento de status; os 4 estados de salvamento aparecem
  nele (editar → `● Não salvo`; salvar → `Salvando…` → `Salvo ✓`).
- AC2: "Exportar ▾ → PNG do canvas" gera o download e `data/output/.../diagram.png`
  como o botão antigo; o botão avulso não existe mais.
- AC3: toolbar 100% pt-BR (exceto nomes de formatos).
- AC4: Salvar é o único botão verde, e só quando há pendência.
- AC5: dropdown de logs (clicar no status) continua funcionando (regressão v15-04:
  `node scripts/verify-status-logs.mjs` verde).

## Fora de escopo

Ícones SVG e tooltips → **v18-08**. Command palette → **v18-06**.
