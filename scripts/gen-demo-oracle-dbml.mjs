#!/usr/bin/env node
/** Regenera examples/demo_lakehouse_oracle/project.dbml a partir do SQL versionado. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelToDbml } from '../server/dbmlIo.ts';
import { sqlToModel } from '../server/sqlImport.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = path.join(ROOT, 'examples/input/demo_lakehouse_oracle.sql');
const OUT = path.join(ROOT, 'examples/demo_lakehouse_oracle/project.dbml');

const COLORS = `
Colors {
  staging.erp_pedido: #b08d57
  silver.fato_pedido: #00995d
  silver.fato_pedido_item: #15803d
  gold.kpi_vendas_dia: #d4af37
  gold.report_executivo: #a16207
  @ingestao_oracle: #b5651d
  @ingestao_web: #475569
  @dimensoes: #0e7490
  @fatos: #15803d
  @bridge: #6b21a8
  @agregados: #d4af37
  @reports: #b91c1c
}
`.trim();

const model = sqlToModel(readFileSync(SQL, 'utf8'));
let dbml = modelToDbml(model).trim();

dbml = dbml
  .replace(/^LayerGroup bronze \{/m, 'LayerGroup bronze [color: #b08d57] {')
  .replace(/^LayerGroup prata \{/m, 'LayerGroup prata [color: #9ca3af] {')
  .replace(/^LayerGroup ouro \{/m, 'LayerGroup ouro [color: #d4af37] {');

writeFileSync(OUT, `${dbml}\n\n${COLORS}\n`, 'utf8');
console.log(`OK -> ${path.relative(ROOT, OUT)} (${model.tables.length} tabelas)`);
