import { describe, it, expect } from 'vitest';
import { modelToLlmContext } from '../ddl/llmContext';
import type { Model } from '../model';

function sampleModel(): Model {
  return {
    tables: [
      {
        name: 'orders',
        schema: 'sales',
        columns: [
          { name: 'id', type: 'bigint', pk: true, nullable: false, note: 'PK da fato' },
          { name: 'customer_id', type: 'bigint', nullable: false },
          {
            name: 'status',
            type: 'string',
            tests: [{ kind: 'accepted_values', values: ['NEW', 'PAID'] }],
          },
        ],
        note: 'Pedidos de venda',
        tags: ['fact'],
      },
    ],
    refs: [],
    layerColors: { gold: '#FFD700' },
  };
}

describe('modelToLlmContext', () => {
  it('produz texto não vazio', () => {
    const out = modelToLlmContext(sampleModel());
    expect(out.length).toBeGreaterThan(0);
  });

  it('inclui cabeçalho com contadores', () => {
    const out = modelToLlmContext(sampleModel());
    expect(out).toMatch(/^# Contexto de modelo de dados/);
    expect(out).toMatch(/Tabelas: 1/);
    expect(out).toMatch(/Relacionamentos: 0/);
  });

  it('lista tabelas com colunas em tabela Markdown', () => {
    const out = modelToLlmContext(sampleModel());
    expect(out).toContain('### sales.orders');
    expect(out).toMatch(/\|\s*coluna\s*\|\s*tipo\s*\|\s*constraints\s*\|\s*descrição\s*\|/);
  });

  it('preserva constraints accepted_values no Markdown', () => {
    const out = modelToLlmContext(sampleModel());
    expect(out).toContain('accepted_values [NEW, PAID]');
  });

  it('inclui bloco JSON parseável', () => {
    const out = modelToLlmContext(sampleModel());
    const m = /```json\n([\s\S]+?)\n```/.exec(out);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1]);
    expect(parsed.tables[0].name).toBe('orders');
    expect(parsed.tables[0].columns.length).toBe(3);
  });

  it('inclui seção de camadas quando há layerColors', () => {
    const out = modelToLlmContext(sampleModel());
    expect(out).toContain('## Camadas');
    expect(out).toContain('| gold |');
  });

  it('omite seção de camadas quando vazia', () => {
    const m: Model = { tables: [], refs: [] };
    const out = modelToLlmContext(m);
    expect(out).not.toContain('## Camadas');
  });
});