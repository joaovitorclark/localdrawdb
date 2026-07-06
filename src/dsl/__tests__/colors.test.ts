import { describe, expect, it } from 'vitest';
import { splitDbmlBlocks } from '../blocks';
import { parseColorsBlock, cleanDbml } from '../dbmlClean';
import { parseDbml } from '../parse';
import { setTableColor, setGroupColor, setColumnColor } from '../edit';

describe('bloco Colors', () => {
  it('tokeniza como colors', () => {
    const blocks = splitDbmlBlocks('Colors {\n  a.b: #b08d57\n}\n');
    expect(blocks.some((x) => x.type === 'colors')).toBe(true);
  });
  it('parseColorsBlock parseia table: #hex', () => {
    expect(parseColorsBlock('Colors {\n  silver.fato: #b08d57\n}')).toEqual([
      { table: 'silver.fato', color: '#b08d57' },
    ]);
  });
  it('cleanDbml remove o bloco (DDL ignora)', () => {
    const src = 'Table t {\n  id int\n}\nColors {\n  t: #ffffff\n}';
    expect(cleanDbml(src)).not.toMatch(/Colors/i);
  });
  it('parseDbml expõe colors como record', () => {
    const src = 'Table t {\n  id int\n}\nColors {\n  t: #b08d57\n}';
    expect(parseDbml(src).colors).toEqual({ t: '#b08d57' });
  });
});

describe('setTableColor', () => {
  it('cria o bloco e adiciona a cor', () => {
    const out = setTableColor('Table t {\n  id int\n}\n', 't', '#b08d57');
    expect(out).toMatch(/Colors\s*\{/);
    expect(out).toContain('t: #b08d57');
  });
  it('atualiza a cor existente sem duplicar', () => {
    const a = setTableColor('', 't', '#111111');
    const b = setTableColor(a, 't', '#222222');
    expect((b.match(/t:/g) ?? []).length).toBe(1);
    expect(b).toContain('t: #222222');
  });
  it('remove com color=null (e o bloco se ficar vazio)', () => {
    const a = setTableColor('', 't', '#111111');
    const out = setTableColor(a, 't', null);
    expect(out).not.toMatch(/Colors/i);
  });
});

describe('cor de grupo (TableGroup)', () => {
  it('setGroupColor grava @grupo no bloco Colors', () => {
    const out = setGroupColor('Table t {\n  id int\n}\n', 'fatos_largos', '#b08d57');
    expect(out).toContain('@fatos_largos: #b08d57');
  });
  it('parseDbml expõe a cor de grupo em colors["@grupo"] sem colidir com tabela', () => {
    const src = 'Table t {\n  id int\n}\nColors {\n  t: #111111\n  @fatos_largos: #b08d57\n}';
    const c = parseDbml(src).colors;
    expect(c['t']).toBe('#111111');
    expect(c['@fatos_largos']).toBe('#b08d57');
  });
});

describe('cor de coluna (campo)', () => {
  it('setColumnColor grava tabela.coluna no bloco Colors', () => {
    const out = setColumnColor('Table gold.dim_product {\n  category string\n}\n', 'gold.dim_product', 'category', '#dc2626');
    expect(out).toContain('gold.dim_product.category: #dc2626');
  });
  it('parseDbml expõe a cor da coluna em column.color sem colidir com a tabela', () => {
    const src = 'Table gold.dim_product {\n  category string\n}\nColors {\n  gold.dim_product: #eeeeee\n  gold.dim_product.category: #dc2626\n}';
    const parsed = parseDbml(src);
    expect(parsed.colors['gold.dim_product']).toBe('#eeeeee');
    const col = parsed.tables[0].columns.find((c) => c.name === 'category');
    expect(col?.color).toBe('#dc2626');
  });
});
