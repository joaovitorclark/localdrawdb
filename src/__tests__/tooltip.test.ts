import { describe, expect, it } from 'vitest';
import { pickTooltipSide } from '../Tooltip';

describe('pickTooltipSide', () => {
  it('usa top quando há espaço acima', () => {
    expect(pickTooltipSide(80, 24, 8)).toBe('top');
  });

  it('usa bottom quando a âncora está colada no topo', () => {
    expect(pickTooltipSide(20, 24, 8)).toBe('bottom');
  });

  it('usa bottom quando o tooltip não cabe acima', () => {
    expect(pickTooltipSide(30, 24, 8)).toBe('bottom');
  });
});
