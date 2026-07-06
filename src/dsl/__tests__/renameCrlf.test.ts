import { describe, expect, it } from 'vitest';
import { renameTable, renameColumnAllRefs } from '../edit';
import { countRenameRefs } from '../reconcile';
import { detectRenames } from '../renameDetect';

// Repro do bug v15-05: no Windows (CRLF) o rename de tabela com muitas refs
// reportava "N refs atualizadas" mas não propagava todas. Estes testes garantem
// paridade de comportamento entre LF e CRLF.

/** DBML com muitas refs (inline, Ref:, TableGroup, Lineage, LineageFields) para gold.dim_product. */
const LF = `TableGroup analytics {
  gold.dim_product
  gold.fct_sales
}

Table gold.dim_product {
  id bigint [pk]
  name varchar
}

Table gold.fct_sales {
  id bigint [pk]
  product_id bigint [ref: > gold.dim_product.id]
  product_id2 bigint [ref: > gold.dim_product.id]
}

Table gold.fct_returns {
  id bigint [pk]
  product_id bigint [ref: > gold.dim_product.id]
}

Ref: gold.fct_sales.product_id > gold.dim_product.id
Ref: gold.fct_returns.product_id > gold.dim_product.id
Ref: gold.dim_product.id < gold.fct_sales.product_id2

Lineage {
  gold.dim_product < gold.fct_sales, gold.fct_returns
  gold.fct_sales < gold.dim_product
}

LineageFields {
  gold.dim_product.name < gold.fct_sales.id
  gold.fct_sales.product_id < gold.dim_product.id
}
`;

const toCrlf = (s: string) => s.replace(/\n/g, '\r\n');

describe('rename CRLF-safe (v15-05)', () => {
  it('renameTable propaga o mesmo número de ocorrências em LF e CRLF', () => {
    const lfOut = renameTable(LF, 'gold.dim_product', 'gold.dim_produto');
    const crlfOut = renameTable(toCrlf(LF), 'gold.dim_product', 'gold.dim_produto');

    // Nenhuma ocorrência de "gold.dim_product" deve sobrar em nenhum dos dois.
    const leftoverLf = (lfOut.match(/gold\.dim_product(?![\w])/g) ?? []).length;
    const leftoverCrlf = (crlfOut.match(/gold\.dim_product(?![\w])/g) ?? []).length;

    expect(leftoverLf).toBe(0);
    expect(leftoverCrlf).toBe(0);

    // Mesmo número de "gold.dim_produto" nos dois.
    const newLf = (lfOut.match(/gold\.dim_produto(?![\w])/g) ?? []).length;
    const newCrlf = (crlfOut.match(/gold\.dim_produto(?![\w])/g) ?? []).length;
    expect(newCrlf).toBe(newLf);
    expect(newLf).toBeGreaterThan(10);
  });

  it('countRenameRefs bate entre LF e CRLF', () => {
    const rename = { kind: 'table' as const, oldId: 'gold.dim_product', newId: 'gold.dim_produto' };
    const nLf = countRenameRefs(LF, rename);
    const nCrlf = countRenameRefs(toCrlf(LF), rename);
    expect(nCrlf).toBe(nLf);
  });

  it('contagem reportada = substituições reais (count == replace)', () => {
    const rename = { kind: 'table' as const, oldId: 'gold.dim_product', newId: 'gold.dim_produto' };
    for (const src of [LF, toCrlf(LF)]) {
      const reported = countRenameRefs(src, rename);
      const before = (src.match(/gold\.dim_product(?![\w])/g) ?? []).length;
      const headers = (src.match(/Table\s+gold\.dim_product\b/g) ?? []).length;
      const expectedRefs = before - headers;
      expect(reported).toBe(expectedRefs);
    }
  });

  it('detectRenames funciona comparando committed(CRLF) vs buffer(LF)', () => {
    const committed = toCrlf(LF);
    const buffer = LF.replace('Table gold.dim_product', 'Table gold.dim_produto')
      .replace(/gold\.dim_product\b/g, 'gold.dim_produto');
    const renames = detectRenames(committed, buffer);
    const tableRename = renames.find((r) => r.kind === 'table');
    expect(tableRename).toBeDefined();
  });

  it('detectRenames detecta rename de coluna em CRLF', () => {
    const committed = toCrlf(LF);
    const buffer = LF.replace('  name varchar', '  nome varchar');
    const renames = detectRenames(committed, buffer);
    const colRename = renames.find((r) => r.kind === 'column');
    expect(colRename).toMatchObject({ kind: 'column', oldCol: 'name', newCol: 'nome' });
  });

  it('renameColumnAllRefs renomeia a DEFINIÇÃO da coluna em LF e CRLF', () => {
    const lfOut = renameColumnAllRefs(LF, 'gold.dim_product', 'name', 'nome');
    const crlfOut = renameColumnAllRefs(toCrlf(LF), 'gold.dim_product', 'name', 'nome').replace(/\r\n/g, '\n');
    // A linha de definição `  name varchar` deve virar `  nome varchar` (não só as refs qualificadas).
    for (const out of [lfOut, crlfOut]) {
      expect(out).toMatch(/^\s*nome\s+varchar/m);
      expect(out).not.toMatch(/^\s*name\s+varchar/m);
      expect(out).toContain('gold.dim_product.nome');
    }
  });
});
