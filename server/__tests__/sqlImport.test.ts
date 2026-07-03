import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modelToDbml } from '../dbmlIo.ts';
import { detectSqlDialect, sqlToModel } from '../sqlImport.ts';
import { parseDbml } from '../../src/dsl/parse.ts';

const ORACLE_FIXTURE = `
-- @layer: bronze
-- @group: ingestao
-- @note: Pedidos brutos
-- @fk: customer_id -> raw.customers.id
CREATE TABLE raw.orders (
  id NUMBER(19) NOT NULL,
  customer_id NUMBER(19),
  CONSTRAINT pk_orders PRIMARY KEY (id),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES raw.customers (id)
);

CREATE TABLE raw.customers (
  id NUMBER(19) NOT NULL,
  CONSTRAINT pk_customers PRIMARY KEY (id)
);
`;

const COMPOSITE_PK = `
CREATE TABLE gold.report_revenue (
  period DATE,
  region STRING,
  segment STRING,
  total DECIMAL(18,2),
  PRIMARY KEY (period, region)
) USING DELTA;
`;

describe('detectSqlDialect', () => {
  it('detecta Oracle', () => {
    expect(detectSqlDialect(ORACLE_FIXTURE)).toBe('oracle');
  });
  it('detecta Spark', () => {
    expect(detectSqlDialect('CREATE TABLE t (a STRING) USING DELTA')).toBe('spark');
  });
});

describe('sqlToModel refs', () => {
  it('extrai FK de FOREIGN KEY e @fk', () => {
    const m = sqlToModel(ORACLE_FIXTURE);
    expect(m.tables).toHaveLength(2);
    expect(m.refs.length).toBeGreaterThanOrEqual(1);
    const fk = m.refs.find((r) => r.from.column === 'customer_id');
    expect(fk?.from.table).toBe('raw.orders');
    expect(fk?.to.table).toBe('raw.customers');
    expect(fk?.to.column).toBe('id');
  });

  it('extrai FK composta (2 colunas) e gera um Ref por par', () => {
    const m = sqlToModel(`
CREATE TABLE silver.fato_item (
  num_pedido STRING,
  num_seq SMALLINT,
  CONSTRAINT pk_item PRIMARY KEY (num_pedido, num_seq),
  CONSTRAINT fk_item_seq FOREIGN KEY (num_pedido, num_seq)
    REFERENCES silver.fato_seq (num_pedido, num_seq)
) USING DELTA;
CREATE TABLE silver.fato_seq (
  num_pedido STRING,
  num_seq SMALLINT,
  CONSTRAINT pk_seq PRIMARY KEY (num_pedido, num_seq)
) USING DELTA;
`);
    const pairs = m.refs.filter((r) => r.from.table === 'silver.fato_item');
    expect(pairs).toHaveLength(2);
    expect(pairs.map((r) => r.from.column).sort()).toEqual(['num_pedido', 'num_seq']);
    expect(pairs.every((r) => r.to.table === 'silver.fato_seq')).toBe(true);
  });

  it('extrai FK composta de 3 colunas', () => {
    const m = sqlToModel(`
CREATE TABLE silver.msg (
  a STRING,
  b SMALLINT,
  c SMALLINT,
  CONSTRAINT fk_msg_item FOREIGN KEY (a, b, c)
    REFERENCES silver.item (a, b, c)
) USING DELTA;
CREATE TABLE silver.item (
  a STRING,
  b SMALLINT,
  c SMALLINT,
  PRIMARY KEY (a, b, c)
) USING DELTA;
`);
    expect(m.refs.filter((r) => r.from.table === 'silver.msg')).toHaveLength(3);
  });

  it('dedupe CONSTRAINT composta e @fk por coluna', () => {
    const m = sqlToModel(`
-- @fk: num_pedido -> silver.seq.num_pedido
-- @fk: num_seq -> silver.seq.num_seq
CREATE TABLE silver.child (
  num_pedido STRING,
  num_seq SMALLINT,
  CONSTRAINT fk_child FOREIGN KEY (num_pedido, num_seq)
    REFERENCES silver.seq (num_pedido, num_seq)
) USING DELTA;
CREATE TABLE silver.seq (
  num_pedido STRING,
  num_seq SMALLINT,
  PRIMARY KEY (num_pedido, num_seq)
) USING DELTA;
`);
    expect(m.refs.filter((r) => r.from.table === 'silver.child')).toHaveLength(2);
  });

  it('avisa e ignora FK com aridade divergente', () => {
    const m = sqlToModel(`
CREATE TABLE silver.bad (
  a STRING,
  b STRING,
  CONSTRAINT fk_bad FOREIGN KEY (a, b) REFERENCES silver.tgt (a)
) USING DELTA;
CREATE TABLE silver.tgt (a STRING, PRIMARY KEY (a)) USING DELTA;
`);
    expect(m.refs.filter((r) => r.from.table === 'silver.bad')).toHaveLength(0);
    expect(m.warnings?.some((w) => /silver\.bad/i.test(w) && /!=/i.test(w))).toBe(true);
  });
});

describe('sqlToModel composite PK', () => {
  it('preenche compositePks', () => {
    const m = sqlToModel(COMPOSITE_PK);
    const t = m.tables[0];
    expect(t.compositePks).toEqual([['period', 'region']]);
  });
});

describe('sqlToModel lineage L1 @origen', () => {
  it('extrai @origen simples e múltiplas origens', () => {
    const m = sqlToModel(`
CREATE TABLE raw.a (id BIGINT, PRIMARY KEY (id)) USING DELTA;
CREATE TABLE raw.b (id BIGINT, PRIMARY KEY (id)) USING DELTA;
-- @origen: raw.a
-- @origem: raw.b
CREATE TABLE silver.f (id BIGINT, PRIMARY KEY (id)) USING DELTA;
`);
    const entry = m.lineage?.find((l) => l.target === 'silver.f');
    expect(entry?.sources.sort()).toEqual(['raw.a', 'raw.b']);
  });
});

describe('sqlToModel lineage L2 @map inline', () => {
  it('extrai @map inline com note/ref e alias @mapeamento', () => {
    const m = sqlToModel(`
CREATE TABLE raw.src (
  id BIGINT,
  nome STRING,
  PRIMARY KEY (id)
) USING DELTA;
-- @origen: raw.src
CREATE TABLE silver.tgt (
  cod BIGINT, -- @map <- raw.src.id
  nom STRING, -- @mapeamento <- raw.src.nome [note: 'upper', ref: 'jobs/tgt.sql']
  PRIMARY KEY (cod)
) USING DELTA;
`);
    expect(m.lineage?.[0]).toEqual({ target: 'silver.tgt', sources: ['raw.src'] });
    expect(m.lineageFields).toHaveLength(2);
    const nom = m.lineageFields?.find((f) => f.targetColumn === 'nom');
    expect(nom).toMatchObject({
      sourceTable: 'raw.src',
      sourceColumn: 'nome',
      note: 'upper',
      ref: 'jobs/tgt.sql',
    });
  });

  it('avisa quando origem @map não existe', () => {
    const m = sqlToModel(`
CREATE TABLE silver.t (
  x BIGINT, -- @map <- missing.tbl.col
  PRIMARY KEY (x)
) USING DELTA;
`);
    expect(m.warnings?.some((w) => /@map.*missing\.tbl/i.test(w))).toBe(true);
  });
});

describe('demo_lakehouse_oracle.sql', () => {
  it('importa fixture educativa Oracle sem quebrar parse', () => {
    const sql = readFileSync(join(process.cwd(), 'examples/input/demo_lakehouse_oracle.sql'), 'utf8');
    const m = sqlToModel(sql);
    expect(m.tables.length).toBeGreaterThanOrEqual(20);
    expect(m.refs.length).toBeGreaterThanOrEqual(15);
    expect(m.lineage?.length).toBeGreaterThanOrEqual(8);
    expect(m.lineageFields?.length).toBeGreaterThanOrEqual(20);
    const pedidoFk = m.refs.find(
      (r) => r.from.table === 'staging.erp_pedido' && r.from.column === 'conta_id',
    );
    expect(pedidoFk?.to.table).toBe('staging.crm_conta');
    expect(m.lineage?.some((l) => l.target === 'silver.dim_conta')).toBe(true);
    expect(
      m.lineageFields?.some(
        (f) =>
          f.targetTable === 'silver.fato_pedido_item' &&
          f.targetColumn === 'seq_item' &&
          f.sourceTable === 'staging.erp_pedido_item',
      ),
    ).toBe(true);
    const dbml = modelToDbml(m);
    expect(dbml).toContain('Lineage {');
    expect(dbml).toContain('LineageFields {');
    const parsed = parseDbml(dbml);
    expect(parsed.error).toBeUndefined();
  });
});

describe('COMMENT ON Oracle', () => {
  it('aplica notes de tabela e coluna', () => {
    const m = sqlToModel(`
CREATE TABLE staging.t (
  id NUMBER(1) NOT NULL,
  nome VARCHAR2(10),
  CONSTRAINT pk_t PRIMARY KEY (id)
);
COMMENT ON TABLE staging.t IS 'Tabela T';
COMMENT ON COLUMN staging.t.nome IS 'Nome legivel';
`);
    const t = m.tables[0];
    expect(t.note).toBe('Tabela T');
    expect(t.noteInRecordsOnly).toBe(true);
    expect(t.columns.find((c) => c.name === 'nome')?.note).toBe('Nome legivel');
  });
});

describe('modelToDbml import notes', () => {
  it('@note vai para Records, não para Table', () => {
    const m = sqlToModel(`
-- @note: Apenas no records
CREATE TABLE t (id BIGINT, PRIMARY KEY (id)) USING DELTA;
INSERT INTO t (id) VALUES (1);
`);
    const t = m.tables[0];
    t.noteInRecordsOnly = true;
    const dbml = modelToDbml(m);
    expect(dbml).not.toMatch(/Table t \{[^}]*Note:/s);
    expect(dbml).toContain('Records t');
    expect(dbml).toContain("Note: 'Apenas no records'");
  });
});

describe('linhagem L2 — rodapé @lineage', () => {
  it('importa o bloco-rodapé com note/ref', () => {
    const m = sqlToModel(`
CREATE TABLE silver.dim_customer (
  customer_key BIGINT,
  natural_id BIGINT,
  name STRING,
  PRIMARY KEY (customer_key)
) USING DELTA;
-- @lineage silver.dim_customer
--   natural_id <- raw.customers.id
--   name <- raw.customers.name [note: 'trim+upper', ref: 'jobs/dim.sql']

CREATE TABLE raw.customers (
  id BIGINT,
  name STRING,
  PRIMARY KEY (id)
) USING DELTA;
`);
    expect(m.lineageFields).toHaveLength(2);
    expect(m.lineageFields).toContainEqual({
      targetTable: 'silver.dim_customer',
      targetColumn: 'natural_id',
      sourceTable: 'raw.customers',
      sourceColumn: 'id',
    });
    expect(m.lineageFields).toContainEqual({
      targetTable: 'silver.dim_customer',
      targetColumn: 'name',
      sourceTable: 'raw.customers',
      sourceColumn: 'name',
      note: 'trim+upper',
      ref: 'jobs/dim.sql',
    });
  });

  it('retrocompat: ainda importa @map inline antigo', () => {
    const m = sqlToModel(`
CREATE TABLE silver.s (
  k BIGINT,
  v STRING, -- @map <- raw.r.v
  PRIMARY KEY (k)
) USING DELTA;
`);
    expect(m.lineageFields).toContainEqual({
      targetTable: 'silver.s',
      targetColumn: 'v',
      sourceTable: 'raw.r',
      sourceColumn: 'v',
    });
  });
});

describe('comentário inline → Column.note', () => {
  it('captura descrição inline e ignora diretivas @', () => {
    const m = sqlToModel(`
CREATE TABLE silver.t (
  id BIGINT, -- chave natural
  name STRING, -- @map <- raw.r.name
  total DECIMAL(18,2) -- valor bruto
) USING DELTA;
`);
    const t = m.tables[0];
    expect(t.columns.find((c) => c.name === 'id')?.note).toBe('chave natural');
    expect(t.columns.find((c) => c.name === 'total')?.note).toBe('valor bruto');
    // diretiva @map não vira nota de coluna
    expect(t.columns.find((c) => c.name === 'name')?.note).toBeUndefined();
  });

  it('inline tem precedência sobre COMMENT ON COLUMN; COMMENT ON aplica quando não há inline', () => {
    const m = sqlToModel(`
CREATE TABLE staging.t (
  nome VARCHAR2(10), -- inline curta
  email VARCHAR2(40)
);
COMMENT ON COLUMN staging.t.nome IS 'descrição oficial';
COMMENT ON COLUMN staging.t.email IS 'email do cliente';
`);
    const cols = m.tables[0].columns;
    expect(cols.find((c) => c.name === 'nome')?.note).toBe('inline curta');
    expect(cols.find((c) => c.name === 'email')?.note).toBe('email do cliente');
  });
});

describe('splitStatements comment-aware', () => {
  it('não parte em ; dentro de string literal (COMMENT ON)', () => {
    const m = sqlToModel(`
CREATE TABLE staging.t (
  id NUMBER(1) NOT NULL,
  CONSTRAINT pk_t PRIMARY KEY (id)
);
COMMENT ON COLUMN staging.t.id IS 'codigo; interno';
`);
    expect(m.tables).toHaveLength(1);
    expect(m.tables[0].columns.find((c) => c.name === 'id')?.note).toBe('codigo; interno');
  });
});

describe('Oracle PK composta', () => {
  it('preenche compositePks via CONSTRAINT PRIMARY KEY', () => {
    const m = sqlToModel(`
CREATE TABLE staging.order_lines (
  order_id NUMBER(10) NOT NULL,
  line_no NUMBER(5) NOT NULL,
  qty NUMBER(10),
  CONSTRAINT pk_order_lines PRIMARY KEY (order_id, line_no)
);
`);
    const t = m.tables[0];
    expect(t.compositePks).toEqual([['order_id', 'line_no']]);
    expect(t.columns.find((c) => c.name === 'order_id')?.pk).toBe(true);
    expect(t.columns.find((c) => c.name === 'line_no')?.pk).toBe(true);
  });
});

describe('refs degeneradas', () => {
  it('ignora ref com mesmo endpoint (origem = destino)', () => {
    const m = sqlToModel(`
-- @fk: id -> staging.loop.id
CREATE TABLE staging.loop (
  id NUMBER(1) NOT NULL,
  CONSTRAINT pk_loop PRIMARY KEY (id)
);
`);
    expect(m.refs).toHaveLength(0);
  });
});

describe('Oracle DDL sintético — round-trip DBML', () => {
  const ORACLE_ROUNDTRIP = `
CREATE TABLE staging.dim_region (
  region_code VARCHAR2(10) NOT NULL,
  country_code VARCHAR2(5) NOT NULL,
  region_name VARCHAR2(100),
  CONSTRAINT pk_dim_region PRIMARY KEY (region_code, country_code)
);
COMMENT ON TABLE staging.dim_region IS 'Dimensão região -- oficial';
COMMENT ON COLUMN staging.dim_region.region_name IS 'Nome legível; pode conter ''aspas''';

CREATE TABLE staging.fact_sales (
  sale_id NUMBER(19) NOT NULL,
  region_code VARCHAR2(10),
  amount NUMBER(12,2),
  CONSTRAINT pk_fact_sales PRIMARY KEY (sale_id),
  CONSTRAINT fk_sales_region FOREIGN KEY (region_code)
    REFERENCES staging.dim_region (region_code)
);
COMMENT ON COLUMN staging.fact_sales.amount IS 'Valor bruto\\nlinha2 -- nota';
`;

  it('sqlToModel → modelToDbml → parseDbml sem erro', () => {
    const m = sqlToModel(ORACLE_ROUNDTRIP);
    expect(m.tables).toHaveLength(2);
    expect(m.tables[0].compositePks).toEqual([['region_code', 'country_code']]);
    expect(m.tables[0].columns.find((c) => c.name === 'region_name')?.note).toContain('aspas');
    const dbml = modelToDbml(m);
    const parsed = parseDbml(dbml);
    expect(parsed.error).toBeUndefined();
    expect(parsed.tables.some((t) => t.id === 'staging.dim_region')).toBe(true);
  });
});
