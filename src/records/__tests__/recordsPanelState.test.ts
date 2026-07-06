import { describe, expect, it } from 'vitest';
import { parseRecordsOpen } from '../RecordsPanel';

describe('parseRecordsOpen', () => {
  it('fechado por default; aberto só quando persistido "1"', () => {
    expect(parseRecordsOpen(null)).toBe(false);
    expect(parseRecordsOpen('0')).toBe(false);
    expect(parseRecordsOpen('1')).toBe(true);
  });
});
