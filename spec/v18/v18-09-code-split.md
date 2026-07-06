# v18-09 — Code-split: CodeMirror fora do chunk inicial

> **Para agentes executores (Sonnet/multi-agente):** contexto zero assumido. Este item é
> **empacotamento** (Vite/Rollup) — não há teste unit novo; o gate é *medição
> antes/depois* + scripts headless existentes verdes. **Meça primeiro, mude depois,
> meça de novo** e cole os dois números na PR. Não refatore lógica de app.

## Objetivo

`npm run build` avisa chunk > 500 kB. Tirar do caminho crítico do primeiro paint do
canvas o que não é necessário para ele: o editor (`@uiw/react-codemirror` +
`@codemirror/lang-sql`) é o maior candidato e o canvas não depende dele para renderizar.

## Contexto do código (âncoras verificadas em 2026-07-06)

- **Editor importado estaticamente:** `src/App.tsx:2`
  `import { Editor, type EditorHandle } from './editor/Editor';`. O editor vive na
  `section.pane--editor` (`App.tsx:1335-1338`), com largura persistida em
  `localStorage['ldb.editorWidth']` (`App.tsx:173-174` e gravação em `:194`).
- **`@dbml/core` está no cliente e no caminho crítico:** `src/dsl/parse.ts:2`
  `import { Parser } from '@dbml/core';` e `parseDbml()` (`parse.ts:137`) roda no load
  para montar o canvas. **Não** dá para lazy-load trivial sem afetar o primeiro render —
  medir o custo antes de decidir; provável que fique no chunk e seja **documentado**.
- **`node-sql-parser` é só do servidor:** usado em `server/sqlImport.ts` e
  `server/dbmlIo.ts` (grep confirma zero uso em `src/`). **Nada a fazer no cliente.**
- **Vite config atual:** `vite.config.ts:41-43` só tem `build: { outDir: 'dist' }` —
  sem `manualChunks`, sem visualizer.
- **Sem plugin de análise instalado:** `rollup-plugin-visualizer` **não** está no
  `package.json`. Adicionar como `devDependency` (dev-only) ou usar o sumário do próprio
  `vite build` (ele já lista os chunks e tamanhos no stdout).

## Tarefas

### Tarefa 1 — Medir o baseline

**Passos:**
1. `npm run build` e salvar o sumário (nomes de chunk + tamanhos + o warning de 500 kB)
   — é o "antes" da PR.
2. (Opcional, recomendado) `npm i -D rollup-plugin-visualizer` e adicionar dev-only ao
   `vite.config.ts` sob `process.env.ANALYZE`:
   ```ts
   plugins: [react(), ...(process.env.ANALYZE ? [visualizer({ filename: 'dist/stats.html', gzipSize: true })] : [])],
   ```
   Rodar `ANALYZE=1 npm run build` e abrir `dist/stats.html` para ver os maiores módulos.
   Registrar os 5 maiores na PR.

### Tarefa 2 — Editor via `React.lazy` + Suspense

**Arquivos:** `src/App.tsx`, `src/editor/Editor.tsx`.

**Cuidado com o `type EditorHandle` e o `ref`:** hoje `App.tsx:2` importa o **componente
e o tipo** juntos, e usa `editorRef` (`goToLine`/`goToColumn`, ex.: `App.tsx:634,639`).

**Passos:**
1. Garantir `export default` no `Editor` (ou usar o padrão `lazy(() => import('./editor/Editor').then(m => ({ default: m.Editor })))`).
2. Manter o **tipo** com import estático de tipo:
   `import type { EditorHandle } from './editor/Editor';` (imports de tipo são apagados
   no build, não puxam o módulo). O componente vira:
   `const Editor = lazy(() => import('./editor/Editor').then(m => ({ default: m.Editor })));`
3. Envolver o uso do `<Editor .../>` em `<Suspense fallback={<EditorSkeleton />}>`. O
   skeleton usa a **mesma largura persistida** (`ldb.editorWidth`) para não haver salto
   de layout (AC3).
4. Confirmar que `React.lazy` + `forwardRef`/`useImperativeHandle` do `EditorHandle`
   continuam funcionando (lazy repassa `ref` normalmente).

### Tarefa 3 — `manualChunks` para vendor estável

**Arquivos:** `vite.config.ts`.

Adicionar em `build`:
```ts
rollupOptions: {
  output: {
    manualChunks: {
      react: ['react', 'react-dom'],
      reactflow: ['reactflow'],
      // codemirror sai naturalmente no chunk lazy do Editor; não force aqui
    },
  },
},
```
Isolar `react`/`reactflow` melhora o cache entre deploys. **Não** force `@dbml/core`
para um chunk separado se ele estiver no caminho crítico (só pioraria o número de
requests do load).

### Tarefa 4 — Decidir `@dbml/core`

Com a medição em mãos: se `parseDbml` roda no primeiro paint (provável), **manter
`@dbml/core` no chunk** e documentar na PR o motivo (parse síncrono no load). Se a
medição mostrar que o parse pode ser adiado (ex.: canvas hidrata de `canvas.json` antes
de parsear), avaliar `import()` dinâmico no primeiro parse. Registrar a decisão.

### Tarefa 5 — Medir de novo + gate

1. `npm run build`: chunk inicial **< 500 kB** minificado (sem warning) **ou** meta
   documentada com o breakdown do que sobrou e por quê.
2. Gate funcional: `npm run typecheck && npm test` verdes.
3. Headless: `node scripts/verify-render.mjs` e `node scripts/verify-e2e.mjs` (se
   existir; `ls scripts/verify-*.mjs`) verdes — canvas interativo, editor aparece sem
   flash quebrado.
4. Comparar `domContentLoaded`/tempo até primeiro nó no headless antes/depois — não pode
   piorar (o editor sai do caminho crítico, deve melhorar ou empatar).

## Critérios de aceite

- AC1: `npm run build` sem warning de 500 kB (ou meta documentada na PR com breakdown).
- AC2: sem regressão funcional — `npm test`, typecheck, `verify-render.mjs` (e
  `verify-e2e.mjs` se houver) verdes.
- AC3: editor aparece após o load sem flash quebrado (skeleton com a largura
  persistida `ldb.editorWidth`); `goToLine`/`goToColumn` via `editorRef` seguem
  funcionando.
- AC4: tempo até canvas interativo não piora (medição headless antes/depois anexada).

## Fora de escopo

- Trocar de bundler, SSR, prefetch inteligente.
- Otimizar `@dbml/core`/`node-sql-parser` internamente.
- Sem unit novo (mudança de empacotamento); gate = scripts headless existentes + medição
  antes/depois anexada na PR.

## Decisão registrada — @dbml/core

- `@dbml/core` permanece no caminho crítico do client nesta etapa.
- Motivo: `parseDbml()` é chamado no load inicial para montar o modelo do canvas (tabelas,
  refs, páginas, validação e estado inicial). Adiar com `import()` nesse ponto adicionaria
  latência e estado de "warmup" antes do primeiro render útil.
- O ganho principal de v18-09 vem do split do editor (`@uiw/react-codemirror` + extensões),
  que não é necessário para o primeiro paint do canvas.
