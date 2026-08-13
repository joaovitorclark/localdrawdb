import { lineOfColumn, lineOfGroupMember, lineOfRef, lineOfTable } from './lineLocate';
import { splitDbmlBlocks, type Block } from './blocks';
import type { ParseResult } from './parse';
import { resolveMemberTableIds } from './tableIdMatch';

export type ModelIssue = {
  severity: 'error' | 'warn';
  message: string;
  tableId?: string;
  /** Linha 0-based no editor. */
  line?: number;
};

const stripQuotes = (s: string) => s.replace(/["`']/g, '').trim();

/** Valida refs, PKs e linhagem após o parse do DBML. */
export function validateModel(parsed: ParseResult, dbml?: string, blocks?: Block[]): ModelIssue[] {
  if (parsed.error) {
    return [{ severity: 'error', message: parsed.error, line: parsed.errorLine }];
  }

  const issues: ModelIssue[] = [];
  const tableIds = parsed.tables.map((t) => t.id);
  const tableIdSet = new Set(tableIds);
  // Mesmas regras de membership (#35): qualificado = exact; short name só se inequívoco.
  const hasTable = (id: string) => resolveMemberTableIds(id, tableIds).length > 0;

  for (const lg of parsed.layerGroups) {
    for (const member of lg.tables) {
      if (hasTable(member)) continue;
      issues.push({
        severity: 'error',
        message: `LayerGroup "${lg.name}": tabela inexistente "${member}"`,
        tableId: member,
        line: dbml ? lineOfGroupMember(dbml, member, blocks) : undefined,
      });
    }
  }

  // TableGroup: membros devem resolver com as mesmas regras usadas em applyTableGroupMembership.
  if (dbml) {
    const blks = blocks ?? splitDbmlBlocks(dbml);
    for (const b of blks) {
      if (b.type !== 'tableGroup' || !b.name) continue;
      const groupName = stripQuotes(b.name);
      const h = /TableGroup\s+("?[^"\s{]+"?)\s*\{/i.exec(b.text);
      if (!h) continue;
      const body = b.text.slice(h.index + h[0].length);
      const end = body.lastIndexOf('}');
      const inner = end >= 0 ? body.slice(0, end) : body;
      for (const rawLine of inner.split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        const member = stripQuotes(trimmed.replace(/,$/, ''));
        if (!member) continue;
        if (hasTable(member)) continue;
        issues.push({
          severity: 'error',
          message: `TableGroup "${groupName}": tabela inexistente "${member}"`,
          tableId: member,
          line: lineOfGroupMember(dbml, member, blks),
        });
      }
    }
  }

  const colsByTable = new Map(
    parsed.tables.map((t) => [t.id, new Set(t.columns.map((c) => c.name))] as const),
  );

  for (const t of parsed.tables) {
    const hasPk =
      t.columns.some((c) => c.pk) || (t.compositePks?.some((g) => g.length > 0) ?? false);
    if (!hasPk) {
      issues.push({
        severity: 'warn',
        message: `Tabela sem PK: ${t.id}`,
        tableId: t.id,
        line: dbml ? lineOfTable(dbml, t.id, blocks) : undefined,
      });
    }
    for (const group of t.compositePks ?? []) {
      for (const col of group) {
        if (!colsByTable.get(t.id)?.has(col)) {
          issues.push({
            severity: 'error',
            message: `PK composta: coluna "${col}" não existe em ${t.id}`,
            tableId: t.id,
            line: dbml ? lineOfTable(dbml, t.id, blocks) : undefined,
          });
        }
      }
    }
  }

  for (const r of parsed.refs) {
    if (!tableIdSet.has(r.source)) {
      issues.push({
        severity: 'error',
        message: `Ref origem inexistente: ${r.source}`,
        tableId: r.source,
      });
    } else if (!colsByTable.get(r.source)?.has(r.fromCol)) {
      issues.push({
        severity: 'error',
        message: `Coluna "${r.fromCol}" não existe em ${r.source}`,
        tableId: r.source,
        line: dbml ? lineOfRef(dbml, r.source, r.fromCol, blocks) : undefined,
      });
    }
    if (!tableIdSet.has(r.target)) {
      issues.push({
        severity: 'error',
        message: `Ref destino inexistente: ${r.target}`,
        tableId: r.target,
      });
    } else if (!colsByTable.get(r.target)?.has(r.toCol)) {
      issues.push({
        severity: 'error',
        message: `Coluna "${r.toCol}" não existe em ${r.target}`,
        tableId: r.target,
        line: dbml ? lineOfRef(dbml, r.target, r.toCol, blocks) : undefined,
      });
    }
  }

  for (const f of parsed.lineageFields ?? []) {
    if (!tableIdSet.has(f.targetTable)) {
      issues.push({
        severity: 'error',
        message: `Linhagem campo: tabela destino inexistente "${f.targetTable}"`,
        tableId: f.targetTable,
      });
    } else if (!colsByTable.get(f.targetTable)?.has(f.targetColumn)) {
      issues.push({
        severity: 'error',
        message: `Linhagem campo: coluna "${f.targetColumn}" não existe em ${f.targetTable}`,
        tableId: f.targetTable,
        line: dbml ? lineOfColumn(dbml, f.targetTable, f.targetColumn, blocks) : undefined,
      });
    }
    if (!tableIdSet.has(f.sourceTable)) {
      issues.push({
        severity: 'error',
        message: `Linhagem campo: tabela origem inexistente "${f.sourceTable}"`,
        tableId: f.sourceTable,
      });
    } else if (!colsByTable.get(f.sourceTable)?.has(f.sourceColumn)) {
      issues.push({
        severity: 'error',
        message: `Linhagem campo: coluna "${f.sourceColumn}" não existe em ${f.sourceTable}`,
        tableId: f.sourceTable,
        line: dbml ? lineOfColumn(dbml, f.sourceTable, f.sourceColumn, blocks) : undefined,
      });
    }
  }

  for (const entry of parsed.lineage) {
    if (!tableIdSet.has(entry.target)) {
      issues.push({
        severity: 'error',
        message: `Linhagem: destino inexistente "${entry.target}"`,
        tableId: entry.target,
      });
    }
    for (const src of entry.sources) {
      if (!tableIdSet.has(src)) {
        issues.push({
          severity: 'error',
          message: `Linhagem: origem inexistente "${src}" → ${entry.target}`,
          tableId: src,
        });
      } else if (src === entry.target) {
        issues.push({
          severity: 'warn',
          message: `Linhagem: self-loop em ${entry.target}`,
          tableId: entry.target,
        });
      }
    }
  }

  return issues;
}
