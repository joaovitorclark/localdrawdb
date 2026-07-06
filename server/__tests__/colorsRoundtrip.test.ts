import { describe, expect, it } from 'vitest';
import { dbmlToModel, modelToDbml } from '../dbmlIo.ts';
import { modelToInputSql, modelToInputSqlByDialect } from '../sqlExport.ts';
import { mergeModel, sqlToModel } from '../sqlImport.ts';
import type { Model } from '../model.ts';

const DBML = `Table silver.dim_cliente {
  cliente_key bigint [pk]
  nome string
}

Table silver.fato_venda {
  venda_key bigint [pk]
  cliente_key bigint
}

Ref: silver.fato_venda.cliente_key > silver.dim_cliente.cliente_key

TableGroup dimensoes {
  silver.dim_cliente
}

LayerGroup prata [color: #c0c0c0] {
  silver.dim_cliente
  silver.fato_venda
}

Colors {
  silver.dim_cliente: #b08d57
  @dimensoes: #112233
  silver.fato_venda.venda_key: #ff0000
}
`;

describe('dbmlToModel — cores', () => {
  it('expõe o bloco Colors como record (tabela, @grupo, coluna)', () => {
    const m = dbmlToModel(DBML);
    expect(m.colors).toEqual({
      'silver.dim_cliente': '#b08d57',
      '@dimensoes': '#112233',
      'silver.fato_venda.venda_key': '#ff0000',
    });
  });
  it('expõe a cor do LayerGroup em layerColors', () => {
    const m = dbmlToModel(DBML);
    expect(m.layerColors).toEqual({ prata: '#c0c0c0' });
  });
  it('omite colors/layerColors quando ausentes', () => {
    const m = dbmlToModel('Table t {\n  id int\n}\n');
    expect(m.colors).toBeUndefined();
    expect(m.layerColors).toBeUndefined();
  });
});

describe('modelToDbml — cores', () => {
  it('emite bloco Colors {} e LayerGroup com [color:]', () => {
    const dbml = modelToDbml(dbmlToModel(DBML));
    expect(dbml).toMatch(/Colors\s*\{/);
    expect(dbml).toContain('silver.dim_cliente: #b08d57');
    expect(dbml).toContain('@dimensoes: #112233');
    expect(dbml).toContain('silver.fato_venda.venda_key: #ff0000');
    expect(dbml).toContain('LayerGroup prata [color: #c0c0c0] {');
  });
  it('não emite Colors quando o modelo não tem cores', () => {
    const dbml = modelToDbml(dbmlToModel('Table t {\n  id int\n}\n'));
    expect(dbml).not.toMatch(/Colors\s*\{/);
  });
  it('round-trip DBML → model → DBML preserva as cores', () => {
    const once = modelToDbml(dbmlToModel(DBML));
    const twice = modelToDbml(dbmlToModel(once));
    expect(twice).toContain('silver.dim_cliente: #b08d57');
    expect(twice).toContain('LayerGroup prata [color: #c0c0c0] {');
  });
});

describe('modelToInputSql — rodapé @colors', () => {
  it('emite rodapé com tabela, grupo, coluna e camada (oracle e spark)', () => {
    const m = dbmlToModel(DBML);
    for (const dialect of ['oracle', 'spark'] as const) {
      const sql = modelToInputSql(m, dialect);
      expect(sql).toMatch(/^-- @colors$/m);
      expect(sql).toContain('--   silver.dim_cliente: #b08d57');
      expect(sql).toContain('--   @dimensoes: #112233');
      expect(sql).toContain('--   silver.fato_venda.venda_key: #ff0000');
      expect(sql).toMatch(/^-- @layercolors$/m);
      expect(sql).toContain('--   prata: #c0c0c0');
    }
  });
  it('não emite rodapé quando não há cores', () => {
    const sql = modelToInputSql(dbmlToModel('Table t {\n  id int\n}\n'), 'oracle');
    expect(sql).not.toContain('@colors');
    expect(sql).not.toContain('@layercolors');
  });
});

describe('modelToInputSqlByDialect — filtro por arquivo', () => {
  it('cada arquivo só recebe cores de tabelas/grupos/camadas presentes nele', () => {
    const dbml = `Table gold.fato {
  id bigint [pk]
}

Table staging.origem {
  id number(10) [pk]
  nome varchar2(50)
}

LayerGroup ouro [color: #ffd700] {
  gold.fato
}

LayerGroup oracle [color: #ee1111] {
  staging.origem
}

Colors {
  gold.fato: #00995d
  staging.origem: #13284b
}
`;
    const { spark, oracle } = modelToInputSqlByDialect(dbmlToModel(dbml));
    expect(spark).toContain('--   gold.fato: #00995d');
    expect(spark).not.toContain('staging.origem: #13284b');
    expect(spark).toContain('--   ouro: #ffd700');
    expect(spark).not.toContain('oracle: #ee1111');
    expect(oracle).toContain('--   staging.origem: #13284b');
    expect(oracle).not.toContain('gold.fato: #00995d');
    expect(oracle).toContain('--   oracle: #ee1111');
  });
});

describe('sqlToModel — leitura do rodapé', () => {
  it('lê @colors e @layercolors de volta para o modelo', () => {
    const sql = modelToInputSql(dbmlToModel(DBML), 'oracle');
    const back = sqlToModel(sql);
    expect(back.colors).toEqual({
      'silver.dim_cliente': '#b08d57',
      '@dimensoes': '#112233',
      'silver.fato_venda.venda_key': '#ff0000',
    });
    expect(back.layerColors).toEqual({ prata: '#c0c0c0' });
  });
  it('chave de tabela inexistente gera warning mas é preservada', () => {
    const sql = 'CREATE TABLE t (\n  id NUMBER(10)\n);\n-- @colors\n--   x.nao_existe: #123456\n';
    const back = sqlToModel(sql);
    expect(back.warnings?.some((w) => w.includes('nao_existe'))).toBe(true);
    expect(back.colors?.['x.nao_existe']).toBe('#123456');
  });
  it('hex inválido é ignorado com warning, sem abortar o bloco', () => {
    const sql =
      'CREATE TABLE t (\n  id NUMBER(10)\n);\n-- @colors\n--   t: #zzz\n--   t.id: #00ff00\n';
    const back = sqlToModel(sql);
    expect(back.colors?.['t']).toBeUndefined();
    expect(back.colors?.['t.id']).toBe('#00ff00');
    expect(back.warnings?.some((w) => w.includes('#zzz'))).toBe(true);
  });
  it('linhagem, notas e records continuam round-trippando junto com as cores', () => {
    const dbml = `${DBML}
Lineage {
  silver.fato_venda < silver.dim_cliente
}

LineageFields {
  silver.fato_venda.cliente_key < silver.dim_cliente.cliente_key [note: 'lookup']
}
`;
    const back = sqlToModel(modelToInputSql(dbmlToModel(dbml), 'oracle'));
    expect(back.lineage).toEqual([
      { target: 'silver.fato_venda', sources: ['silver.dim_cliente'] },
    ]);
    expect(back.lineageFields?.[0]).toMatchObject({
      targetTable: 'silver.fato_venda',
      targetColumn: 'cliente_key',
      sourceTable: 'silver.dim_cliente',
      sourceColumn: 'cliente_key',
      note: 'lookup',
    });
    expect(back.colors?.['silver.dim_cliente']).toBe('#b08d57');
  });
});

describe('mergeModel — cores', () => {
  it('mescla por chave com incoming vencendo', () => {
    const base: Model = {
      tables: [],
      refs: [],
      colors: { 'a.t': '#111111', 'a.u': '#222222' },
      layerColors: { bronze: '#333333' },
    };
    const incoming: Model = {
      tables: [],
      refs: [],
      colors: { 'a.t': '#999999' },
      layerColors: { prata: '#444444' },
    };
    const merged = mergeModel(base, incoming);
    expect(merged.colors).toEqual({ 'a.t': '#999999', 'a.u': '#222222' });
    expect(merged.layerColors).toEqual({ bronze: '#333333', prata: '#444444' });
  });
  it('omite colors quando nenhum lado tem', () => {
    const merged = mergeModel({ tables: [], refs: [] }, { tables: [], refs: [] });
    expect(merged.colors).toBeUndefined();
    expect(merged.layerColors).toBeUndefined();
  });
});

describe('round-trip completo DBML → SQL → model → DBML', () => {
  it('preserva cores de tabela/grupo/coluna/camada', () => {
    const sql = modelToInputSql(dbmlToModel(DBML), 'oracle');
    const dbml = modelToDbml(sqlToModel(sql));
    expect(dbml).toContain('silver.dim_cliente: #b08d57');
    expect(dbml).toContain('@dimensoes: #112233');
    expect(dbml).toContain('silver.fato_venda.venda_key: #ff0000');
    expect(dbml).toContain('LayerGroup prata [color: #c0c0c0] {');
  });
});
