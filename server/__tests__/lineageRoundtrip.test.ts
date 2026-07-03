import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dbmlToModel, modelToDbml } from '../dbmlIo.ts';
import { sqlToModel } from '../sqlImport.ts';
import { modelToInputSql } from '../sqlExport.ts';
import { parseDbml } from '../../src/dsl/parse.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const demoSql = readFileSync(
  path.join(dir, '..', '..', 'examples', 'input', 'demo_lakehouse_oracle.sql'),
  'utf8',
);

describe('lineage DBML round-trip', () => {
  it('modelToDbml emite Lineage e LineageFields', () => {
    const model = sqlToModel(demoSql);
    const dbml = modelToDbml(model);
    expect(dbml).toContain('Lineage {');
    expect(dbml).toContain('silver.dim_conta < staging.crm_conta');
    expect(dbml).toContain('LineageFields {');
    expect(dbml).toContain('silver.dim_conta.conta_natural_id < staging.crm_conta.conta_id');
    expect(dbml).toContain("note: 'SUM(valor_bruto) por dia'");
    const parsed = parseDbml(dbml);
    expect(parsed.error).toBeUndefined();
    expect(parsed.lineage.some((l) => l.target === 'silver.dim_conta')).toBe(true);
    expect(
      parsed.lineageFields.some(
        (f) => f.targetTable === 'silver.fato_pedido' && f.targetColumn === 'pedido_natural_id',
      ),
    ).toBe(true);
  });

  it('dbmlToModel preserva linhagem do editor', () => {
    const dbml = `Table raw.orders {
  id bigint [pk]
}
Table silver.fact_orders {
  order_id bigint [pk]
}

Ref: silver.fact_orders.order_id > raw.orders.id

Lineage {
  silver.fact_orders < raw.orders
}

LineageFields {
  silver.fact_orders.order_id < raw.orders.id [note: 'copia direta']
}
`;
    const model = dbmlToModel(dbml);
    expect(model.lineage).toEqual([{ target: 'silver.fact_orders', sources: ['raw.orders'] }]);
    expect(model.lineageFields?.[0]).toMatchObject({
      targetTable: 'silver.fact_orders',
      targetColumn: 'order_id',
      sourceTable: 'raw.orders',
      sourceColumn: 'id',
      note: 'copia direta',
    });
    const back = modelToDbml(model);
    expect(back).toContain('Lineage {');
    expect(back).toContain('LineageFields {');
    expect(dbmlToModel(back).lineage).toEqual(model.lineage);
  });
});

describe('lineage SQL round-trip', () => {
  it('demo_lakehouse_oracle import → export → reimport preserva L1/L2', () => {
    const model0 = sqlToModel(demoSql);
    expect(model0.lineage?.length).toBeGreaterThan(0);
    expect(model0.lineageFields?.length).toBeGreaterThan(0);

    const exported = modelToInputSql(model0, 'oracle');
    expect(exported).toContain('-- @origen: staging.crm_conta');
    expect(exported).toContain('-- @lineage silver.dim_conta');
    expect(exported).toContain('--   conta_natural_id <- staging.crm_conta.conta_id');

    const model1 = sqlToModel(exported);
    const dimLineage = model1.lineage?.find((l) => l.target === 'silver.dim_conta');
    expect(dimLineage?.sources).toContain('staging.crm_conta');
    expect(
      model1.lineageFields?.some(
        (f) =>
          f.targetTable === 'silver.dim_conta' &&
          f.targetColumn === 'conta_natural_id' &&
          f.sourceTable === 'staging.crm_conta' &&
          f.sourceColumn === 'conta_id',
      ),
    ).toBe(true);

    const dbml = modelToDbml(model1);
    const parsed = parseDbml(dbml);
    expect(parsed.error).toBeUndefined();
    expect(parsed.lineage.length).toBeGreaterThan(0);
    expect(parsed.lineageFields.length).toBeGreaterThan(0);
  });
});
