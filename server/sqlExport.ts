// Export reverso: modelo canônico → SQL no formato data/input/ (Spark ou Oracle).
import { qualifiedName, pkCols, typeToOracle, typeToSpark } from './model.ts';
import type { Column, FieldLineageEntry, Model, Ref, Table } from './model.ts';

export type InputDialect = 'spark' | 'oracle' | 'auto';

const SPARK_LAYERS = new Set(['bronze', 'prata', 'silver', 'gold', 'raw', 'staging_spark']);

function resolveDialect(table: Table, requested: InputDialect): 'spark' | 'oracle' {
  if (requested === 'spark' || requested === 'oracle') return requested;
  const layer = table.layer?.toLowerCase();
  const schema = table.schema?.toLowerCase();
  if (layer && !SPARK_LAYERS.has(layer) && layer !== 'bronze' && layer !== 'prata') {
    if (schema === 'staging' || layer === 'oracle') return 'oracle';
  }
  if (schema === 'staging' && table.columns.some((c) => c.type === 'varchar2' || /^number/i.test(c.type))) {
    return 'oracle';
  }
  if (table.columns.some((c) => /varchar2/i.test(c.type))) return 'oracle';
  return 'spark';
}

function sqlQuote(val: string): string {
  if (/^-?\d+(\.\d+)?$/.test(val)) return val;
  if (/^(true|false|null)$/i.test(val)) return val.toUpperCase();
  if (/^TIMESTAMP\s+'/i.test(val)) return val;
  return `'${val.replace(/'/g, "''")}'`;
}

function refsForTable(model: Model, t: Table): Ref[] {
  const qn = qualifiedName(t);
  return model.refs.filter((r) => r.from.table === qn || r.from.table === t.name);
}

function lineageSourcesForTable(model: Model, t: Table): string[] {
  const qn = qualifiedName(t);
  const entry = model.lineage?.find(
    (l) => l.target === qn || l.target.toLowerCase() === qn.toLowerCase(),
  );
  return entry?.sources ?? [];
}

function fieldMapsForTable(model: Model, t: Table): Map<string, FieldLineageEntry> {
  const qn = qualifiedName(t);
  const map = new Map<string, FieldLineageEntry>();
  for (const field of model.lineageFields ?? []) {
    if (
      field.targetTable === qn ||
      field.targetTable.toLowerCase() === qn.toLowerCase() ||
      field.targetTable === t.name
    ) {
      map.set(field.targetColumn, field);
    }
  }
  return map;
}

function formatMapMeta(field: FieldLineageEntry): string {
  const parts: string[] = [];
  if (field.note) parts.push(`note: '${field.note.replace(/'/g, "''")}'`);
  if (field.ref) parts.push(`ref: '${field.ref.replace(/'/g, "''")}'`);
  return parts.length ? ` [${parts.join(', ')}]` : '';
}

function columnCode(c: Column, type: string): string {
  const nn = c.nullable === false ? ' NOT NULL' : '';
  return `  ${c.name} ${type}${nn}`;
}

/** Linha de coluna/constraint. Vírgula separadora vem ANTES do comentário inline. */
type BodyEntry = { code: string; comment?: string };

function assembleBody(entries: BodyEntry[]): string {
  return entries
    .map((e, i) => {
      const sep = i < entries.length - 1 ? ',' : '';
      const cmt = e.comment ? ` -- ${e.comment}` : '';
      return `${e.code}${sep}${cmt}`;
    })
    .join('\n');
}

/** Bloco-rodapé de linhagem L2 (formato novo, após o CREATE TABLE). */
function emitLineageFooter(t: Table, fieldMaps: Map<string, FieldLineageEntry>): string[] {
  if (!fieldMaps.size) return [];
  const lines = [`-- @lineage ${qualifiedName(t)}`];
  for (const c of t.columns) {
    const f = fieldMaps.get(c.name);
    if (!f) continue;
    lines.push(`--   ${c.name} <- ${f.sourceTable}.${f.sourceColumn}${formatMapMeta(f)}`);
  }
  return lines.length > 1 ? lines : [];
}

function emitMetaComments(t: Table, refs: Ref[], lineageSources: string[]): string[] {
  const lines: string[] = [];
  if (t.layer) lines.push(`-- @layer: ${t.layer}`);
  if (t.group) lines.push(`-- @group: ${t.group}`);
  if (t.note && (t.noteInRecordsOnly || t.records?.rows.length)) {
    lines.push(`-- @note: ${t.note}`);
  }
  if (lineageSources.length) {
    lines.push(`-- @origen: ${lineageSources.join(', ')}`);
  }
  for (const r of refs) {
    lines.push(`-- @fk: ${r.from.column} -> ${r.to.table}.${r.to.column}`);
  }
  return lines;
}

function sparkCreateTable(t: Table): string {
  const qn = qualifiedName(t);
  const pk = pkCols(t);
  const singlePk = pk.length === 1 ? pk[0] : null;
  const entries: BodyEntry[] = t.columns.map((c) => {
    const type = typeToSpark(c);
    const col = singlePk === c.name ? { ...c, nullable: false } : c;
    return { code: columnCode(col, type), comment: c.note || undefined };
  });
  if (pk.length) entries.push({ code: `  PRIMARY KEY (${pk.join(', ')})` });
  return `CREATE TABLE IF NOT EXISTS ${qn} (\n${assembleBody(entries)}\n) USING DELTA;`;
}

function oracleCreateTable(t: Table, refs: Ref[]): string {
  const qn = qualifiedName(t);
  const pk = pkCols(t);
  const shortName = t.name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 20);
  // Oracle: descrição de coluna vai em COMMENT ON COLUMN (não inline).
  const entries: BodyEntry[] = t.columns.map((c) => ({ code: columnCode(c, typeToOracle(c)) }));
  if (pk.length) {
    entries.push({ code: `  CONSTRAINT pk_${shortName} PRIMARY KEY (${pk.join(', ')})` });
  }
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    entries.push({
      code:
        `  CONSTRAINT fk_${shortName}_${i + 1} FOREIGN KEY (${r.from.column})\n` +
        `    REFERENCES ${r.to.table} (${r.to.column})`,
    });
  }
  return `CREATE TABLE ${qn} (\n${assembleBody(entries)}\n);`;
}

function emitInserts(t: Table, dialect: 'spark' | 'oracle'): string[] {
  if (!t.records?.rows.length) return [];
  const qn = qualifiedName(t);
  const cols = t.records.columns.length ? t.records.columns : t.columns.map((c) => c.name);
  const header = `INSERT INTO ${qn} (${cols.join(', ')})`;
  return t.records.rows.map((row) => {
    const vals = row.map(sqlQuote).join(', ');
    return `${header}\nVALUES (${vals});`;
  });
}

function tableToSql(t: Table, model: Model, dialect: InputDialect): string {
  const resolved = resolveDialect(t, dialect);
  const refs = refsForTable(model, t);
  const lineageSources = lineageSourcesForTable(model, t);
  const fieldMaps = fieldMapsForTable(model, t);
  const parts: string[] = [];
  const meta = emitMetaComments(t, refs, lineageSources);
  if (meta.length) parts.push(...meta);
  parts.push(resolved === 'oracle' ? oracleCreateTable(t, refs) : sparkCreateTable(t));
  if (t.note && resolved === 'oracle' && !t.noteInRecordsOnly) {
    parts.push(`COMMENT ON TABLE ${qualifiedName(t)} IS '${t.note.replace(/'/g, "''")}';`);
  }
  for (const c of t.columns) {
    if (c.note && resolved === 'oracle') {
      parts.push(
        `COMMENT ON COLUMN ${qualifiedName(t)}.${c.name} IS '${c.note.replace(/'/g, "''")}';`,
      );
    }
  }
  parts.push(...emitLineageFooter(t, fieldMaps));
  parts.push(...emitInserts(t, resolved));
  return parts.join('\n');
}

/**
 * Rodapé de cores (comentado, SQL válido) — espelha o bloco DBML `Colors {}` e as
 * cores de LayerGroup, filtrado às tabelas presentes no arquivo:
 *   -- @colors
 *   --   silver.dim_cliente: #b08d57
 *   -- @layercolors
 *   --   prata: #c0c0c0
 */
function emitColorsFooter(model: Model, tables: Table[]): string[] {
  const tableKeys = new Set(tables.map((t) => qualifiedName(t).toLowerCase()));
  const groupKeys = new Set(
    tables.flatMap((t) => (t.group ? [t.group.toLowerCase()] : [])),
  );
  const layerKeys = new Set(
    tables.flatMap((t) => (t.layer ? [t.layer.toLowerCase()] : [])),
  );

  const colorLines: string[] = [];
  for (const [key, color] of Object.entries(model.colors ?? {})) {
    const lower = key.toLowerCase();
    const belongs = key.startsWith('@')
      ? groupKeys.has(lower.slice(1))
      : tableKeys.has(lower) ||
        (lower.includes('.') && tableKeys.has(lower.slice(0, lower.lastIndexOf('.'))));
    if (belongs) colorLines.push(`--   ${key}: ${color}`);
  }

  const layerLines: string[] = [];
  for (const [layer, color] of Object.entries(model.layerColors ?? {})) {
    if (layerKeys.has(layer.toLowerCase())) layerLines.push(`--   ${layer}: ${color}`);
  }

  const out: string[] = [];
  if (colorLines.length) out.push('-- @colors', ...colorLines);
  if (layerLines.length) out.push('-- @layercolors', ...layerLines);
  return out;
}

/** Gera SQL no formato input/ para um dialeto (ou auto por tabela). */
export function modelToInputSql(model: Model, dialect: InputDialect = 'spark'): string {
  const chunks = model.tables.map((t) => tableToSql(t, model, dialect));
  const footer = emitColorsFooter(model, model.tables);
  if (footer.length) chunks.push(footer.join('\n'));
  return chunks.filter(Boolean).join('\n\n') + '\n';
}

/** Agrupa por dialeto resolvido (útil para export misto). */
export function modelToInputSqlByDialect(model: Model): { spark: string; oracle: string } {
  const sparkTables: string[] = [];
  const oracleTables: string[] = [];
  const sparkModelTables: Table[] = [];
  const oracleModelTables: Table[] = [];
  for (const t of model.tables) {
    const sql = tableToSql(t, model, 'auto');
    if (resolveDialect(t, 'auto') === 'oracle') {
      oracleTables.push(sql);
      oracleModelTables.push(t);
    } else {
      sparkTables.push(sql);
      sparkModelTables.push(t);
    }
  }
  const sparkFooter = emitColorsFooter(model, sparkModelTables);
  if (sparkFooter.length) sparkTables.push(sparkFooter.join('\n'));
  const oracleFooter = emitColorsFooter(model, oracleModelTables);
  if (oracleFooter.length) oracleTables.push(oracleFooter.join('\n'));
  return {
    spark: sparkTables.join('\n\n') + (sparkTables.length ? '\n' : ''),
    oracle: oracleTables.join('\n\n') + (oracleTables.length ? '\n' : ''),
  };
}
