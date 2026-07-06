import { describe, expect, it } from 'vitest';
import { statusLabel } from '../StatusLog';

describe('statusLabel', () => {
  it('saving → Salvando…', () => {
    expect(statusLabel('saving', 'Pronto')).toEqual({
      text: 'Salvando…',
      cls: 'savestate--saving',
      icon: null,
    });
  });

  it('error → Falha ao salvar', () => {
    expect(statusLabel('error', 'Pronto')).toEqual({
      text: 'Falha ao salvar',
      cls: 'savestate--error',
      icon: 'warning',
    });
  });

  it('dirty → Não salvo', () => {
    expect(statusLabel('dirty', 'Pronto')).toEqual({
      text: 'Não salvo',
      cls: 'savestate--dirty',
      icon: 'dot',
    });
  });

  it('saved/idle + status transitório → exibe status', () => {
    expect(statusLabel('saved', 'Import concluído')).toEqual({
      text: 'Import concluído',
      cls: 'savestate--saved',
      icon: null,
    });
    expect(statusLabel('idle', 'Carregando…')).toEqual({
      text: 'Carregando…',
      cls: 'savestate--idle',
      icon: null,
    });
  });

  it("saved/idle + status 'Pronto' → Salvo", () => {
    expect(statusLabel('saved', 'Pronto')).toEqual({
      text: 'Salvo',
      cls: 'savestate--saved',
      icon: 'check',
    });
    expect(statusLabel('idle', 'Pronto')).toEqual({
      text: 'Salvo',
      cls: 'savestate--idle',
      icon: 'check',
    });
  });
});
