import { describe, expect, it } from 'vitest';
import type { Command } from '../../palette/registry';
import {
  CANVAS_GESTURES,
  FIXED_SHORTCUT_SPECS,
  formatShortcut,
  shortcutsFromCommands,
} from '../gestures';

describe('formatShortcut', () => {
  it('formata modificador no Mac sem separador', () => {
    expect(formatShortcut(true, { mod: true, key: 'S' })).toBe('⌘S');
    expect(formatShortcut(true, { mod: true, shift: true, key: 'Z' })).toBe('⌘⇧Z');
  });

  it('formata modificador fora do Mac com Ctrl+', () => {
    expect(formatShortcut(false, { mod: true, key: 'S' })).toBe('Ctrl+S');
    expect(formatShortcut(false, { mod: true, shift: true, key: 'Z' })).toBe('Ctrl+Shift+Z');
  });

  it('preserva teclas especiais sem modificador', () => {
    expect(formatShortcut(true, { key: 'Delete' })).toBe('Delete');
    expect(formatShortcut(false, { key: 'Escape' })).toBe('Escape');
    expect(formatShortcut(true, { key: '?' })).toBe('?');
  });
});

describe('shortcutsFromCommands', () => {
  const commands: Command[] = [
    {
      id: 'action:save',
      kind: 'action',
      label: 'Salvar',
      shortcut: 'Cmd/Ctrl+S',
      run: () => {},
    },
    {
      id: 'action:undo',
      kind: 'action',
      label: 'Undo',
      shortcut: 'Cmd/Ctrl+Z',
      run: () => {},
    },
    {
      id: 'action:organize',
      kind: 'action',
      label: 'Organizar DBML',
      run: () => {},
    },
    {
      id: 'table:gold.dim',
      kind: 'table',
      label: 'gold.dim',
      run: () => {},
    },
  ];

  it('inclui só comandos com shortcut do registry', () => {
    const rows = shortcutsFromCommands(commands, true);
    const registryLabels = rows
      .map((row) => row.label)
      .filter((label) => label === 'Salvar' || label === 'Undo');
    expect(registryLabels).toEqual(['Salvar', 'Undo']);
    expect(rows.some((row) => row.label === 'Organizar DBML')).toBe(false);
  });

  it('formata atalhos do registry por plataforma', () => {
    expect(shortcutsFromCommands(commands, true).find((row) => row.label === 'Salvar')?.keys).toBe('⌘S');
    expect(shortcutsFromCommands(commands, false).find((row) => row.label === 'Salvar')?.keys).toBe('Ctrl+S');
  });

  it('concatena atalhos fixos (Delete, Escape, ?, Cmd+K)', () => {
    const rows = shortcutsFromCommands([], true);
    const labels = rows.map((row) => row.label);
    for (const spec of FIXED_SHORTCUT_SPECS) {
      expect(labels).toContain(spec.label);
    }
    expect(rows.find((row) => row.label === 'Buscar comandos e tabelas')?.keys).toBe('⌘K');
    expect(shortcutsFromCommands([], false).find((row) => row.label === 'Buscar comandos e tabelas')?.keys).toBe(
      'Ctrl+K',
    );
  });
});

describe('CANVAS_GESTURES', () => {
  it('lista gestos curados do canvas', () => {
    expect(CANVAS_GESTURES.length).toBeGreaterThanOrEqual(6);
    const gestures = CANVAS_GESTURES.map((entry) => entry.gesture).join(' ');
    expect(gestures).toMatch(/hover/i);
    expect(gestures).toMatch(/arrastar/i);
    expect(gestures).toMatch(/coluna/i);
  });
});
