# v15-01 — Resize diagonal/vertical da tabela (estilo macOS)

## Objetivo
Hoje a tabela só redimensiona **largura** (borda direita). Queremos:
- Redimensionar também **verticalmente**.
- Uma alça de **canto** que cresce a tabela **diagonalmente** (largura + altura juntas),
  com experiência parecida com redimensionar uma janela do macOS.
- **Cursor apropriado** (diagonal: `nwse-resize`).

> Nota de UX: o usuário citou "canto superior direito". O canto convencional para *crescer* uma
> janela (macOS) é o **inferior-direito** (`nwse-resize`, cresce pra baixo/direita). Proposta:
> alça de canto **inferior-direito** como primária (mais intuitiva pra "aumentar"); avaliar
> adicionar também **superior-direito** (`nesw-resize`) se desejado. Decidir na implementação/preview.

## Estado atual (código)
- `src/canvas/TableNode.tsx`: `<NodeResizeControl position="right" minWidth={200}
  onResizeEnd={(_, params) => actions.onResizeTable(data.id, params.width)} className="table-resize-handle" />`.
- `src/canvas/actions.ts`: `onResizeTable: (tableId, width) => void`.
- `src/styles.css:459` `.table-resize-handle` (`width:10px; height:32px; right:-5px; cursor:ew-resize`).
- Tamanho persistido: `sizes: Record<string, number>` (largura) em `canvas.json`
  (`src/api.ts:17`, `src/App.tsx:153` etc.). Aplicado como `style.width` no nó
  (`useCanvasNodes` → `sizes[t.id]`).

## Abordagem
1. **Modelo de tamanho:** trocar `sizes` de `Record<string, number>` para
   `Record<string, { width?: number; height?: number }>`. **Compat de carga:** ao ler
   `canvas.json`, se o valor for `number`, migrar para `{ width }`. Atualizar `src/api.ts`
   (`CanvasState.sizes`), `src/App.tsx` (load/save/deps) e `useCanvasNodes` (aplicar width+height).
2. **NodeResizeControl:** usar `position="bottom-right"` (canto) reportando `width` e `height`
   em `onResizeEnd`; `onResizeTable(id, width, height)`. `minWidth={200}`, `minHeight` = altura do
   header+alguns rows. Cursor `nwse-resize`.
3. **Altura aplicada:** quando `height` definido, o nó ganha altura fixa e a **lista de colunas
   deve rolar dentro** (ver v15-02 — scroll interno). Sem v15-02, altura fixa cortaria colunas.
   Por isso **depende de v15-02**.
4. Cursor/handle: ajustar `.table-resize-handle` (ou nova classe de canto) com `cursor: nwse-resize`
   e área de clique confortável (evitar sobrepor a alça de scroll — coordenar com v15-02).

## Arquivos
`src/canvas/TableNode.tsx`, `src/canvas/actions.ts`, `src/api.ts`, `src/App.tsx`,
`src/canvas/hooks/useCanvasNodes.ts`, `src/styles.css`.

## Critérios de aceite
- Arrastar o canto redimensiona largura **e** altura (diagonal), cursor `nwse-resize`.
- Tamanho (w/h) persiste em `canvas.json` e recarrega; formato antigo (number) migra sem erro.
- Altura fixa não corta colunas (com v15-02 o conteúdo rola).
- Verificação headless: resize → `getComputedStyle` width/height mudam; reload mantém.

## Dificuldade
Média. Acoplado ao v15-02 (scroll interno).
