import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { modelToDicionarioXlsx } from '../ddl/xlsx';
import type { Model } from '../model';

function sampleModel(): Model {
  return {
    tables: [
      {
        name: 'orders',
        schema: 'sales',
        columns: [
          { name: 'id', type: 'bigint', pk: true, nullable: false },
          { name: 'customer_id', type: 'bigint', nullable: false, note: 'FK to customers' },
          { name: 'total', type: 'decimal', args: '18,2' },
          {
            name: 'status',
            type: 'string',
            tests: [{ kind: 'accepted_values', values: ['NEW', 'PAID', 'CANCELLED'] }],
          },
        ],
        note: 'Pedidos de venda',
        tags: ['fact'],
      },
      {
        name: 'customers',
        schema: 'sales',
        columns: [{ name: 'id', type: 'bigint', pk: true, nullable: false }],
      },
    ],
    refs: [{ from: { table: 'orders', column: 'customer_id' }, to: { table: 'customers', column: 'id' }, kind: '>' }],
  };
}

describe('modelToDicionarioXlsx', () => {
  it('gera buffer XLSX parseável', () => {
    const buf = modelToDicionarioXlsx(sampleModel());
    expect(buf.length).toBeGreaterThan(0);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Dicionário');
  });

  it('inclui todas as colunas do modelo', () => {
    const buf = modelToDicionarioXlsx(sampleModel());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets['Dicionário'];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { header: 1 });
    // header + 4 colunas de orders + 1 coluna de customers = 6 linhas
    expect(rows.length).toBe(6);
    // primeira linha = headers
    expect(rows[0][2]).toBe('coluna'); // coluna 2 = "coluna"
  });

  it('marca PK e NN nas colunas corretas', () => {
    const buf = modelToDicionarioXlsx(sampleModel());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets['Dicionário'], { header: 1 }) as unknown as string[][];
    // linha 1 = orders.id (PK + NOT NULL)
    expect(rows[1][4]).toBe('PK');   // pk
    expect(rows[1][5]).toBe('NO');   // nullable
    // linha 2 = orders.customer_id (NOT NULL, não PK, FK)
    expect(rows[2][4]).toBe('');     // pk
    expect(rows[2][5]).toBe('NO');   // nullable
    expect(rows[2][7]).toBe('customers.id'); // fk_target
  });

  it('serializa accepted_values como [A, B, C]', () => {
    const buf = modelToDicionarioXlsx(sampleModel());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets['Dicionário'], { header: 1 }) as unknown as string[][];
    // linha 4 = orders.status (nullable=YES, fk vazio, constraints)
    expect(rows[4][5]).toBe('YES');
    expect(rows[4][9]).toBe('[NEW, PAID, CANCELLED]');
  });

  it('lida com modelo vazio', () => {
    const buf = modelToDicionarioXlsx({ tables: [], refs: [] });
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Dicionário'], { header: 1 });
    expect(rows.length).toBe(1); // só o header
  });
});