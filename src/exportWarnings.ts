import type { ParsedFieldLineage, ParsedLineage, TableView } from './dsl/parse';

/** Conta colunas em tabelas silver/prata sem mapeamento L2 no modelo. */
export function countSilverColumnsWithoutL2(
  tables: TableView[],
  lineageFields: ParsedFieldLineage[],
): number {
  const mapped = new Set(
    lineageFields.map((f) => `${f.targetTable}.${f.targetColumn}`.toLowerCase()),
  );
  let count = 0;
  for (const t of tables) {
    const isSilver = t.id.startsWith('silver.');
    if (!isSilver) continue;
    for (const c of t.columns) {
      if (!mapped.has(`${t.id}.${c.name}`.toLowerCase())) count++;
    }
  }
  return count;
}

/**
 * Aviso do export LocalDrawDB sobre linhagem de campos (L2). O export sempre inclui
 * a linhagem que existe no modelo — este aviso só sinaliza o que NÃO existe para
 * exportar (LineageFields ausentes ou incompletos nas tabelas silver).
 */
export function exportInputL2Warning(
  tables: TableView[],
  lineageFields: ParsedFieldLineage[],
  lineage: ParsedLineage[] = [],
): string | null {
  if (!lineageFields.length) {
    if (lineage.length) {
      return 'Aviso: linhagem de campos (L2) não incluída — modelo sem LineageFields; a linhagem de tabelas (L1) foi exportada. Edite Mapeamentos L2 para o nível campo→campo.';
    }
    return 'Aviso: export sem linhagem — modelo sem Lineage e LineageFields. Edite Mapeamentos L2 ou importe SQL com @lineage.';
  }
  const missing = countSilverColumnsWithoutL2(tables, lineageFields);
  if (missing === 0) return null;
  return `Aviso: ${missing} coluna(s) silver sem mapeamento L2 — o restante da linhagem foi exportado. Edite Mapeamentos L2 ou importe SQL com @lineage.`;
}
