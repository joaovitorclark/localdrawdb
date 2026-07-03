import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dbmlToModel } from '../dbmlIo.ts';
import { modelToOracleDDL } from '../ddl/oracle.ts';
import { sqlToModel } from '../sqlImport.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const demoSql = readFileSync(
  path.join(dir, '..', '..', 'examples', 'input', 'demo_lakehouse_oracle.sql'),
  'utf8',
);

const LOJA_DBML = `Table loja.pedido {
  id bigint [pk]
  customer_id bigint
  valor decimal(18,2)
}
Table loja.cliente {
  id bigint [pk]
  nome string
}
Ref: loja.pedido.customer_id > loja.cliente.id
`;

describe('Oracle DDL limpo', () => {
  it('mapeia tipos Oracle e PRIMARY KEY', () => {
    const ddl = modelToOracleDDL(dbmlToModel(LOJA_DBML));
    expect(ddl).toContain('-- LocalDrawDB: DDL Oracle');
    expect(ddl).toContain('CREATE TABLE loja.pedido');
    expect(ddl).toContain('VARCHAR2');
    expect(ddl).toContain('NUMBER');
    expect(ddl).toContain('PRIMARY KEY (id)');
    expect(ddl).not.toContain('@map');
    expect(ddl).not.toContain('USING DELTA');
  });

  it('emite ALTER TABLE para FKs', () => {
    const ddl = modelToOracleDDL(dbmlToModel(LOJA_DBML));
    expect(ddl).toContain('ALTER TABLE loja.pedido ADD CONSTRAINT');
    expect(ddl).toContain('FOREIGN KEY (customer_id) REFERENCES loja.cliente (id)');
  });

  it('demo_lakehouse_oracle preserva PK composta sem metadados LocalDrawDB', () => {
    const model = sqlToModel(demoSql);
    const agg = modelToOracleDDL(model);
    expect(agg).toContain('PRIMARY KEY (periodo, regiao)');
    expect(agg).not.toContain('-- @layer');
  });
});
