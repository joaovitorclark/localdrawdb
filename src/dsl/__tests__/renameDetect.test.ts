import { describe, expect, it } from 'vitest';
import { detectRenames } from '../renameDetect';
import { renameColumnAllRefs, renameTable } from '../edit';

describe('detectRenames', () => {
  it('detecta renomeação de tabela com colunas similares', () => {
    const prev = `
Table bronze.foo {
  id bigint [pk]
  nome string
}
Ref: silver.x.id > bronze.foo.id
`;
    const next = prev.replace('bronze.foo', 'bronze.bar');
    const detected = detectRenames(prev, next);
    expect(detected).toHaveLength(1);
    expect(detected[0]).toEqual({ kind: 'table', oldId: 'bronze.foo', newId: 'bronze.bar' });
  });

  it('detecta renomeação de coluna na mesma posição', () => {
    const prev = `
Table silver.pedido {
  num_pedido bigint [pk]
  total decimal
}
Ref: silver.pedido.num_pedido > bronze.origem.id
`;
    const next = prev.replace('num_pedido', 'cod_pedido');
    const detected = detectRenames(prev, next);
    expect(detected.some((d) => d.kind === 'column' && d.oldCol === 'num_pedido')).toBe(true);
  });

  it('ignora cabeçalho incompleto ao digitar Table schema.', () => {
    const prev = `Table silver.dim_cbo {
  id bigint [pk]
  nome string
}
Table silver.dim_cnes {
  id bigint [pk]
}
`;
    const next = `Table silver. {
  id bigint [pk]
  nome string
}
Table silver.dim_cnes {
  id bigint [pk]
}
`;
    expect(detectRenames(prev, next).filter((d) => d.kind === 'table')).toHaveLength(0);
  });

  it('ignora nova tabela incompleta no final do arquivo', () => {
    const prev = `Table silver.dim_cbo {
  id bigint [pk]
}
`;
    const next = `${prev}\nTable silver.\n`;
    expect(detectRenames(prev, next).filter((d) => d.kind === 'table')).toHaveLength(0);
  });

  // --- Bug 3 (v18): múltiplos renames simultâneos ---

  it('detecta renome de 2 tabelas de uma vez (pareadas por colunas)', () => {
    const prev = `Table gold.dim_customer {
  customer_id integer [pk]
  name string
}
Table gold.fct_sales {
  id integer [pk]
  amount decimal
}
`;
    const next = prev
      .replace('gold.dim_customer', 'gold.dim_client')
      .replace('gold.fct_sales', 'gold.fct_orders');
    const detected = detectRenames(prev, next).filter((d) => d.kind === 'table');
    expect(detected).toHaveLength(2);
    expect(detected).toContainEqual({ kind: 'table', oldId: 'gold.dim_customer', newId: 'gold.dim_client' });
    expect(detected).toContainEqual({ kind: 'table', oldId: 'gold.fct_sales', newId: 'gold.fct_orders' });
  });

  it('detecta renome de 2 colunas na mesma tabela (pareadas por assinatura)', () => {
    const prev = `Table s.t {
  a_id bigint [pk]
  a_name string
  created_at timestamp
}
`;
    // renomeia a_id->pk_id (bigint) e a_name->label (string); tipos distintos => pareamento único
    const next = prev.replace('a_id bigint', 'pk_id bigint').replace('a_name string', 'label string');
    const detected = detectRenames(prev, next).filter((d) => d.kind === 'column');
    expect(detected).toContainEqual({ kind: 'column', table: 's.t', oldCol: 'a_id', newCol: 'pk_id' });
    expect(detected).toContainEqual({ kind: 'column', table: 's.t', oldCol: 'a_name', newCol: 'label' });
  });

  it('NÃO adivinha quando 2 colunas de mesma assinatura mudam (ambíguo)', () => {
    const prev = `Table s.t {
  id bigint [pk]
  foo string
  bar string
}
`;
    // foo->x e bar->y, ambos string => pareamento ambíguo => não detecta coluna
    const next = prev.replace('foo string', 'x string').replace('bar string', 'y string');
    const detected = detectRenames(prev, next).filter((d) => d.kind === 'column');
    expect(detected).toHaveLength(0);
  });

  it('NÃO trata inserir/remover tabelas distintas como rename (sem overlap)', () => {
    const prev = `Table a.one {
  id bigint [pk]
  col_a string
}
`;
    // remove a.one e adiciona b.two totalmente diferente => overlap baixo => sem rename
    const next = `Table b.two {
  other_id bigint [pk]
  zzz decimal
}
`;
    const detected = detectRenames(prev, next).filter((d) => d.kind === 'table');
    expect(detected).toHaveLength(0);
  });
});

describe('renameColumnAllRefs', () => {
  it('propaga coluna em Ref e LineageFields', () => {
    const src = `
Table bronze.a {
  old_col bigint [pk]
}
Table silver.b {
  x bigint [pk]
}
Ref: silver.b.x > bronze.a.old_col
LineageFields {
  silver.b.x < bronze.a.old_col
}
`;
    const out = renameColumnAllRefs(src, 'bronze.a', 'old_col', 'new_col');
    expect(out).toContain('new_col bigint');
    expect(out).toContain('bronze.a.new_col');
    expect(out).not.toContain('old_col');
  });
});

describe('renameTable', () => {
  it('propaga em Ref e TableGroup', () => {
    const src = `
TableGroup g {
  loja.a
}
Table loja.a {
  id bigint [pk]
}
Ref: loja.b.id > loja.a.id
`;
    const out = renameTable(src, 'loja.a', 'loja.cliente');
    expect(out).toContain('Table loja.cliente');
    expect(out).toContain('loja.cliente.id');
    expect(out).toContain('loja.cliente');
  });

  it('não substitui prefixo schema ao renomear silver → silver.', () => {
    const src = `Table silver.dim_cbo {
  id bigint [pk]
}
Table silver.dim_cnes {
  id bigint [pk]
}
`;
    const out = renameTable(src, 'silver', 'silver.');
    expect(out).toBe(src);
    expect(out).not.toContain('""');
  });

  it('renomeia só o token qualificado completo', () => {
    const src = `Table silver.dim_cbo {
  id bigint [pk]
}
Table silver.dim_cnes {
  id bigint [pk]
}
Ref: silver.dim_cnes.id > silver.dim_cbo.id
`;
    const out = renameTable(src, 'silver.dim_cbo', 'silver.dim_cliente');
    expect(out).toContain('Table silver.dim_cliente');
    expect(out).toContain('silver.dim_cliente.id');
    expect(out).toContain('Table silver.dim_cnes');
    expect(out).not.toContain('dim_cbo');
  });
});
