# v18-04 — Escala tipográfica em tokens + contraste mínimo

## Objetivo

O CSS usa 8 tamanhos de fonte entre 9px e 16px (moda em 10–11px, ocorrências de 9px) sem
escala definida, e rótulos `--muted` (#9fb0c9) sobre fundo claro ficam abaixo de
contraste confortável (tipos `string`/`timestamp` nas tabelas; ilegível em tabelas
esmaecidas). Definir uma escala em variáveis CSS e um piso de legibilidade.

## Decisão

1. **Tokens em `:root`** (`src/styles.css`):
   ```css
   --fs-xs: 11px;   /* metadados densos: tipos de coluna, badges */
   --fs-sm: 12px;   /* corpo de painéis, itens de lista */
   --fs-md: 13px;   /* botões, inputs, dropdowns */
   --fs-lg: 15px;   /* títulos de painel, brand */
   ```
   Piso: **11px**. Ocorrências de 9px e 10px migram para `--fs-xs`; 12→`--fs-sm`,
   13/14→`--fs-md`, 15/16→`--fs-lg`. Exceção permitida: texto **dentro do canvas**
   (nós React Flow) escala com o zoom e pode manter px próprios, mas nunca < 10px no
   zoom 1.
2. **Contraste**: novo token `--muted-on-light: #5a6b85` para texto secundário sobre
   superfícies claras (painéis brancos, nós do canvas); `--muted` atual continua para
   superfícies escuras (toolbar/editor). Meta: ≥ 4.5:1 nos dois casos (verificável com
   o validador do script `scripts/check-colors.mjs`, estendendo-o se preciso).
3. Tabela esmaecida ("Esmaecer em vez de esconder"): opacidade mínima que mantenha o
   nome da tabela legível (ex.: `opacity: 0.45` em vez do valor atual, ajustar
   empiricamente no headless).

## Arquivos

- `src/styles.css` — tokens + substituição mecânica dos `font-size` (sem mudança de
  layout intencional além do piso).
- `src/canvas/TableNode.tsx` (se houver px inline) — alinhar aos tokens.
- `scripts/check-colors.mjs` — checagem de contraste dos pares (muted × painel claro,
  muted × navy).

## Critérios de aceite

- AC1: `grep -o 'font-size: *[0-9]*px' src/styles.css` só retorna valores ≥ 11px, e
  todo novo uso referencia `var(--fs-*)` (guard no teste abaixo).
- AC2: par `--muted-on-light` × branco e `--muted` × `--brand-navy` ≥ 4.5:1.
- AC3: visual sem quebra: painéis Camadas/Dados/Coluna e toolbar renderizam sem
  overflow novo em 1680×950 e 1280×720 (comparação por screenshot headless).

## Testes (TDD)

- `src/__tests__/typescale.test.ts`: lê `styles.css`, asserta ausência de
  `font-size` < 11px e presença dos 4 tokens.
- `scripts/check-colors.mjs` estendido: função de razão de contraste + pares exigidos;
  falha com par < 4.5.
- Headless: screenshots antes/depois em 2 resoluções para revisão manual (anexar na PR).
