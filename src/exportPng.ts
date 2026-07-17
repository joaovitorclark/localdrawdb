// Exporta o diagrama como PNG.
//
// Usa uma bridge dentro do ReactFlowProvider (PngExportBridge em Canvas.tsx)
// que tem acesso ao `useReactFlow`. A bridge reposiciona a viewport com
// `setViewport` para enquadrar os nós-alvo, espera 2 frames para o ReactFlow
// pintar o novo transform, captura com `toPng`, e restaura a viewport.
//
// Por que não aplicar CSS transform no .react-flow__viewport:
// o viewport já tem o transform de pan/zoom do ReactFlow. Aplicar transform
// adicional destrói o layout (conteúdo colapsa num canto). A solução oficial
// do React Flow é usar `setViewport` + `toPng` — o que essa bridge faz.

export type PngScope = 'full' | 'selection';

/**
 * Captura o canvas como PNG via bridge. Resolve com dataURL ou rejeita com erro.
 * Retorna uma Promise<void> — a UI mostra feedback enquanto espera.
 */
export function captureDiagramPng(scope: PngScope = 'full'): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { dataUrl?: string; error?: string } | undefined;
      window.removeEventListener('ldb:pngResult', handler);
      if (detail?.error) reject(new Error(detail.error));
      else if (detail?.dataUrl) resolve(detail.dataUrl);
      else reject(new Error('PNG: resposta vazia da bridge'));
    };
    window.addEventListener('ldb:pngResult', handler, { once: true });
    window.dispatchEvent(new CustomEvent('ldb:requestPng', { detail: { scope } }));
    // Timeout de 15s para não ficar pendurado para sempre.
    setTimeout(() => {
      window.removeEventListener('ldb:pngResult', handler);
      reject(new Error('PNG: timeout (15s)'));
    }, 15000);
  });
}

/** Dispara o download do PNG no navegador. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}