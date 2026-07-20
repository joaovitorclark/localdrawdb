import { describe, it, expect } from 'vitest';
import { renderDiagramSvg } from '../exportDiagramSvg';
import type { ParseResult } from '../../dsl/parse';

function tv(id: string, group?: string): ParseResult['tables'][number] {
  return {
    id,
    name: id.split('.').pop()!,
    schema: id.includes('.') ? id.split('.')[0] : undefined,
    group,
    columns: [
      { name: 'id', type: 'bigint', pk: true, notNull: true },
      { name: 'name', type: 'string', pk: false, notNull: false },
    ],
  };
}

function sampleModel(): ParseResult {
  return {
    tables: [
      tv('sales.orders'),
      tv('sales.customers'),
      tv('sales.products'),
    ],
    refs: [
      { id: 'r1', source: 'sales.orders', target: 'sales.customers', label: 'orders.customer_id > customers.id', fromCol: 'customer_id', toCol: 'id', fromRel: '*', toRel: '1' },
      { id: 'r2', source: 'sales.orders', target: 'sales.products', label: 'orders.product_id > products.id', fromCol: 'product_id', toCol: 'id', fromRel: '*', toRel: '1' },
    ],
    records: [],
    layerGroups: [],
    lineage: [],
    lineageFields: [],
    rolenames: [],
    colors: { 'sales.orders': '#b91c1c' },
  };
}

describe('renderDiagramSvg', () => {
  it('gera SVG válido', () => {
    const { svg } = renderDiagramSvg({
      parsed: sampleModel(),
      positions: {
        'sales.orders': { x: 0, y: 0 },
        'sales.customers': { x: 300, y: 0 },
        'sales.products': { x: 600, y: 0 },
      },
      scope: 'full',
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('</svg>');
  });

  it('inclui todas as tabelas no scope full', () => {
    const { svg } = renderDiagramSvg({
      parsed: sampleModel(),
      positions: {
        'sales.orders': { x: 0, y: 0 },
        'sales.customers': { x: 300, y: 0 },
        'sales.products': { x: 600, y: 0 },
      },
      scope: 'full',
    });
    expect(svg).toContain('sales.orders');
    expect(svg).toContain('sales.customers');
    expect(svg).toContain('sales.products');
  });

  it('filtra por scope selection', () => {
    const { svg } = renderDiagramSvg({
      parsed: sampleModel(),
      positions: {
        'sales.orders': { x: 0, y: 0 },
        'sales.customers': { x: 300, y: 0 },
        'sales.products': { x: 600, y: 0 },
      },
      selectedIds: new Set(['sales.orders']),
      scope: 'selection',
    });
    expect(svg).toContain('sales.orders');
    expect(svg).not.toContain('sales.customers');
    expect(svg).not.toContain('sales.products');
  });

  it('retorna SVG mínimo quando não há tabelas', () => {
    const empty: ParseResult = { ...sampleModel(), tables: [], refs: [] };
    const { svg, width, height } = renderDiagramSvg({
      parsed: empty,
      positions: {},
      scope: 'full',
    });
    expect(svg).toContain('<svg');
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('desenha edges (refs) como paths SVG', () => {
    const { svg } = renderDiagramSvg({
      parsed: sampleModel(),
      positions: {
        'sales.orders': { x: 0, y: 0 },
        'sales.customers': { x: 300, y: 0 },
        'sales.products': { x: 600, y: 0 },
      },
      scope: 'full',
    });
    expect(svg).toContain('<path');
    expect(svg).toContain('marker-end="url(#arrow)"');
  });

  it('respeita posições negativas (deslocamento para positivo)', () => {
    const { width, height } = renderDiagramSvg({
      parsed: sampleModel(),
      positions: {
        'sales.orders': { x: -100, y: -50 },
        'sales.customers': { x: 200, y: -50 },
        'sales.products': { x: 500, y: -50 },
      },
      scope: 'full',
    });
    expect(width).toBeGreaterThan(600);
    expect(height).toBeGreaterThan(50);
  });

  it('usa cor customizada do cabeçalho', () => {
    const { svg } = renderDiagramSvg({
      parsed: sampleModel(),
      positions: {
        'sales.orders': { x: 0, y: 0 },
        'sales.customers': { x: 300, y: 0 },
        'sales.products': { x: 600, y: 0 },
      },
      colors: { 'sales.orders': '#ff0000' },
      scope: 'full',
    });
    expect(svg).toContain('fill="#ff0000"');
  });

  it('edges saem da linha da coluna correta (não do meio da tabela)', () => {
    // Modelo onde orders tem customer_id na 3ª linha (índice 2).
    const model: ParseResult = {
      ...sampleModel(),
      tables: [
        {
          ...tv('sales.orders'),
          columns: [
            { name: 'id', type: 'bigint', pk: true, notNull: true },
            { name: 'name', type: 'string', pk: false, notNull: false },
            { name: 'customer_id', type: 'bigint', pk: false, notNull: false },
          ],
        },
        tv('sales.customers'),
        tv('sales.products'),
      ],
    };
    const { svg } = renderDiagramSvg({
      parsed: model,
      positions: {
        'sales.orders': { x: 0, y: 0 },
        'sales.customers': { x: 300, y: 0 },
        'sales.products': { x: 600, y: 0 },
      },
      scope: 'full',
    });
    // Y esperado para a coluna customer_id (índice 2):
    // HEADER_H (26) + 2 * ROW_H (20) + ROW_H/2 (10) = 76.
    // Antes do fix era 38 (HEADER + 12) — bug.
    // Extrai todos os Y usados nos paths e confirma que 76 aparece
    // (mas não 38 do bug original).
    const yValues = [...svg.matchAll(/C [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(yValues).toContain(76);
    expect(yValues).not.toContain(38);
  });
});