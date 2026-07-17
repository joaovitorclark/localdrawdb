// Exporta o diagrama (viewport do React Flow) como PNG via html-to-image.
import { toPng } from 'html-to-image';
import { getNodesBounds, getViewportForBounds } from 'reactflow';

type Scope = 'full' | 'selection';

/** Captura o `.react-flow__viewport` e devolve um dataURL PNG. */
export async function captureDiagramPng(scope: Scope = 'full'): Promise<string> {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  const wrapper = document.querySelector<HTMLElement>('.react-flow');
  if (!viewport || !wrapper) throw new Error('Canvas não encontrado');

  // Modo "selection": recorta para o bounding box das tabelas selecionadas.
  if (scope === 'selection') {
    const selectedNodes = Array.from(
      document.querySelectorAll<HTMLElement>('.react-flow__node.selected'),
    );
    if (selectedNodes.length === 0) {
      // Sem seleção: cai para o canvas inteiro para evitar PNG vazio.
      return captureDiagramPng('full');
    }
    // Pega o React Flow instance do wrapper (data attribute). Para recorte,
    // calculamos manualmente via DOM já que a lib expõe só via hook.
    const bounds = measureDomBounds(selectedNodes);
    const padding = 24;
    const width = Math.ceil(bounds.width + padding * 2);
    const height = Math.ceil(bounds.height + padding * 2);
    return toPng(viewport, {
      backgroundColor: '#ffffff',
      pixelRatio: 2,
      width,
      height,
      style: {
        // Translada o viewport para alinhar o bounds no canto.
        transform: `translate(${padding - bounds.left}px, ${padding - bounds.top}px)`,
        transformOrigin: 'top left',
      },
    });
  }

  // Modo "full": captura tudo (incluindo tabelas fora do viewport visível).
  return toPng(viewport, {
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    width: viewport.scrollWidth || undefined,
    height: viewport.scrollHeight || undefined,
  });
}

/** Soma de getBoundingClientRect de múltiplos elementos (em coords de viewport). */
function measureDomBounds(els: HTMLElement[]): { left: number; top: number; width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.left < minX) minX = r.left;
    if (r.top < minY) minY = r.top;
    if (r.right > maxX) maxX = r.right;
    if (r.bottom > maxY) maxY = r.bottom;
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/** Dispara o download do PNG no navegador. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// Re-export do helper da reactflow para uso futuro.
export { getNodesBounds, getViewportForBounds };
