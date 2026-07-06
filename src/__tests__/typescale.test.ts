import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync('src/styles.css', 'utf8');

describe('typescale tokens', () => {
  it('não há font-size menor que 10px', () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
  });

  it('tokens de escala definidos', () => {
    for (const t of ['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg']) {
      expect(css).toContain(t);
    }
  });
});
