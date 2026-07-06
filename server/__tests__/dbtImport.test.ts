// F3 — Import dbt. Três formatos: schema.yml avulso, projeto em pasta (yml+sql)
// e dbt-docs (manifest.json). Mapeia para o Model e faz round-trip com F2.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dbtFilesToModel, manifestToModel, schemaYmlToModel } from '../dbtImport.ts';
import { modelToDbtFiles } from '../dbtExport.ts';
import type { Model } from '../model.ts';

const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../examples/dbt');

// ---------------------------------------------------------------------------
// 1. schema.yml avulso
// ---------------------------------------------------------------------------

const SCHEMA_YML = `version: 2
models:
  - name: pedido
    description: Pedidos limpos
    config:
      materialized: incremental
      tags: [vendas, core]
    columns:
      - name: id
        data_tests: [unique, not_null]
      - name: cliente_id
        description: FK do cliente
        data_tests:
          - not_null
          - relationships: { to: "ref('dim_cliente')", field: id }
      - name: status
        data_tests:
          - accepted_values: { values: [ativo, cancelado] }
      - name: email
        data_tests: [unique, not_null]
sources:
  - name: bronze
    schema: bronze
    tables:
      - name: raw_pedido
        description: Pedidos crus
        columns:
          - name: id
            data_tests: [unique, not_null]
`;

describe('schemaYmlToModel', () => {
  const model = schemaYmlToModel(SCHEMA_YML);
  const pedido = model.tables.find((t) => t.name === 'pedido')!;
  const raw = model.tables.find((t) => t.name === 'raw_pedido')!;

  it('model carrega materialization, tags e descrição', () => {
    expect(pedido.materialization).toBe('incremental');
    expect(pedido.tags).toEqual(['vendas', 'core']);
    expect(pedido.note).toBe('Pedidos limpos');
  });

  it('primeira coluna unique+not_null vira PK', () => {
    const id = pedido.columns.find((c) => c.name === 'id')!;
    expect(id.pk).toBe(true);
  });

  it('unique+not_null seguinte vira unique + not null (não duplica PK)', () => {
    const email = pedido.columns.find((c) => c.name === 'email')!;
    expect(email.pk).toBeFalsy();
    expect(email.unique).toBe(true);
    expect(email.nullable).toBe(false);
  });

  it('not_null sozinho vira nullable=false; descrição vira note', () => {
    const fk = pedido.columns.find((c) => c.name === 'cliente_id')!;
    expect(fk.nullable).toBe(false);
    expect(fk.note).toBe('FK do cliente');
  });

  it('accepted_values vira Column.tests', () => {
    const status = pedido.columns.find((c) => c.name === 'status')!;
    expect(status.tests).toEqual([{ kind: 'accepted_values', values: ['ativo', 'cancelado'] }]);
  });

  it('relationships vira Ref', () => {
    const ref = model.refs.find((r) => r.from.table === 'pedido' && r.from.column === 'cliente_id');
    expect(ref).toBeDefined();
    expect(ref!.to).toEqual({ table: 'dim_cliente', column: 'id' });
  });

  it('source vira tabela resourceType=source com schema', () => {
    expect(raw.resourceType).toBe('source');
    expect(raw.schema).toBe('bronze');
    expect(raw.note).toBe('Pedidos crus');
  });
});

// ---------------------------------------------------------------------------
// 2. dbt-docs (manifest.json)
// ---------------------------------------------------------------------------

const MANIFEST = {
  nodes: {
    'model.shop.pedido': {
      resource_type: 'model',
      name: 'pedido',
      schema: 'prata',
      description: 'Pedidos limpos',
      config: { materialized: 'incremental', tags: ['vendas'] },
      columns: {
        id: { name: 'id', description: 'chave', data_type: 'bigint' },
        cliente_id: { name: 'cliente_id', data_type: 'bigint' },
      },
      depends_on: { nodes: ['source.shop.bronze.raw_pedido'] },
    },
    'test.shop.not_null_pedido_id.abc': {
      resource_type: 'test',
      column_name: 'id',
      test_metadata: { name: 'not_null' },
      depends_on: { nodes: ['model.shop.pedido'] },
    },
    'test.shop.unique_pedido_id.def': {
      resource_type: 'test',
      column_name: 'id',
      test_metadata: { name: 'unique' },
      depends_on: { nodes: ['model.shop.pedido'] },
    },
  },
  sources: {
    'source.shop.bronze.raw_pedido': {
      resource_type: 'source',
      name: 'raw_pedido',
      source_name: 'bronze',
      schema: 'bronze',
      columns: { id: { name: 'id', data_type: 'bigint' } },
    },
  },
};

describe('manifestToModel (dbt-docs)', () => {
  const model = manifestToModel(MANIFEST);
  const pedido = model.tables.find((t) => t.name === 'pedido')!;

  it('extrai model com tipo real, materialization e tags', () => {
    expect(pedido.schema).toBe('prata');
    expect(pedido.materialization).toBe('incremental');
    expect(pedido.tags).toEqual(['vendas']);
    expect(pedido.columns.find((c) => c.name === 'id')!.type).toBe('bigint');
  });

  it('resolve tests do manifest (unique+not_null → PK na coluna id)', () => {
    const id = pedido.columns.find((c) => c.name === 'id')!;
    expect(id.pk).toBe(true);
  });

  it('source vira tabela source', () => {
    const raw = model.tables.find((t) => t.name === 'raw_pedido')!;
    expect(raw.resourceType).toBe('source');
    expect(raw.schema).toBe('bronze');
  });

  it('depends_on vira lineage L1', () => {
    const lin = model.lineage?.find((l) => l.target === 'pedido');
    expect(lin?.sources).toContain('raw_pedido');
  });
});

// ---------------------------------------------------------------------------
// 3. Projeto em pasta (schema.yml + .sql) via dbtFilesToModel
// ---------------------------------------------------------------------------

describe('dbtFilesToModel (projeto em pasta)', () => {
  const files = [
    { file: 'dbt_project.yml', content: 'name: shop\nprofile: shop\n' },
    { file: 'models/prata/schema.yml', content: SCHEMA_YML },
    {
      file: 'models/prata/pedido.sql',
      content:
        "{{ config(materialized='incremental') }}\nwith raw_pedido as (\n  select * from {{ source('bronze', 'raw_pedido') }}\n)\nselect * from raw_pedido\n",
    },
  ];
  const model = dbtFilesToModel(files)!;

  it('detecta projeto e extrai a tabela do schema.yml', () => {
    expect(model).not.toBeNull();
    expect(model.tables.find((t) => t.name === 'pedido')).toBeDefined();
  });

  it('extrai lineage de ref()/source() do SQL com nomes qualificados', () => {
    const lin = model.lineage?.find((l) => l.target === 'prata.pedido');
    expect(lin?.sources).toContain('bronze.raw_pedido');
  });

  it('retorna null quando não há artefatos dbt', () => {
    expect(dbtFilesToModel([{ file: 'a.sql', content: 'create table t (id int);' }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Round-trip com F2 (export → import preserva semântica)
// ---------------------------------------------------------------------------

describe('round-trip dbt: export (F2) → import (F3)', () => {
  function richModel(): Model {
    return {
      tables: [
        {
          name: 'raw_pedido', schema: 'bronze', resourceType: 'source',
          columns: [{ name: 'id', type: 'bigint', pk: true, nullable: false }],
        },
        {
          name: 'pedido', schema: 'prata', materialization: 'incremental', tags: ['vendas'],
          note: 'Pedidos',
          columns: [
            { name: 'id', type: 'bigint', pk: true, nullable: false },
            { name: 'cliente_id', type: 'bigint', nullable: false },
            { name: 'status', type: 'string', tests: [{ kind: 'accepted_values', values: ['a', 'b'] }] },
          ],
        },
        {
          name: 'dim_cliente', schema: 'ouro', materialization: 'table',
          columns: [{ name: 'id', type: 'bigint', pk: true, nullable: false }],
        },
      ],
      refs: [{ from: { table: 'pedido', column: 'cliente_id' }, to: { table: 'dim_cliente', column: 'id' }, kind: '>' }],
      lineage: [{ target: 'pedido', sources: ['raw_pedido'] }],
    };
  }

  it('preserva materialization, tags, accepted_values, FK e source', () => {
    const files = modelToDbtFiles(richModel()).map((f) => ({ file: f.path, content: f.content }));
    const back = dbtFilesToModel(files)!;

    const pedido = back.tables.find((t) => t.name === 'pedido')!;
    expect(pedido.materialization).toBe('incremental');
    expect(pedido.tags).toEqual(['vendas']);
    const status = pedido.columns.find((c) => c.name === 'status')!;
    expect(status.tests).toEqual([{ kind: 'accepted_values', values: ['a', 'b'] }]);

    const raw = back.tables.find((t) => t.name === 'raw_pedido')!;
    expect(raw.resourceType).toBe('source');

    const ref = back.refs.find((r) => r.from.table === 'pedido' && r.from.column === 'cliente_id');
    expect(ref!.to).toEqual({ table: 'dim_cliente', column: 'id' });
  });
});

// ---------------------------------------------------------------------------
// 5. Fixtures genéricas de examples/dbt (pasta e manifest concordam)
// ---------------------------------------------------------------------------

describe('fixtures examples/dbt', () => {
  async function readFolder(): Promise<{ file: string; content: string }[]> {
    const out: { file: string; content: string }[] = [];
    const walk = async (dir: string) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (/\.(ya?ml|sql)$/i.test(e.name) && e.name !== 'manifest.json') {
          out.push({ file: path.relative(EXAMPLES, full), content: await fs.readFile(full, 'utf8') });
        }
      }
    };
    await walk(EXAMPLES);
    return out;
  }

  it('projeto em pasta parseia orders/customers/raw_* com lineage', async () => {
    const model = dbtFilesToModel(await readFolder())!;
    const names = model.tables.map((t) => t.name).sort();
    expect(names).toEqual(['customers', 'orders', 'raw_customers', 'raw_orders']);
    expect(model.tables.find((t) => t.name === 'raw_orders')!.resourceType).toBe('source');
    const lin = model.lineage?.find((l) => l.target === 'marts.orders');
    expect(lin?.sources).toEqual(expect.arrayContaining(['raw.raw_orders', 'marts.customers']));
  });

  it('manifest.json produz as mesmas tabelas e a FK orders→customers', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(EXAMPLES, 'manifest.json'), 'utf8'));
    const model = manifestToModel(manifest);
    const names = model.tables.map((t) => t.name).sort();
    expect(names).toEqual(['customers', 'orders', 'raw_customers', 'raw_orders']);
    const ref = model.refs.find((r) => r.from.table === 'orders' && r.from.column === 'customer_id');
    expect(ref!.to).toEqual({ table: 'customers', column: 'id' });
  });
});
