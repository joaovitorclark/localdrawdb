import { describe, expect, it } from 'vitest';
import { normalizeTableId, normalizeColumnName, findDuplicateTableId, findDuplicateColumnName } from '../parse';

describe('normalizeTableId', () => {
  it('passa id simples para minúsculas', () => {
    expect(normalizeTableId('Foo')).toBe('foo');
  });

  it('passa id qualificado (schema.tabela) para minúsculas', () => {
    expect(normalizeTableId('Gold.Dim_Customer')).toBe('gold.dim_customer');
  });

  it('remove espaços nas pontas', () => {
    expect(normalizeTableId('  gold.dim  ')).toBe('gold.dim');
  });

  it('retorna string vazia para entrada vazia', () => {
    expect(normalizeTableId('')).toBe('');
  });
});

describe('normalizeColumnName', () => {
  it('passa nome para minúsculas', () => {
    expect(normalizeColumnName('Customer_ID')).toBe('customer_id');
  });

  it('remove espaços nas pontas', () => {
    expect(normalizeColumnName('  id  ')).toBe('id');
  });
});

describe('findDuplicateTableId', () => {
  it('retorna null quando não há duplicata', () => {
    const existing = ['gold.dim_customer', 'silver.fact_orders'];
    expect(findDuplicateTableId('gold.dim_product', existing)).toBeNull();
  });

  it('detecta duplicata exata (case-insensitive)', () => {
    const existing = ['gold.dim_customer'];
    expect(findDuplicateTableId('Gold.Dim_Customer', existing)).toBe('gold.dim_customer');
  });

  it('permite mesmo short name em schemas diferentes (multi-schema)', () => {
    const existing = ['gold.dim_customer'];
    expect(findDuplicateTableId('silver.dim_customer', existing)).toBeNull();
  });

  it('bloqueia unqualified contra existente qualificado com o mesmo short name', () => {
    const existing = ['gold.dim_customer'];
    expect(findDuplicateTableId('dim_customer', existing)).toBe('gold.dim_customer');
  });

  it('bloqueia qualificado contra existente unqualified com o mesmo short name', () => {
    const existing = ['dim_customer'];
    expect(findDuplicateTableId('gold.dim_customer', existing)).toBe('dim_customer');
  });
});

describe('findDuplicateColumnName', () => {
  it('retorna null quando coluna é nova', () => {
    const existing = ['id', 'name'];
    expect(findDuplicateColumnName('email', existing)).toBeNull();
  });

  it('detecta duplicata case-insensitive', () => {
    const existing = ['customer_id'];
    expect(findDuplicateColumnName('Customer_ID', existing)).toBe('customer_id');
  });
});