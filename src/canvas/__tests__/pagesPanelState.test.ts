import { describe, expect, it } from 'vitest';
import { parsePagesCollapsed } from '../LayersPanel';

describe('parsePagesCollapsed', () => {
  it('colapsado por default; respeita valor salvo', () => {
    expect(parsePagesCollapsed(null)).toBe(true);
    expect(parsePagesCollapsed('0')).toBe(false);
    expect(parsePagesCollapsed('1')).toBe(true);
  });
});
