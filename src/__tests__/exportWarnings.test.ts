import { describe, expect, it } from 'vitest';
import { exportInputL2Warning } from '../exportWarnings';
import type { ParsedFieldLineage, ParsedLineage, TableView } from '../dsl/parse';

const table = (id: string, cols: string[]): TableView =>
  ({ id, columns: cols.map((name) => ({ name })) }) as unknown as TableView;

const l2 = (t: string, c: string): ParsedFieldLineage =>
  ({ targetTable: t, targetColumn: c, sourceTable: 'raw.x', sourceColumn: 'y' }) as ParsedFieldLineage;

const l1: ParsedLineage[] = [{ target: 'silver.fato', sources: ['raw.origem'] }];

describe('exportInputL2Warning', () => {
  it('null quando o L2 cobre as colunas silver (nada a avisar)', () => {
    const t = table('silver.fato', ['a']);
    expect(exportInputL2Warning([t], [l2('silver.fato', 'a')], l1)).toBeNull();
  });

  it('sem LineageFields mas com L1: avisa que só o nível de campos falta (L1 foi exportada)', () => {
    const msg = exportInputL2Warning([table('silver.fato', ['a'])], [], l1);
    expect(msg).toContain('L2');
    expect(msg).toContain('L1');
    expect(msg).toMatch(/exportada/i);
    expect(msg).not.toMatch(/^Export sem linhagem/);
  });

  it('sem L1 e sem L2: avisa export sem linhagem alguma', () => {
    const msg = exportInputL2Warning([table('silver.fato', ['a'])], [], []);
    expect(msg).toMatch(/sem linhagem/i);
    expect(msg).toContain('Lineage');
  });

  it('L2 parcial: conta as colunas silver faltantes e diz que o resto foi exportado', () => {
    const t = table('silver.fato', ['a', 'b', 'c']);
    const msg = exportInputL2Warning([t], [l2('silver.fato', 'a')], l1);
    expect(msg).toContain('2 coluna(s)');
    expect(msg).toMatch(/exportad/i);
  });

  it('modelo sem tabelas silver e sem L2, com L1: mensagem de L2 ausente (não a de "sem linhagem")', () => {
    const msg = exportInputL2Warning([table('gold.dim', ['a'])], [], l1);
    expect(msg).toContain('L2');
    expect(msg).not.toMatch(/^Export sem linhagem/);
  });
});
