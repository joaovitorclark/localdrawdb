# v18-04 — Escala tipográfica em tokens + contraste mínimo

> **Para agentes executores (Sonnet/multi-agente):** contexto zero assumido. Este item
> é quase todo CSS mecânico — siga a tabela de mapeamento à risca, não "melhore" nada
> além do especificado. Gate final: `npm run typecheck && npm test` +
> `node scripts/check-colors.mjs` + screenshots headless antes/depois.

## Objetivo

Substituir os 8 tamanhos de fonte ad-hoc (9–16px) por 4 tokens, estabelecer piso de
11px e corrigir o contraste do texto secundário sobre fundos claros.

## Contexto do código (âncoras verificadas em 2026-07-06)

- `src/styles.css` (~2430 linhas) concentra todo o CSS. Distribuição atual de
  `font-size`: 40× `11px`, 20× `12px`, 16× `10px`, 11× `13px`, 4× `14px`, 3× `9px`,
  2× `15px`, 2× `16px`.
- Tokens existentes em `:root` (`src/styles.css:1-16`): `--brand-navy`,
  `--brand-green`, `--canvas-bg`, `--bg`, `--panel`, `--border`, `--text`,
  `--muted: #9fb0c9`, `--accent`, `--pk`.
- `--muted` é usado tanto sobre navy (toolbar/editor — ok) quanto sobre superfícies
  claras (painéis brancos e nós do canvas — contraste insuficiente, ~2.2:1 sobre
  branco).
- Script utilitário existente: `scripts/check-colors.mjs` (estender, não recriar).

## Tarefas

### Tarefa 1 — Tokens + mapeamento mecânico dos font-size

**Arquivo:** `src/styles.css`; teste `src/__tests__/typescale.test.ts` (novo).

1. Adicionar em `:root`:
   ```css
   --fs-xs: 11px;  /* metadados densos: tipos de coluna, badges */
   --fs-sm: 12px;  /* corpo de painéis, listas */
   --fs-md: 13px;  /* botões, inputs, dropdowns */
   --fs-lg: 15px;  /* títulos de painel, brand */
   ```
2. Substituição mecânica em `styles.css` (sed/replace-all é aceitável):
   | valor atual | novo |
   |---|---|
   | `font-size: 9px` / `10px` / `11px` | `font-size: var(--fs-xs)` |
   | `font-size: 12px` | `font-size: var(--fs-sm)` |
   | `font-size: 13px` / `14px` | `font-size: var(--fs-md)` |
   | `font-size: 15px` / `16px` | `font-size: var(--fs-lg)` |
   **Exceção:** regras dentro de seletores de nós do canvas (`.table-node*`,
   `.group-node*`, `.react-flow__*`) podem manter px literais, mas com piso de 10px
   (trocar 9px → 10px nesses casos).
3. Teste (lê o CSS como texto — padrão barato e estável):
   ```ts
   import { readFileSync } from 'node:fs';
   const css = readFileSync('src/styles.css', 'utf8');
   it('não há font-size menor que 10px', () => {
     const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
     expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
   });
   it('tokens de escala definidos', () => {
     for (const t of ['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg']) expect(css).toContain(t);
   });
   ```
4. Componentes com `fontSize` inline: `grep -rn 'fontSize' src --include='*.tsx'` —
   alinhar os que estiverem abaixo do piso (mesma exceção do canvas).

### Tarefa 2 — Token de contraste para superfícies claras

**Arquivos:** `src/styles.css`, `scripts/check-colors.mjs`.

1. Novo token: `--muted-on-light: #5a6b85;` em `:root`.
2. Identificar seletores que usam `var(--muted)` sobre fundo claro (painéis flutuantes
   do canvas, `.table-node` — conferir visualmente pelos screenshots) e trocá-los para
   `var(--muted-on-light)`. Toolbar/editor (fundo navy/escuro) continuam com
   `--muted`.
3. Estender `scripts/check-colors.mjs` com razão de contraste WCAG:
   ```js
   const lum = (hex) => { /* sRGB relative luminance */ };
   const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
   // pares exigidos (falhar com código 1 se < 4.5):
   assert(ratio('#5a6b85', '#ffffff') >= 4.5, 'muted-on-light × branco');
   assert(ratio('#9fb0c9', '#13284b') >= 4.5, 'muted × navy');
   ```
   (Implementar `lum` completo: c/255 → linearizar → 0.2126R+0.7152G+0.0722B.)
4. Tabela esmaecida ("Esmaecer em vez de esconder"): localizar a regra de opacidade
   (grep `dimmed\|esmaec\|opacity` em styles.css + TableNode) e garantir opacidade
   mínima `0.45`.

### Tarefa 3 — Screenshots de regressão visual

Script temporário (pode ficar no scratchpad, não commitar): capturar
`http://localhost:5192/` em 1680×950 e 1280×720 **antes** (via `git stash`) e
**depois**; anexar os 4 PNGs na PR. Sem overflow novo nos painéis (Camadas, Dados,
Coluna) — inspecionar visualmente.

## Critérios de aceite

- AC1: `typescale.test.ts` verde (piso 10px canvas / 11px UI via tokens; 4 tokens
  presentes).
- AC2: `node scripts/check-colors.mjs` verde com os pares de contraste ≥ 4.5:1.
- AC3: tipos de coluna (`string`, `timestamp`) legíveis nos nós — inclusive em tabela
  esmaecida (screenshot na PR).
- AC4: zero mudança de layout perceptível além do tamanho de fonte (comparar
  screenshots).

## Fora de escopo

Mudar família tipográfica, dark/light theming, redesign de painéis.
