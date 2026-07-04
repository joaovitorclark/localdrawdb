# v15-06 — Fundo preto em resolução pequena → cor do canvas (disfarçar)

## Sintoma
Em telas de resolução pequena aparece uma faixa/área **preta** ao redor do conteúdo
(imagem do report). É o fundo escuro do app (`--bg: #0f1419`) aparecendo quando o layout
não cobre a viewport inteira (ou em overscroll/rubber-band).

## Objetivo
Fazer essa área preta ter a **cor do fundo do canvas** (`--canvas-bg: #eef2f8`) para
"disfarçar" e dar a impressão de que o canvas continua. Se viável, estender também o
**padrão de pontos** (dot grid) do canvas para a área, reforçando a continuidade.

## Estado atual (código)
- `src/styles.css`: `--bg: #0f1419` (escuro), `--canvas-bg: #eef2f8` (claro).
- `html, body, #root` usam `--bg` como fundo; `overscroll-behavior: none/contain` já aplicado
  (fix "faixa preta" do v13).
- O canvas (reactflow) desenha o dot grid via `<Background>` do reactflow dentro de `.pane--canvas`.

## Abordagem
1. **Trocar o fundo revelável** de `--bg` para `--canvas-bg` nos elementos que podem aparecer
   atrás do conteúdo (`html, body, #root`, e o container do canvas). Assim o "preto" vira a cor
   clara do canvas.
2. **Continuidade do grid (se viável):** aplicar um `background-image` de dot grid (radial-gradient)
   na cor/escala do reactflow `<Background>` no `body`/root, alinhado ao padrão do canvas. Avaliar
   custo de alinhamento (o grid do reactflow move com o pan/zoom; o do body é fixo) — se o
   alinhamento perfeito for caro, entregar só a cor sólida `--canvas-bg` (já resolve o "disfarce").
3. Verificar que o **editor** (dark) e o **topo** (navy) não são afetados — eles têm fundo próprio.

## Arquivos
`src/styles.css` (variáveis/backgrounds de `html,body,#root` e wrappers), possivelmente
`src/canvas/Canvas.tsx` se precisar ler a cor do `<Background>`.

## Critérios de aceite
- Em viewport pequena, a área antes preta fica `--canvas-bg` (rgb 238,242,248), sem preto.
- Editor e barra superior mantêm suas cores.
- (Opcional) dot grid contínuo; se não, cor sólida aceita.
- Verificação headless: viewport reduzida, checar `getComputedStyle(body).backgroundColor`.

## Dificuldade
Baixa (cor sólida). Média se incluir o grid alinhado — tratar como stretch goal.
