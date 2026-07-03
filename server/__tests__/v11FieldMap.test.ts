import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dbmlToModel, modelToDbml } from '../dbmlIo.ts';
import { mergeModel, sqlToModel } from '../sqlImport.ts';
import { modelToInputSql } from '../sqlExport.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const demoSql = readFileSync(
  path.join(dir, '..', '..', 'examples', 'input', 'demo_lakehouse_oracle.sql'),
  'utf8',
);

function countLineageMaps(sql: string): number {
  return (sql.match(/--[^\n]*<-/g) ?? []).length;
}

describe('v11-04 demo_lakehouse_oracle L2', () => {
  it('sqlToModel popula lineageFields incluindo seq_item', () => {
    const model = sqlToModel(demoSql);
    expect(model.lineageFields?.length).toBeGreaterThan(20);
    expect(
      model.lineageFields?.some(
        (f) =>
          f.targetTable === 'silver.fato_pedido_item' &&
          f.targetColumn === 'seq_item' &&
          f.sourceTable === 'staging.erp_pedido_item' &&
          f.sourceColumn === 'seq_item',
      ),
    ).toBe(true);
  });

  it('export Oracle emite rodapé @lineage para seq_item', () => {
    const model = sqlToModel(demoSql);
    const oracleSql = modelToInputSql(model, 'oracle');
    expect(oracleSql).toContain('-- @lineage silver.fato_pedido_item');
    expect(oracleSql).toMatch(/--\s+seq_item <- staging\.erp_pedido_item\.seq_item/);
  });

  it('round-trip preserva ≥95% dos mapeamentos L2 da fixture', () => {
    const sourceMaps = countLineageMaps(demoSql);
    expect(sourceMaps).toBeGreaterThanOrEqual(20);

    const model0 = sqlToModel(demoSql);
    const dbml = modelToDbml(model0);
    const model1 = dbmlToModel(dbml);
    const exported = modelToInputSql(model1, 'oracle');
    const model2 = sqlToModel(exported);

    const roundMaps = countLineageMaps(exported);
    const preservedRatio = roundMaps / sourceMaps;
    expect(preservedRatio).toBeGreaterThanOrEqual(0.95);
    expect(model2.lineageFields?.length).toBeGreaterThanOrEqual(
      Math.floor((model0.lineageFields?.length ?? 0) * 0.95),
    );
  });

  it('mergeModel preserva L2 do editor e do input', () => {
    const editorDbml = `Table staging.erp_pedido_item {
  pedido_id number(19) [pk]
  seq_item number(5) [pk]
}
Table silver.fato_pedido_item {
  sk_item number(19) [pk]
  seq_item number(5)
}

LineageFields {
  silver.fato_pedido_item.seq_item < staging.erp_pedido_item.seq_item
}
`;
    const inputSql = `
CREATE TABLE silver.fato_pedido_item (
  sk_item NUMBER(19),
  quantidade NUMBER(10), -- @map <- staging.erp_pedido_item.quantidade
  CONSTRAINT pk_item PRIMARY KEY (sk_item)
);
CREATE TABLE staging.erp_pedido_item (
  pedido_id NUMBER(19),
  seq_item NUMBER(5),
  quantidade NUMBER(10),
  CONSTRAINT pk_erp_item PRIMARY KEY (pedido_id, seq_item)
);
`;

    const base = dbmlToModel(editorDbml);
    const incoming = sqlToModel(inputSql);
    const merged = mergeModel(base, incoming);
    const dbml = modelToDbml(merged);

    expect(dbml).toContain('silver.fato_pedido_item.seq_item < staging.erp_pedido_item.seq_item');
    expect(dbml).toContain('silver.fato_pedido_item.quantidade < staging.erp_pedido_item.quantidade');
    expect(merged.lineageFields).toHaveLength(2);
  });
});
