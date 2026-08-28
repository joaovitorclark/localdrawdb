import { describe, expect, it } from 'vitest';
import { CONTROLBOARD_HTML } from '../controlboardUi.ts';

describe('CONTROLBOARD_HTML', () => {
  it('é uma página HTML autocontida que fala com /api/board/*', () => {
    expect(CONTROLBOARD_HTML).toContain('<html');
    expect(CONTROLBOARD_HTML).toContain('/api/board/domains');
    expect(CONTROLBOARD_HTML).toContain('/api/board/instances');
    expect(CONTROLBOARD_HTML).toContain('confirm(');
  });
});
