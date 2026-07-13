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

  it('busca colunas por substring em qualquer parte do nome', () => {
    const commands = buildCommands({
      tables: [
        { id: 'gold.dim_product' },
        { id: 'silver.fact_orders' },
      ],
      columns: [
        { tableId: 'gold.dim_product', columnName: 'customer_id' },
        { tableId: 'gold.dim_product', columnName: 'created_at' },
        { tableId: 'silver.fact_orders', columnName: 'customer_id' },
      ],
      actions: [],
      onFocusTable: vi.fn(),
      onFocusColumn: vi.fn(),
    });

    const results = filterCommands(commands, 'cust', 12);
    expect(results.map((command) => command.id)).toEqual([
      'column:gold.dim_product.customer_id',
      'column:silver.fact_orders.customer_id',
    ]);
  });

  it('omite colunas quando a query está vazia', () => {
    const commands = buildCommands({
      tables: [{ id: 'gold.dim_customer' }],
      columns: [{ tableId: 'gold.dim_customer', columnName: 'id' }],
      actions: [],
      onFocusTable: vi.fn(),
      onFocusColumn: vi.fn(),
    });

    const results = filterCommands(commands, '', 12);
    expect(results.find((c) => c.kind === 'column')).toBeUndefined();
    expect(results.find((c) => c.kind === 'table')?.id).toBe('table:gold.dim_customer');
  });

  it('rankeia tabela antes de coluna antes de ação', () => {
    const base: Command[] = [
      {
        id: 'action:buscar',
        kind: 'action',
        label: 'Buscar',
        run: vi.fn(),
      },
      {
        id: 'column:gold.x.buscar',
        kind: 'column',
        label: 'gold.x.buscar',
        tableId: 'gold.x',
        columnName: 'buscar',
        run: vi.fn(),
      },
      {
        id: 'table:gold.buscar',
        kind: 'table',
        label: 'gold.buscar',
        run: vi.fn(),
      },
    ];

    const results = filterCommands(base, 'buscar', 12);
    expect(results.map((command) => command.kind)).toEqual(['table', 'column', 'action']);
  });

  it('executa onFocusColumn com tableId e columnName ao rodar coluna', () => {
    const onFocusColumn = vi.fn();
    const commands = buildCommands({
      tables: [{ id: 'gold.dim_customer' }],
      columns: [{ tableId: 'gold.dim_customer', columnName: 'id' }],
      actions: [],
      onFocusTable: vi.fn(),
      onFocusColumn,
    });

    const results = filterCommands(commands, 'id', 12);
    const column = results.find((c) => c.kind === 'column');
    expect(column).toBeDefined();
    void column!.run();
    expect(onFocusColumn).toHaveBeenCalledWith('gold.dim_customer', 'id');
  });
});
