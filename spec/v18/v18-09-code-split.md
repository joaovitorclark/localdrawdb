# v18-09 — Code-split: CodeMirror e parsers fora do chunk inicial

## Objetivo

`npm run build` avisa chunk > 500 kB. Os maiores candidatos são o editor
(@uiw/react-codemirror + @codemirror/lang-sql), o parser DBML (@dbml/core) e
node-sql-parser — nem tudo precisa estar no caminho crítico do primeiro paint do canvas.

## Decisão

1. **Medir primeiro**: `vite build` com `rollup-plugin-visualizer` (dev-only) ou
   `--profile` para mapear os maiores módulos do chunk. Registrar o antes na PR.
2. **Editor lazy**: `React.lazy(() => import('./editor/Editor'))` em `App.tsx` com
   fallback leve (skeleton do painel esquerdo). O editor é grande e o canvas não
   depende dele para o primeiro render.
3. **node-sql-parser**: usado só no fluxo de import — garantir `import()` dinâmico no
   ponto de uso (é dependência de servidor? se só o server usa, nada a fazer no client;
   confirmar na medição).
4. **@dbml/core**: se estiver no client (parse/validação), avaliar dynamic import no
   primeiro parse; se o custo de UX for ruim (parse acontece já no load), aceitar no
   chunk e documentar.
5. **manualChunks** para vendor estável (react, reactflow) — melhora cache entre
   deploys.
6. Meta: chunk inicial < 500 kB minificado **ou** justificativa documentada do que
   sobrou e por quê.

## Arquivos

- `src/App.tsx` — lazy do Editor + Suspense.
- `vite.config.ts` — manualChunks, visualizer dev-only.

## Critérios de aceite

- AC1: build sem warning de 500 kB (ou meta documentada na PR com o breakdown).
- AC2: nenhuma regressão funcional: `npm test`, typecheck e `verify-render.mjs`,
  `verify-e2e.mjs` verdes.
- AC3: editor aparece após load sem flash quebrado (skeleton com a mesma largura
  persistida `ldb.editorWidth`).
- AC4: tempo até canvas interativo não piora (comparar `domContentLoaded`/first render
  no script headless antes/depois).

## Testes

- Sem unit novo (mudança de empacotamento); gate = scripts headless existentes + medição
  antes/depois anexada na PR.

## Decisão registrada — @dbml/core

- `@dbml/core` permanece no caminho crítico do client nesta etapa.
- Motivo: `parseDbml()` é chamado no load inicial para montar o modelo do canvas (tabelas,
  refs, páginas, validação e estado inicial). Adiar com `import()` nesse ponto adicionaria
  latência e estado de "warmup" antes do primeiro render útil.
- O ganho principal de v18-09 vem do split do editor (`@uiw/react-codemirror` + extensões),
  que não é necessário para o primeiro paint do canvas.
