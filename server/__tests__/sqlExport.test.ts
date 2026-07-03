import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dbmlToModel, modelToDbml } from '../dbmlIo.ts';
import { sqlToModel } from '../sqlImport.ts';
import { modelToInputSql } from '../sqlExport.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const demoSql = readFileSync(
  path.join(dir, '..', '..', 'examples', 'input', 'demo_lakehouse_oracle.sql'),
  'utf8',
);

describe('export input SQL', () => {
  it('demo_lakehouse_oracle import → export Oracle contém tabelas e metadados', () => {
    const imported = sqlToModel(demoSql);
    expect(imported.tables.length).toBeGreaterThan(15);
    const oracleSql = modelToInputSql(imported, 'oracle');
    expect(oracleSql).toContain('-- @layer: bronze');
    expect(oracleSql).toContain('CREATE TABLE staging.erp_pedido');
    expect(oracleSql).toContain('VARCHAR2');
    expect(oracleSql).toContain('NUMBER');
    expect(oracleSql).toContain('INSERT INTO staging.erp_pedido');
    expect(oracleSql).toContain('PRIMARY KEY (periodo, regiao)');
  });

  it('export Oracle gera CONSTRAINT FK', () => {
    const imported = sqlToModel(demoSql);
    const oracleSql = modelToInputSql(imported, 'oracle');
    expect(oracleSql).toContain('CREATE TABLE staging.crm_conta');
    expect(oracleSql).toContain('FOREIGN KEY');
  });

  it('round-trip básico: DBML enriquecido → export → reimport preserva layer e refs', () => {
    const model0 = sqlToModel(demoSql);
    const dbml = modelToDbml(model0);
    const model1 = dbmlToModel(dbml);
    const exported = modelToInputSql(model1, 'oracle');
    const model2 = sqlToModel(exported);

    const pedido0 = model0.tables.find((t) => t.name === 'erp_pedido' && t.schema === 'staging')!;
    const pedido2 = model2.tables.find((t) => t.name === 'erp_pedido' && t.schema === 'staging')!;
    expect(pedido2.layer).toBe(pedido0.layer);
    expect(pedido2.group).toBe(pedido0.group);
    expect(model2.refs.some((r) => r.from.column === 'conta_id')).toBe(true);
    expect(pedido2.records?.rows.length).toBeGreaterThan(0);
    expect(model1.lineage?.length).toBe(model0.lineage?.length);
    expect(model1.lineageFields?.length).toBe(model0.lineageFields?.length);
  });

  it('export emite @origen e rodapé @lineage', () => {
    const model = sqlToModel(demoSql);
    const oracleSql = modelToInputSql(model, 'oracle');
    expect(oracleSql).toContain('-- @origen: staging.crm_conta');
    expect(oracleSql).toContain('-- @lineage silver.dim_conta');
    expect(oracleSql).toContain('--   conta_natural_id <- staging.crm_conta.conta_id');
    expect(oracleSql).toContain("note: 'SUM(valor_bruto) por dia'");
    expect(oracleSql).not.toMatch(/^\s*\w+ \w+.*-- @map <-/m);
  });
});
