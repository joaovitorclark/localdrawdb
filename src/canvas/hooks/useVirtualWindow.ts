/**
 * Cálculo puro de janela virtual — sem deps externas. Recebe o estado de
 * scroll + tamanho da viewport e devolve o range [startIndex, endIndex) de
 * itens que devem ser renderizados, mais a altura total do scroll.
 *
 * O número visível é ceil(viewportHeight / itemHeight). Aplicamos `overscan`
 * (linhas extras antes e depois) para que o scroll não mostre buracos nas
 * bordas quando o usuário rola rápido.
 *
 * Para tabelas com 200 colunas num canvas de 100 tabelas, isso reduz o
 * trabalho de render de 20.000 ColumnRowContent para ~20 por tabela.
 */
export type VirtualWindowInput = {
  totalItems: number;
  itemHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan: number;
};

export type VirtualWindow = {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  /** Offset (em px) do primeiro item visível, relativo ao topo da lista. */
  offsetY: number;
};

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const { totalItems, itemHeight, viewportHeight, scrollTop, overscan } = input;
  if (totalItems <= 0 || itemHeight <= 0) {
    return { startIndex: 0, endIndex: 0, totalHeight: 0, offsetY: 0 };
  }
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / itemHeight));
  const firstVisible = Math.max(0, Math.floor(scrollTop / itemHeight));
  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(totalItems, firstVisible + visibleCount + overscan);
  return {
    startIndex,
    endIndex,
    totalHeight: totalItems * itemHeight,
    offsetY: startIndex * itemHeight,
  };
}
