import { describe, expect, it } from 'vitest';
import { resolveMemberTableIds, tableIdsMatch } from '../tableIdMatch';
import { parseDbml } from '../parse';
import { validateModel } from '../validateModel';

describe('tableIdsMatch', () => {
  it('bate exact (case-insensitive)', () => {
    expect(tableIdsMatch('Layer_B.Orders', 'layer_b.orders')).toBe(true);
  });

  it('não cruza schemas quando ambos são qualificados', () => {
    expect(tableIdsMatch('layer_a.orders', 'layer_b.orders')).toBe(false);
  });

  it('aceita short name vs qualificado', () => {
    expect(tableIdsMatch('orders', 'layer_b.orders')).toBe(true);
    expect(tableIdsMatch('layer_b.orders', 'orders')).toBe(true);
  });
});

describe('resolveMemberTableIds', () => {
  const ids = ['layer_a.orders', 'layer_b.orders', 'customers'];

  it('membro qualificado só resolve o id exact', () => {
    expect(resolveMemberTableIds('layer_b.orders', ids)).toEqual(['layer_b.orders']);
  });

  it('membro qualificado de schema inexistente não cai no short name', () => {
    expect(resolveMemberTableIds('layer_x.orders', ids)).toEqual([]);
  });

  it('membro unqualified inequívoco resolve o único candidato', () => {
    expect(resolveMemberTableIds('customers', ids)).toEqual(['customers']);
  });

  it('membro unqualified ambíguo (mesmo short name em 2 schemas) não resolve', () => {
    expect(resolveMemberTableIds('orders', ids)).toEqual([]);
  });
});

describe('TableGroup membership multi-schema (#35)', () => {
  const dbml = `Table layer_a.orders {
  id int [pk]
}
Table layer_b.orders {
  id int [pk]
}
TableGroup some_group {
  layer_b.orders
}
`;

  it('lista só schema_b.foo → só essa tabela recebe o group', () => {
    const r = parseDbml(dbml);
    expect(r.error).toBeUndefined();
    expect(r.tables.find((t) => t.id === 'layer_b.orders')?.group).toBe('some_group');
    expect(r.tables.find((t) => t.id === 'layer_a.orders')?.group).toBeUndefined();
  });

  it('membro unqualified com uma única tabela continua funcionando', () => {
    const single = `Table orders {
  id int [pk]
}
TableGroup g {
  orders
}
`;
    const r = parseDbml(single);
    expect(r.error).toBeUndefined();
    expect(r.tables).toHaveLength(1);
    expect(r.tables[0].group).toBe('g');
  });

  it('problems de TableGroup usam as mesmas regras (membro fantasma → error)', () => {
    const withGhost = `Table layer_a.orders {
  id int [pk]
}
Table layer_b.orders {
  id int [pk]
}
TableGroup some_group {
  layer_b.orders
  layer_x.orders
}
`;
    const r = parseDbml(withGhost);
    // @dbml pode falhar no membro inexistente; se parsear, validamos membership + problems.
    if (r.error) {
      expect(r.error.toLowerCase()).toMatch(/orders|exist|table/);
      return;
    }
    expect(r.tables.find((t) => t.id === 'layer_a.orders')?.group).toBeUndefined();
    expect(r.tables.find((t) => t.id === 'layer_b.orders')?.group).toBe('some_group');
    const issues = validateModel(r, withGhost);
    expect(
      issues.some(
        (i) =>
          i.severity === 'error' &&
          i.message.includes('TableGroup') &&
          i.message.includes('layer_x.orders'),
      ),
    ).toBe(true);
  });

  it('LayerGroup com membro do outro schema não conta como resolvido via short name', () => {
    const dbmlLg = `Table layer_a.orders {
  id int [pk]
}
LayerGroup bronze {
  layer_b.orders
}
`;
    const r = parseDbml(dbmlLg);
    expect(r.error).toBeUndefined();
    const issues = validateModel(r, dbmlLg);
    expect(
      issues.some(
        (i) =>
          i.severity === 'error' &&
          i.message.includes('LayerGroup') &&
          i.message.includes('layer_b.orders'),
      ),
    ).toBe(true);
  });
});
