import { describe, expect, it } from 'vitest';
import { shouldPanToTable, shouldSyncCursorLine, shouldSyncEditorTable } from '../syncEditorCanvas';

describe('shouldSyncEditorTable', () => {
  it('não sincroniza na mesma tabela', () => {
    expect(shouldSyncEditorTable('silver.a', 'silver.a')).toBe(false);
  });

  it('sincroniza ao mudar de bloco Table', () => {
    expect(shouldSyncEditorTable('silver.a', 'silver.b')).toBe(true);
  });

  it('sincroniza quando ainda não havia tabela em edição', () => {
    expect(shouldSyncEditorTable(null, 'raw.orders')).toBe(true);
  });
});

describe('shouldPanToTable', () => {
  it('não faz pan na mesma tabela sem pan explícito', () => {
    expect(shouldPanToTable('silver.a', 'silver.a')).toBe(false);
  });

  it('faz pan ao mudar de tabela', () => {
    expect(shouldPanToTable('silver.a', 'silver.b')).toBe(true);
  });

  it('faz pan com flag pan explícita mesmo na mesma tabela', () => {
    expect(shouldPanToTable('silver.a', 'silver.a', { pan: true })).toBe(true);
  });

  it('faz pan na primeira tabela focada', () => {
    expect(shouldPanToTable(null, 'raw.orders')).toBe(true);
  });
});

describe('shouldSyncCursorLine', () => {
  it('não sincroniza antes de interação (linha sentinela -1)', () => {
    expect(shouldSyncCursorLine(-1)).toBe(false);
    expect(shouldSyncCursorLine(0)).toBe(true);
    expect(shouldSyncCursorLine(12)).toBe(true);
  });
});
