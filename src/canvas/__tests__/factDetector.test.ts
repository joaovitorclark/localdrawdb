import { describe, it, expect } from 'vitest';
import { detectFact, computeDegrees, bfsLayers } from '../factDetector';
import type { ParseResult, TableView } from '../../dsl/parse';

function tv(id: string, group?: string): TableView {
  return {
    id,
    name: id.split('.').pop()!,
    schema: id.includes('.') ? id.split('.')[0] : undefined,
    group,
    columns: [],
  };
}

describe('detectFact', () => {
  it('retorna null em modelo vazio', () => {
    expect(detectFact({ tables: [], refs: [], records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {} })).toBeNull();
  });

  it('prefere group:fact explícito', () => {
    const parsed: ParseResult = {
      tables: [tv('sales.orders'), tv('sales.orders_fact', 'fact'), tv('sales.customers')],
      refs: [
        { id: 'r1', source: 'sales.orders_fact', target: 'sales.customers' },
        { id: 'r2', source: 'sales.orders_fact', target: 'sales.orders' },
      ],
      records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {},
    };
    const r = detectFact(parsed);
    expect(r?.id).toBe('sales.orders_fact');
    expect(r?.reason).toBe('group:fact');
  });

  it('cai para fan-out quando não há group:fact', () => {
    const parsed: ParseResult = {
      tables: [tv('fato'), tv('d1'), tv('d2'), tv('d3')],
      refs: [
        { id: 'r1', source: 'fato', target: 'd1' },
        { id: 'r2', source: 'fato', target: 'd2' },
        { id: 'r3', source: 'fato', target: 'd3' },
      ],
      records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {},
    };
    const r = detectFact(parsed);
    expect(r?.id).toBe('fato');
    expect(r?.reason).toBe('fk-fanout');
  });

  it('cai para grau total quando ninguém tem outgoing > 0', () => {
    const parsed: ParseResult = {
      tables: [tv('a'), tv('b'), tv('c')],
      // grafo onde ninguém tem outgoing > 1, mas c tem mais incoming
      refs: [
        { id: 'r1', source: 'a', target: 'c' },
        { id: 'r2', source: 'b', target: 'c' },
      ],
      records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {},
    };
    const r = detectFact(parsed);
    // Todos têm outgoing ≤ 1, então cai para total-degree.
    // c tem grau total 2 (in=2, out=0); a tem 1; b tem 1.
    expect(r?.id).toBe('c');
    expect(r?.reason).toBe('total-degree');
  });

  it('usa fan-out quando alguma tabela tem outgoing > 1', () => {
    const parsed: ParseResult = {
      tables: [tv('a'), tv('b'), tv('c')],
      refs: [
        // c tem outgoing 2 (mais que qualquer outro)
        { id: 'r1', source: 'c', target: 'a' },
        { id: 'r2', source: 'c', target: 'b' },
      ],
      records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {},
    };
    const r = detectFact(parsed);
    expect(r?.id).toBe('c');
    expect(r?.reason).toBe('fk-fanout');
  });
});

describe('computeDegrees', () => {
  it('conta out/in corretamente', () => {
    const tables = [tv('a'), tv('b'), tv('c')];
    const refs = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'c' },
    ];
    const { out, inc } = computeDegrees(tables, refs);
    expect(out.get('a')).toBe(2);
    expect(out.get('b')).toBe(1);
    expect(out.get('c')).toBe(0);
    expect(inc.get('a')).toBe(0);
    expect(inc.get('b')).toBe(1);
    expect(inc.get('c')).toBe(2);
  });

  it('ignora refs que apontam para tabelas fora do conjunto', () => {
    const tables = [tv('a'), tv('b')];
    const refs = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'ghost' },
    ];
    const { out, inc } = computeDegrees(tables, refs);
    expect(out.get('a')).toBe(1);
    expect(inc.get('ghost')).toBeUndefined();
  });
});

describe('bfsLayers', () => {
  it('atribui camadas incrementais via BFS', () => {
    const tables = [tv('fato'), tv('d1'), tv('d2'), tv('sd1')];
    const refs = [
      { source: 'fato', target: 'd1' },
      { source: 'fato', target: 'd2' },
      { source: 'd1', target: 'sd1' },
    ];
    const layers = bfsLayers('fato', tables, refs);
    expect(layers.get('fato')).toBe(0);
    expect(layers.get('d1')).toBe(1);
    expect(layers.get('d2')).toBe(1);
    expect(layers.get('sd1')).toBe(2);
  });

  it('detecta ciclo e não trava', () => {
    const tables = [tv('a'), tv('b')];
    const refs = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ];
    const layers = bfsLayers('a', tables, refs);
    expect(layers.get('a')).toBe(0);
    expect(layers.get('b')).toBe(1);
  });

  it('tabelas isoladas vão para a camada após o máximo', () => {
    const tables = [tv('a'), tv('b'), tv('orphan')];
    const refs = [{ source: 'a', target: 'b' }];
    const layers = bfsLayers('a', tables, refs);
    expect(layers.get('orphan')).toBe(2);
  });
});