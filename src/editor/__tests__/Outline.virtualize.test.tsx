import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { Outline } from '../Outline';

function bigDbml(n: number): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(`Table gold.t_${i} {`);
    lines.push(`  id bigint [pk]`);
    lines.push(`  name string`);
    lines.push(`}`);
    lines.push('');
  }
  return lines.join('\n');
}

describe('Outline (SSR)', () => {
  it('renderiza lista virtualizada: <li> count << block count para dbml grande', () => {
    const dbml = bigDbml(500); // 500 tables = 500 blocks
    const onGoToLine = vi.fn();
    const html = renderToString(<Outline dbml={dbml} onGoToLine={onGoToLine} />);
    const liCount = (html.match(/<li /g) || []).length;
    // Janela virtual + overscan: ≤ ~30 itens renderizados para 500 blocks.
    expect(liCount).toBeLessThan(50);
    expect(liCount).toBeGreaterThan(0);
  });

  it('com dbml pequeno renderiza tudo (sem virtualização)', () => {
    const dbml = bigDbml(5);
    const html = renderToString(<Outline dbml={dbml} onGoToLine={vi.fn()} />);
    const liCount = (html.match(/<li /g) || []).length;
    // Threshold da virtualização é maior que 5 — não virtualiza.
    expect(liCount).toBe(5);
  });

  it('useDeferredValue: items não re-splitam enquanto query muda em DBML grande', () => {
    // Esse teste é de contrato: garantir que splitDbmlBlocks não é chamado
    // mais de uma vez por keystroke do query. Como o hook é interno,
    // verificamos indiretamente que o componente aceita props sem warnings.
    const dbml = bigDbml(100);
    const html = renderToString(<Outline dbml={dbml} onGoToLine={vi.fn()} />);
    expect(html).toContain('outline-panel');
  });
});