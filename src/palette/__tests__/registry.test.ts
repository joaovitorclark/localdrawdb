import { describe, expect, it, vi } from 'vitest';
import { buildCommands, filterCommands, type Command } from '../registry';

describe('palette registry', () => {
  it('filtra tabelas por substring em partes do nome (case-insensitive)', () => {
    const commands = buildCommands({
      tables: [
        { id: 'gold.dim_customer' },
        { id: 'silver.fact_orders' },
      ],
      actions: [],
      onFocusTable: vi.fn(),
    });

    const results = filterCommands(commands, 'DIM_CUST');
    expect(results.map((command) => command.label)).toEqual(['gold.dim_customer']);
  });

  it('prioriza tabelas antes de ações quando ambos casam', () => {
    const base: Command[] = [
      {
        id: 'action:search',
        kind: 'action',
        label: 'Buscar tabela',
        run: vi.fn(),
      },
      {
        id: 'table:gold.buscar',
        kind: 'table',
        label: 'gold.buscar',
        run: vi.fn(),
      },
    ];

    const results = filterCommands(base, 'buscar');
    expect(results.map((command) => command.id)).toEqual([
      'table:gold.buscar',
      'action:search',
    ]);
  });

  it('respeita o limite máximo de resultados', () => {
    const commands = buildCommands({
      tables: Array.from({ length: 20 }, (_, idx) => ({ id: `gold.table_${idx}` })),
      actions: [],
      onFocusTable: vi.fn(),
    });

    const results = filterCommands(commands, 'table', 12);
    expect(results).toHaveLength(12);
  });
});
