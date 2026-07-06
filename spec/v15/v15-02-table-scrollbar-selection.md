# v15-02 — Scrollbar interno da tabela por seleção (não sumir / não sobrepor)

## Sintoma
A barra de scroll **dentro** da tabela (lista de colunas, tabelas com muitas colunas) fica
sumindo o tempo todo — difícil descer. Provável **sobreposição** com os handles de coluna
(`col-handle`) e/ou o overlay do scrollbar do SO.

## Objetivo / regra pedida
- Mostrar a barra de scroll quando a **tabela está selecionada** (aí dá pra rolar tranquilo).
- Quando um **campo está selecionado**, "afastar" pra liberar aquela área para **fazer ligações
  do campo** (arrastar handle). Ou outra abordagem mais viável que resolva sobreposição.

## Estado atual (código)
- `src/canvas/TableColumnList.tsx`: lista virtualizada quando `columns.length >
  COLUMN_VIRTUALIZE_THRESHOLD` (`scrollable`); container com `scrollRef`, altura `VIEW_H`
  (`COLUMN_VIRTUAL_VIEW_ROWS * COLUMN_VIRTUAL_ROW_H`), rows `col-row--scroll`. Handles de
  origem/destino (`.col-handle`) ficam nas bordas esquerda/direita de cada row.
- `src/canvas/scaleLimits.ts`: thresholds/altura da view virtual.
- Seleção: `useInteraction` (`selectedTableIds`, `selectedColumn`); nó `selected` via store.

## Abordagem
1. **Scrollbar visível na seleção:** por padrão, scrollbar fino/oculto (overlay). Quando o nó
   está `.selected` (tabela selecionada) → mostrar a scrollbar (largura reservada), estilizada,
   sem sobrepor o conteúdo/handles (padding-right no conteúdo pra dar espaço à barra).
2. **Não sobrepor os handles:** reservar uma canaleta à direita para a scrollbar **fora** da
   coluna dos `col-handle` de origem (`s:`/`fl:s:`). Garantir que a barra não caia por cima do
   handle direito (que serve pra puxar ligação).
3. **Campo selecionado → liberar área de ligação:** quando `selectedColumn` na tabela, recolher a
   scrollbar (ou movê-la) para não competir com o handle daquele campo, priorizando o arraste da
   ligação. (Alternativa viável: manter a barra, mas garantir que o handle tenha `z-index`/área
   maior que a barra.)
4. Windows: `scrollbar-width` reserva ~17px (barra permanente) — tratar com estilo consistente
   (mac overlay vs win permanente) para não "sumir/piscar".

## Arquivos
`src/canvas/TableColumnList.tsx` (classes por estado), `src/canvas/TableNode.tsx` (passar estado
de seleção pra lista, se preciso), `src/styles.css` (`.table-node__cols*`, `.col-row--scroll`,
scrollbar styling, `.col-handle`), possivelmente `src/canvas/scaleLimits.ts`.

## Critérios de aceite
- Tabela selecionada: scrollbar visível e estável (não pisca/some), dá pra rolar até o fim.
- Scrollbar não cobre os `col-handle` de ligação; com campo selecionado dá pra arrastar a ligação
  do handle sem a barra atrapalhar.
- Comportamento consistente mac/win.
- Verificação headless: tabela com muitas colunas, selecionar → barra presente; rolar até a última
  coluna; conferir que o handle direito continua clicável.

## Dificuldade
Média (CSS + estados de seleção + coordenação com handles). Base para o resize por altura (v15-01).
