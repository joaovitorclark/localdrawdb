import { describe, expect, it } from 'vitest';
import { computeVirtualWindow } from '../hooks/useVirtualWindow';

describe('computeVirtualWindow', () => {
  it('retorna range vazio para lista vazia', () => {
    const r = computeVirtualWindow({ totalItems: 0, itemHeight: 20, viewportHeight: 200, scrollTop: 0, overscan: 3 });
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(0);
    expect(r.totalHeight).toBe(0);
  });

  it('calcula start/end baseado em scrollTop e viewportHeight', () => {
    const r = computeVirtualWindow({ totalItems: 1000, itemHeight: 24, viewportHeight: 200, scrollTop: 0, overscan: 3 });
    // visíveis = ceil(200/24) = 9; + overscan 3 = 12
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(12);
    expect(r.totalHeight).toBe(1000 * 24);
  });

  it('avança start quando scrollTop cresce', () => {
    const r = computeVirtualWindow({ totalItems: 1000, itemHeight: 24, viewportHeight: 200, scrollTop: 240, overscan: 3 });
    // visíveis a partir de 10, + overscan 3 = começa em 7
    expect(r.startIndex).toBe(7);
  });

  it('clamp no final: endIndex não passa de totalItems', () => {
    const r = computeVirtualWindow({ totalItems: 12, itemHeight: 24, viewportHeight: 200, scrollTop: 0, overscan: 100 });
    expect(r.endIndex).toBe(12);
  });
});