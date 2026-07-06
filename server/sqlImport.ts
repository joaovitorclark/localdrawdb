// Import de arquivos .sql (Spark/Hive, Oracle, ANSI) -> modelo canônico.
import { createRequire } from 'node:module';
import { parseTypeName, qualifiedName } from './model.ts';
import type { Column, FieldLineageEntry, LineageEntry, Model, Ref, Table } from './model.ts';

const require = createRequire(import.meta.url);
const { Parser } = require('node-sql-parser') as { Parser: new () => { astify: Function } };

const sqlParser = new Parser();

export type SqlDialect = 'oracle' | 'spark' | 'ansi';

export function detectSqlDialect(sql: string): SqlDialect {
  if (/VARCHAR2|NUMBER\s*\(|COMMENT\s+ON|TABLESPACE|PCTFREE/i.test(sql)) return 'oracle';
  if (/USING\s+DELTA|USING\s+PARQUET|\bSTRING\b/i.test(sql) && !/VARCHAR\s*\(/i.test(sql)) return 'spark';
  return 'ansi';
}

/** Remove cláusulas Oracle/Spark após o fechamento do bloco de colunas. */
function stripPostColumnClauses(stmt: string, closeIdx: number): string {
  let end = closeIdx + 1;
  while (end < stmt.length && /\s/.test(stmt[end])) end++;
  const tail = stmt.slice(end).trimStart();
  if (/^(USING|TABLESPACE|STORAGE|PCTFREE|PARTITIONED|TBLPROPERTIES|LOCATION|COMMENT)\b/i.test(tail)) {
    return stmt.slice(0, end).trim();
  }
  return stmt;
}

function splitStatements(sql: string): string[] {
  const stmts: string[] = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const slice = end >= 0 ? sql.slice(i, end + 2) : sql.slice(i);
      cur += slice;
      i += slice.length;
      continue;
    }

    if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      if (nl < 0) {
        cur += sql.slice(i);
        break;
      }
      cur += sql.slice(i, nl);
      i = nl;
      continue;
    }

    if (ch === "'") {
      cur += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          cur += sql[i++];
          if (sql[i] === "'") {
            cur += sql[i++];
            continue;
          }
          break;
        }
        cur += sql[i++];
      }
      continue;
    }

    if (ch === '"') {
      cur += ch;
      i++;
      while (i < sql.length && sql[i] !== '"') {
        cur += sql[i++];
      }
      if (i < sql.length) cur += sql[i++];
      continue;
    }

    if (ch === ';') {
      const trimmed = cur.trim();
      if (trimmed) stmts.push(trimmed);
      cur = '';
      i++;
      continue;
    }

    cur += ch;
    i++;
  }
  const trimmed = cur.trim();
  if (trimmed) stmts.push(trimmed);
  return stmts;
}

/** Remove comentários `-- …` no fim da linha (preserva vírgula separadora de colunas). */
function stripInlineLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      if (idx < 0) return line;
      const before = line.slice(0, idx).trimEnd();
      const commentTail = line.slice(idx);
      const commaAfterComment = /,\s*$/.test(commentTail);
      if (commaAfterComment && !before.endsWith(',')) return `${before},`;
      return before;
    })
    .join('\n');
}

/** Remove linhas `-- …` antes de extrair FK do DDL (evita exemplos no cabeçalho do arquivo). */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => (line.trimStart().startsWith('--') ? '' : line))
    .join('\n');
}

/** Índice da linha `CREATE TABLE …` no SQL fonte (mesma chave de `extractMetaComments`). */
function findCreateLineInSource(sql: string, table: Pick<Table, 'name' | 'schema'>): number {
  const q = qualifiedName(table).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `create\\s+(?:external\\s+|temporary\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(?:[\`"]?)?${q}(?:[\`"]?)?\\s*\\(`,
    'i',
  );
  const lines = sql.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

type TableMeta = {
  layer?: string;
  group?: string;
  note?: string;
  origins: string[];
  fks: Array<{ fromCol: string; toTable: string; toCol: string }>;
};

/** Metadados `-- @layer`, `@group`, `@note`, `@origen`, `@fk` / `@ref` acima do CREATE. */
function extractMetaComments(sql: string): Map<number, TableMeta> {
  const meta = new Map<number, TableMeta>();
  const lines = sql.split('\n');
  let pending: TableMeta = { origins: [], fks: [] };

  const flush = (lineIdx: number) => {
    if (!pending.layer && !pending.group && !pending.note && !pending.origins.length && !pending.fks.length) {
      return;
    }
    meta.set(lineIdx, {
      layer: pending.layer,
      group: pending.group,
      note: pending.note,
      origins: [...pending.origins],
      fks: [...pending.fks],
    });
    pending = { origins: [], fks: [] };
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const fkMatch = /^--\s*@(?:fk|ref)\s*:\s*(.+)$/i.exec(trimmed);
    if (fkMatch) {
      const parsed = parseFkComment(fkMatch[1]);
      if (parsed) pending.fks.push(parsed);
      continue;
    }
    const origenMatch = /^--\s*@(?:origen|origem)\s*:\s*(.+)$/i.exec(trimmed);
    if (origenMatch) {
      for (const src of origenMatch[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        pending.origins.push(src);
      }
      continue;
    }
    const metaMatch = /^--\s*@(\w+)\s*:\s*(.+)$/.exec(trimmed);
    if (metaMatch) {
      const key = metaMatch[1].toLowerCase();
      if (key === 'layer') pending.layer = metaMatch[2].trim();
      else if (key === 'group') pending.group = metaMatch[2].trim();
      else if (key === 'note') pending.note = metaMatch[2].trim();
      continue;
    }
    if (/create\s+(?:external\s+|temporary\s+)?table/i.test(trimmed)) {
      flush(i);
    } else if (trimmed && !trimmed.startsWith('--')) {
      pending = { origins: [], fks: [] };
    }
  }
  return meta;
}

/** `customer_id -> raw.customers.id` */
function parseFkComment(text: string): { fromCol: string; toTable: string; toCol: string } | null {
  const m = /^([A-Za-z_][\w]*)\s*->\s*([A-Za-z0-9_.]+)\.([A-Za-z_][\w]*)$/i.exec(text.trim());
  if (!m) return null;
  return { fromCol: m[1], toTable: m[2], toCol: m[3] };
}

function sanitizeCreateTable(stmt: string): { schema?: string; name: string; body: string; raw: string } | null {
  const cleaned = stmt.replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const head = /create\s+(?:external\s+|temporary\s+)?table\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_."]+)\s*\(/i.exec(
    cleaned,
  );
  if (!head) return null;

  const open = head.index + head[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < cleaned.length; i++) {
    if (cleaned[i] === '(') depth++;
    else if (cleaned[i] === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;

  const rawName = head[1].replace(/"/g, '');
  const parts = rawName.split('.');
  const name = parts.pop()!;
  const schema = parts.length ? parts.join('.') : undefined;
  const body = cleaned.slice(open, close + 1);
  const raw = stripPostColumnClauses(cleaned, close);

  return { schema, name, body, raw };
}

function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

type ParseColResult = { columns: Column[]; compositePks: string[][] };

function applyPkSets(columns: Column[], pkNames: string[], compositePks: string[][]): void {
  if (pkNames.length > 1) {
    compositePks.push(pkNames);
    for (const n of pkNames) {
      const c = columns.find((x) => x.name === n);
      if (c) {
        c.pk = true;
        c.nullable = false;
      }
    }
  } else if (pkNames.length === 1) {
    const c = columns.find((x) => x.name === pkNames[0]);
    if (c) {
      c.pk = true;
      c.nullable = false;
    }
  }
}

function parseColumnsFallback(body: string): ParseColResult {
  const inner = body.trim().replace(/^\(/, '').replace(/\)$/, '');
  const compositePks: string[][] = [];
  const columns: Column[] = [];

  for (const part of splitTopLevelRespectingLineComments(inner)) {
    const pkInline = /\bprimary\s+key\b/i.test(part);
    const pkm = /(?:constraint\s+\w+\s+)?primary\s+key\s*\(([^)]*)\)/i.exec(part);
    if (pkm) {
      const names = pkm[1].split(',').map((c) => c.replace(/[`"\s]/g, '').trim()).filter(Boolean);
      applyPkSets(columns, names, compositePks);
      continue;
    }
    if (/^(constraint|foreign\s+key|unique|key|index)\b/i.test(part)) continue;

    const m = /^([`"]?[A-Za-z_][\w]*[`"]?)\s+(.+)$/i.exec(part);
    if (!m) continue;
    const name = m[1].replace(/[`"]/g, '');
    let rest = m[2];
    const refInline = /\breferences\s+([A-Za-z0-9_."]+)\s*\(\s*([A-Za-z_][\w]*)\s*\)/i.exec(rest);
    if (refInline) rest = rest.slice(0, refInline.index).trim();

    const typeMatch = /^([A-Za-z0-9_]+(?:\s*\([^)]*\))?)/i.exec(rest);
    const { base, args } = parseTypeName(typeMatch ? typeMatch[1] : rest);
    const col: Column = {
      name,
      type: base,
      args,
      nullable: /\bnot\s+null\b/i.test(rest) ? false : true,
    };
    if (pkInline) {
      col.pk = true;
      col.nullable = false;
    }
    columns.push(col);
  }

  return { columns, compositePks };
}

function splitFkColumnList(inner: string): string[] {
  return inner.split(',').map((c) => c.replace(/[`"\s]/g, '').trim()).filter(Boolean);
}

/** FKs no CREATE: CONSTRAINT … FOREIGN KEY (cols) REFERENCES t (cols) — simples ou composta. */
function extractForeignKeysFromStmt(
  stmt: string,
  table: Pick<Table, 'name' | 'schema'>,
  warnings: string[],
): Ref[] {
  const refs: Ref[] = [];
  const fromTable = qualifiedName(table);

  const fkRe =
    /(?:constraint\s+\w+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+([`"]?[A-Za-z0-9_."]+)\s*\(([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = fkRe.exec(stmt)) !== null) {
    const fromCols = splitFkColumnList(m[1]);
    const toTable = m[2].replace(/[`"]/g, '');
    const toCols = splitFkColumnList(m[3]);
    if (fromCols.length !== toCols.length) {
      warnings.push(
        `FK em ${fromTable}: ${fromCols.length} coluna(s) de origem != ${toCols.length} em ${toTable}`,
      );
      continue;
    }
    for (let i = 0; i < fromCols.length; i++) {
      refs.push({
        from: { table: fromTable, column: fromCols[i] },
        to: { table: toTable, column: toCols[i] },
        kind: '>',
      });
    }
  }

  const inlineRe =
    /([`"]?[A-Za-z_][\w]*[`"]?)\s+[A-Za-z0-9_]+(?:\([^)]*\))?\s+references\s+([`"]?[A-Za-z0-9_."]+)\s*\(\s*([`"]?[A-Za-z_][\w]*[`"]?)\s*\)/gi;
  while ((m = inlineRe.exec(stmt)) !== null) {
    const fromCol = m[1].replace(/[`"]/g, '');
    refs.push({
      from: { table: fromTable, column: fromCol },
      to: { table: m[2].replace(/[`"]/g, ''), column: m[3].replace(/[`"]/g, '') },
      kind: '>',
    });
  }

  return refs;
}

function metaFksToRefs(
  fks: TableMeta['fks'],
  table: Pick<Table, 'name' | 'schema'>,
): Ref[] {
  const fromTable = qualifiedName(table);
  return fks.map((fk) => ({
    from: { table: fromTable, column: fk.fromCol },
    to: { table: fk.toTable, column: fk.toCol },
    kind: '>' as const,
  }));
}

export function createTableToTable(stmt: string, dialect: SqlDialect = 'ansi'): Table | null {
  const san = sanitizeCreateTable(stripInlineLineComments(stmt));
  if (!san) return null;

  let columns: Column[] = [];
  let compositePks: string[][] = [];

  try {
    const ast = sqlParser.astify(`CREATE TABLE ${san.name} ${san.body}`, {
      database: parserDialect(dialect),
    });
    const node = Array.isArray(ast) ? ast[0] : ast;
    const defs: any[] = node.create_definitions ?? [];

    const pkCols = new Set<string>();
    for (const d of defs) {
      if (d.resource === 'constraint' && d.constraint_type === 'primary key') {
        const cols = resolvePkColumnNames(d.definition ?? []);
        if (cols.length > 1) compositePks.push(cols);
        cols.forEach((c) => pkCols.add(c));
      }
    }
    for (const d of defs) {
      if (d.resource !== 'column') continue;
      const colName = d.column?.column ?? d.column?.value ?? d.column;
      if (typeof colName !== 'string') continue;
      const def = d.definition ?? {};
      const args =
        def.length != null
          ? def.scale != null
            ? `${def.length},${def.scale}`
            : `${def.length}`
          : undefined;
      columns.push({
        name: colName.replace(/[`"]/g, ''),
        type: String(def.dataType ?? 'string').toLowerCase(),
        args,
        pk: pkCols.has(colName.replace(/[`"]/g, '')),
        nullable: d.nullable?.type === 'not null' ? false : true,
      });
    }
  } catch {
    // fallback abaixo
  }

  if (!columns.length) {
    const parsed = parseColumnsFallback(san.body);
    columns = parsed.columns;
    compositePks = parsed.compositePks;
  } else if (!compositePks.length) {
    const parsed = parseColumnsFallback(san.body);
    compositePks = parsed.compositePks;
  }

  if (!columns.length) return null;
  const table: Table = { name: san.name, schema: san.schema, columns };
  if (compositePks.length) table.compositePks = compositePks;
  return table;
}

function parseInserts(sql: string, tableName: string): { columns: string[]; rows: string[][] } {
  const rows: string[][] = [];
  const colsSet = new Set<string>();
  const re = new RegExp(
    `INSERT\\s+INTO\\s+(?:\\w+\\.)?${tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:\\(([^)]+)\\))?\\s*VALUES\\s*\\(([^)]+)\\)`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (m[1]) m[1].split(',').forEach((c) => colsSet.add(c.trim().replace(/[`"]/g, '')));
    const vals = m[2].split(',').map((v) => v.trim().replace(/^'(.*)'$/, '$1'));
    rows.push(vals);
  }
  return { columns: [...colsSet], rows };
}

function refDedupeKey(r: Ref): string {
  return `${r.from.table}.${r.from.column}->${r.to.table}.${r.to.column}`.toLowerCase();
}

function isDegenerateRef(r: Ref): boolean {
  return (
    r.from.table.toLowerCase() === r.to.table.toLowerCase() &&
    r.from.column.toLowerCase() === r.to.column.toLowerCase()
  );
}

/** Extrai nomes de coluna de definição PK do node-sql-parser (Oracle usa `.value`). */
function resolvePkColumnNames(def: unknown[]): string[] {
  return def
    .map((x: unknown) => {
      if (typeof x === 'string') return x.replace(/[`"]/g, '');
      const o = x as Record<string, unknown>;
      const raw = o?.column ?? o?.value ?? o?.name;
      if (typeof raw === 'string') return raw.replace(/[`"]/g, '');
      if (raw && typeof raw === 'object') {
        const inner = raw as Record<string, unknown>;
        const name = inner.column ?? inner.value ?? inner.name;
        if (typeof name === 'string') return name.replace(/[`"]/g, '');
      }
      return '';
    })
    .filter(Boolean);
}

function parserDialect(dialect: SqlDialect): string {
  return dialect === 'oracle' ? 'oracle' : 'hive';
}

const MAP_INLINE_RE = /--\s*@(?:map|mapeamento)\s*<-\s*([A-Za-z0-9_.]+)(?:\s*\[([^\]]*)\])?\s*$/i;

function parseMapMeta(bracket: string | undefined): { note?: string; ref?: string } {
  if (!bracket?.trim()) return {};
  const note = /note\s*:\s*'([^']*)'/i.exec(bracket)?.[1];
  const ref = /ref\s*:\s*'([^']*)'/i.exec(bracket)?.[1];
  return { note, ref };
}

function splitTopLevelRespectingLineComments(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let inLineComment = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    const next = inner[i + 1];
    if (!inLineComment && ch === '-' && next === '-') inLineComment = true;
    if (inLineComment) {
      cur += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function extractCreateTableBody(stmt: string): string | null {
  const openRe =
    /create\s+(?:external\s+|temporary\s+)?table\s+(?:if\s+not\s+exists\s+)?[`"']?[A-Za-z0-9_.]+[`"']?\s*\(/i;
  const open = openRe.exec(stmt);
  if (!open) return null;
  const parenStart = open.index + open[0].length - 1;
  let depth = 0;
  for (let i = parenStart; i < stmt.length; i++) {
    if (stmt[i] === '(') depth++;
    else if (stmt[i] === ')') {
      depth--;
      if (depth === 0) return stmt.slice(parenStart + 1, i);
    }
  }
  return null;
}

/** Extrai `@map` inline nas colunas do CREATE TABLE. */
function extractFieldLineageFromStmt(
  stmt: string,
  table: Pick<Table, 'name' | 'schema'>,
): FieldLineageEntry[] {
  const targetTable = qualifiedName(table);
  const entries: FieldLineageEntry[] = [];
  const innerRaw = extractCreateTableBody(stmt);
  if (!innerRaw) return entries;

  const parsePart = (rawPart: string) => {
    const trimmedPart = rawPart.trim().replace(/,\s*$/, '');
    if (!trimmedPart) return;
    if (/^(constraint|foreign\s+key|unique|key|index)\b/i.test(trimmedPart)) return;
    if (/(?:^|\s)primary\s+key\s*\(/i.test(trimmedPart)) return;
    const mapMatch = MAP_INLINE_RE.exec(trimmedPart);
    if (!mapMatch) return;
    const colMatch = /^([`"]?[A-Za-z_][\w]*[`"]?)\s+/i.exec(trimmedPart);
    if (!colMatch) return;
    const targetColumn = colMatch[1].replace(/[`"]/g, '');
    const sourceQualified = mapMatch[1];
    const lastDot = sourceQualified.lastIndexOf('.');
    if (lastDot <= 0) return;
    const sourceTable = sourceQualified.slice(0, lastDot);
    const sourceColumn = sourceQualified.slice(lastDot + 1);
    if (!sourceTable || !sourceColumn) return;
    entries.push({
      targetTable,
      targetColumn,
      sourceTable,
      sourceColumn,
      ...parseMapMeta(mapMatch[2]),
    });
  };

  if (/\n/.test(innerRaw)) {
    for (const rawLine of innerRaw.split('\n')) parsePart(rawLine);
  } else {
    for (const part of splitTopLevelRespectingLineComments(innerRaw)) parsePart(part);
  }
  return entries;
}

const LINEAGE_FOOTER_HEADER_RE = /^--\s*@lineage\s+([A-Za-z0-9_.]+)\s*$/i;
const LINEAGE_FOOTER_LINE_RE =
  /^--\s*([A-Za-z_][\w]*)\s*<-\s*([A-Za-z0-9_.]+)(?:\s*\[([^\]]*)\])?\s*$/;

/**
 * Extrai o bloco-rodapé de linhagem L2 (formato novo):
 *   -- @lineage silver.dim_customer
 *   --   natural_id <- raw.customers.id [note: '...', ref: '...']
 * O cabeçalho fixa a tabela destino; as linhas seguintes (comentários) trazem
 * `coluna <- origem.qualificada`. Qualquer linha que não case encerra o bloco.
 */
function extractFieldLineageFooter(sql: string): FieldLineageEntry[] {
  const out: FieldLineageEntry[] = [];
  let target: string | null = null;
  for (const raw of sql.split('\n')) {
    const line = raw.trim();
    const header = LINEAGE_FOOTER_HEADER_RE.exec(line);
    if (header) {
      target = header[1];
      continue;
    }
    if (!target) continue;
    const m = line.startsWith('--') ? LINEAGE_FOOTER_LINE_RE.exec(line) : null;
    if (!m) {
      target = null;
      continue;
    }
    const sourceQualified = m[2];
    const lastDot = sourceQualified.lastIndexOf('.');
    if (lastDot <= 0) continue;
    out.push({
      targetTable: target,
      targetColumn: m[1],
      sourceTable: sourceQualified.slice(0, lastDot),
      sourceColumn: sourceQualified.slice(lastDot + 1),
      ...parseMapMeta(m[3]),
    });
  }
  return out;
}

const COLORS_FOOTER_HEADER_RE = /^--\s*@colors\s*$/i;
const LAYERCOLORS_FOOTER_HEADER_RE = /^--\s*@layercolors\s*$/i;
const COLORS_FOOTER_LINE_RE = /^--\s+(@?[A-Za-z0-9_.]+)\s*:\s*(\S+)\s*$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Extrai os rodapés de cor (espelham o bloco DBML `Colors {}` e `LayerGroup [color:]`):
 *   -- @colors
 *   --   silver.dim_cliente: #b08d57
 *   -- @layercolors
 *   --   prata: #c0c0c0
 * Cor fora de #rrggbb gera warning e é ignorada; linha que não casa encerra o bloco.
 */
function extractColorsFooter(
  sql: string,
  warnings: string[],
): { colors: Record<string, string>; layerColors: Record<string, string> } {
  const colors: Record<string, string> = {};
  const layerColors: Record<string, string> = {};
  let mode: 'colors' | 'layers' | null = null;
  for (const raw of sql.split('\n')) {
    const line = raw.trim();
    if (COLORS_FOOTER_HEADER_RE.test(line)) {
      mode = 'colors';
      continue;
    }
    if (LAYERCOLORS_FOOTER_HEADER_RE.test(line)) {
      mode = 'layers';
      continue;
    }
    if (!mode) continue;
    const m = line.startsWith('--') ? COLORS_FOOTER_LINE_RE.exec(line) : null;
    if (!m) {
      mode = null;
      continue;
    }
    if (!HEX_COLOR_RE.test(m[2])) {
      warnings.push(`@colors: cor inválida '${m[2]}' para '${m[1]}' (esperado #rrggbb)`);
      continue;
    }
    if (mode === 'colors') colors[m[1]] = m[2];
    else layerColors[m[1]] = m[2];
  }
  return { colors, layerColors };
}

/** Valida chaves de tabela/coluna do @colors contra as tabelas do arquivo (grupos não validam). */
function validateColorKeys(colors: Record<string, string>, tables: Table[], warnings: string[]): void {
  const tableKeys = new Set(tables.map((t) => qualifiedName(t).toLowerCase()));
  for (const key of Object.keys(colors)) {
    if (key.startsWith('@')) continue;
    const lower = key.toLowerCase();
    const asTable = tableKeys.has(lower);
    const asColumn =
      lower.includes('.') && tableKeys.has(lower.slice(0, lower.lastIndexOf('.')));
    if (!asTable && !asColumn) warnings.push(`@colors: tabela '${key}' não encontrada`);
  }
}

/**
 * Comentário inline `-- texto` na linha da coluna vira descrição da coluna
 * (Column.note). Ignora diretivas `-- @...` (linhagem/meta) e linhas de constraint.
 */
function extractColumnComments(stmt: string): Map<string, string> {
  const out = new Map<string, string>();
  const innerRaw = extractCreateTableBody(stmt);
  if (!innerRaw) return out;
  const parts = /\n/.test(innerRaw)
    ? innerRaw.split('\n')
    : splitTopLevelRespectingLineComments(innerRaw);
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    const cIdx = part.indexOf('--');
    if (cIdx < 0) continue;
    const comment = part.slice(cIdx + 2).trim();
    if (!comment || comment.startsWith('@')) continue;
    const before = part.slice(0, cIdx).trim().replace(/,\s*$/, '');
    if (/^(constraint|foreign\s+key|unique|key|index)\b/i.test(before)) continue;
    if (/(?:^|\s)primary\s+key\s*\(/i.test(before)) continue;
    const colMatch = /^([`"]?[A-Za-z_][\w]*[`"]?)\s+/.exec(before);
    if (!colMatch) continue;
    const col = colMatch[1].replace(/[`"]/g, '');
    if (!out.has(col)) out.set(col, comment);
  }
  return out;
}

function lineageEntryKey(entry: LineageEntry): string {
  return entry.target.toLowerCase();
}

function fieldLineageKey(entry: FieldLineageEntry): string {
  return `${entry.targetTable}.${entry.targetColumn}<-${entry.sourceTable}.${entry.sourceColumn}`.toLowerCase();
}

function mergeLineageEntries(base: LineageEntry[] | undefined, incoming: LineageEntry[] | undefined): LineageEntry[] {
  const byTarget = new Map<string, { target: string; sources: Set<string> }>();
  for (const entry of [...(base ?? []), ...(incoming ?? [])]) {
    const key = lineageEntryKey(entry);
    if (!byTarget.has(key)) byTarget.set(key, { target: entry.target, sources: new Set() });
    for (const src of entry.sources) byTarget.get(key)!.sources.add(src);
  }
  return [...byTarget.values()].map(({ target, sources }) => ({
    target,
    sources: [...sources],
  }));
}

function mergeFieldLineageEntries(
  base: FieldLineageEntry[] | undefined,
  incoming: FieldLineageEntry[] | undefined,
): FieldLineageEntry[] {
  const map = new Map<string, FieldLineageEntry>();
  for (const entry of base ?? []) map.set(fieldLineageKey(entry), entry);
  for (const entry of incoming ?? []) {
    const key = fieldLineageKey(entry);
    const existing = map.get(key);
    if (existing) {
      map.set(key, {
        ...existing,
        note: entry.note ?? existing.note,
        ref: entry.ref ?? existing.ref,
      });
    } else {
      map.set(key, entry);
    }
  }
  return [...map.values()];
}

function appendLineageEntry(lineage: LineageEntry[], target: string, sources: string[]): void {
  if (!sources.length) return;
  const key = target.toLowerCase();
  const existing = lineage.find((e) => e.target.toLowerCase() === key);
  if (existing) {
    const seen = new Set(existing.sources.map((s) => s.toLowerCase()));
    for (const src of sources) {
      if (!seen.has(src.toLowerCase())) {
        existing.sources.push(src);
        seen.add(src.toLowerCase());
      }
    }
  } else {
    lineage.push({ target, sources: [...sources] });
  }
}

function validateLineage(model: Model, warnings: string[]): void {
  const tableNames = new Set(model.tables.map((t) => qualifiedName(t).toLowerCase()));
  const columnsByTable = new Map<string, Set<string>>();
  for (const t of model.tables) {
    columnsByTable.set(
      qualifiedName(t).toLowerCase(),
      new Set(t.columns.map((c) => c.name.toLowerCase())),
    );
  }

  for (const entry of model.lineage ?? []) {
    if (!tableNames.has(entry.target.toLowerCase())) {
      warnings.push(`@origen: tabela destino '${entry.target}' não encontrada`);
    }
    for (const src of entry.sources) {
      if (!tableNames.has(src.toLowerCase())) {
        warnings.push(`@origen: tabela origem '${src}' não encontrada (destino '${entry.target}')`);
      }
    }
  }

  for (const field of model.lineageFields ?? []) {
    if (!tableNames.has(field.targetTable.toLowerCase())) {
      warnings.push(`@map: tabela destino '${field.targetTable}' não encontrada`);
    }
    if (!tableNames.has(field.sourceTable.toLowerCase())) {
      warnings.push(`@map: tabela origem '${field.sourceTable}' não encontrada`);
      continue;
    }
    const srcCols = columnsByTable.get(field.sourceTable.toLowerCase());
    if (srcCols && !srcCols.has(field.sourceColumn.toLowerCase())) {
      warnings.push(`@map: coluna '${field.sourceColumn}' não encontrada em '${field.sourceTable}'`);
    }
    const tgtCols = columnsByTable.get(field.targetTable.toLowerCase());
    if (tgtCols && !tgtCols.has(field.targetColumn.toLowerCase())) {
      warnings.push(`@map: coluna '${field.targetColumn}' não encontrada em '${field.targetTable}'`);
    }
  }
}

function unquoteSqlString(s: string): string {
  return s.replace(/''/g, "'");
}

function normalizeOracleIdent(s: string): string {
  return s.replace(/[`"]/g, '').trim();
}

/** `COMMENT ON TABLE/COLUMN` (Oracle) → notes no modelo. */
function extractOracleComments(sql: string): {
  tables: Map<string, string>;
  columns: Map<string, Map<string, string>>;
} {
  const tables = new Map<string, string>();
  const columns = new Map<string, Map<string, string>>();

  const tableRe =
    /COMMENT\s+ON\s+TABLE\s+([`"]?)([A-Za-z0-9_.]+)\1\s+IS\s+'((?:[^']|'')*)'/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(sql)) !== null) {
    tables.set(normalizeOracleIdent(m[2]).toLowerCase(), unquoteSqlString(m[3]));
  }

  const colRe =
    /COMMENT\s+ON\s+COLUMN\s+([`"]?)([A-Za-z0-9_.]+)\1\.([`"]?)([A-Za-z_][\w]*)\3\s+IS\s+'((?:[^']|'')*)'/gi;
  while ((m = colRe.exec(sql)) !== null) {
    const qname = normalizeOracleIdent(m[2]).toLowerCase();
    const col = normalizeOracleIdent(m[4]).toLowerCase();
    if (!columns.has(qname)) columns.set(qname, new Map());
    columns.get(qname)!.set(col, unquoteSqlString(m[5]));
  }

  return { tables, columns };
}

function applyOracleComments(tables: Table[], sql: string): void {
  const { tables: tNotes, columns: cNotes } = extractOracleComments(sql);
  for (const t of tables) {
    const key = qualifiedName(t).toLowerCase();
    const tNote = tNotes.get(key);
    if (tNote && !t.note) {
      t.note = tNote;
      t.noteInRecordsOnly = true;
    }
    const colMap = cNotes.get(key);
    if (!colMap) continue;
    for (const c of t.columns) {
      const cn = colMap.get(c.name.toLowerCase());
      if (cn && !c.note) c.note = cn;
    }
  }
}

/** Parse completo: tabelas + refs + metadados + linhagem L1/L2. */
export function sqlToModel(sql: string): Model {
  const tables: Table[] = [];
  const refs: Ref[] = [];
  const lineage: LineageEntry[] = [];
  const lineageFields: FieldLineageEntry[] = [];
  const warnings: string[] = [];
  const refSeen = new Set<string>();
  const fieldSeen = new Set<string>();
  const metaMap = extractMetaComments(sql);
  const stmts = splitStatements(sql);
  const dialect = detectSqlDialect(sql);

  const addRef = (r: Ref) => {
    if (isDegenerateRef(r)) return;
    const k = refDedupeKey(r);
    if (refSeen.has(k)) return;
    refSeen.add(k);
    refs.push(r);
  };

  const addFieldLineage = (entry: FieldLineageEntry) => {
    const k = fieldLineageKey(entry);
    if (fieldSeen.has(k)) return;
    fieldSeen.add(k);
    lineageFields.push(entry);
  };

  for (const stmt of stmts) {
    if (!/create\s+(?:external\s+|temporary\s+)?table/i.test(stmt)) continue;
    const t = createTableToTable(stmt, dialect);
    if (!t) continue;

    const createLine = findCreateLineInSource(sql, t);
    const meta = createLine >= 0 ? metaMap.get(createLine) : undefined;
    if (meta) {
      if (meta.layer) t.layer = meta.layer;
      if (meta.group) t.group = meta.group;
      if (meta.note) {
        t.note = meta.note;
        t.noteInRecordsOnly = true;
      }
      if (meta.origins.length) appendLineageEntry(lineage, qualifiedName(t), meta.origins);
      for (const r of metaFksToRefs(meta.fks, t)) addRef(r);
      metaMap.delete(createLine);
    }

    for (const r of extractForeignKeysFromStmt(stripLineComments(stmt), t, warnings)) addRef(r);
    // Retrocompat: @map inline na coluna (formato antigo).
    for (const field of extractFieldLineageFromStmt(stmt, t)) addFieldLineage(field);
    // Comentário inline `-- texto` (não-diretiva) → descrição da coluna.
    const colComments = extractColumnComments(stmt);
    for (const c of t.columns) {
      const cc = colComments.get(c.name);
      if (cc && !c.note) c.note = cc;
    }

    const inserts = parseInserts(sql, t.name);
    if (inserts.rows.length) {
      t.records = {
        columns: inserts.columns.length ? inserts.columns : t.columns.map((c) => c.name),
        rows: inserts.rows,
      };
    }

    tables.push(t);
  }

  // Formato novo: bloco-rodapé `-- @lineage <tabela>` (após o CREATE).
  for (const field of extractFieldLineageFooter(sql)) addFieldLineage(field);

  applyOracleComments(tables, sql);

  const { colors, layerColors } = extractColorsFooter(sql, warnings);
  validateColorKeys(colors, tables, warnings);

  const model: Model = {
    tables,
    refs,
    lineage: lineage.length ? lineage : undefined,
    lineageFields: lineageFields.length ? lineageFields : undefined,
    colors: Object.keys(colors).length ? colors : undefined,
    layerColors: Object.keys(layerColors).length ? layerColors : undefined,
  };
  validateLineage(model, warnings);
  if (warnings.length) model.warnings = warnings;
  return model;
}

/** @deprecated Use sqlToModel */
export function sqlToTables(sql: string): Table[] {
  return sqlToModel(sql).tables;
}

export function mergeModel(base: Model, incoming: Model): Model {
  const key = (t: Table) => `${t.schema ?? ''}.${t.name}`.toLowerCase();
  const byKey = new Map(base.tables.map((t) => [key(t), t] as const));
  for (const t of incoming.tables) byKey.set(key(t), t);

  const refSeen = new Set(base.refs.map(refDedupeKey));
  const refs = [...base.refs];
  for (const r of incoming.refs) {
    const k = refDedupeKey(r);
    if (!refSeen.has(k)) {
      refSeen.add(k);
      refs.push(r);
    }
  }

  const warnings = [...(base.warnings ?? []), ...(incoming.warnings ?? [])];
  const lineage = mergeLineageEntries(base.lineage, incoming.lineage);
  const lineageFields = mergeFieldLineageEntries(base.lineageFields, incoming.lineageFields);
  const colors = { ...(base.colors ?? {}), ...(incoming.colors ?? {}) };
  const layerColors = { ...(base.layerColors ?? {}), ...(incoming.layerColors ?? {}) };
  return {
    tables: [...byKey.values()],
    refs,
    lineage: lineage.length ? lineage : undefined,
    lineageFields: lineageFields.length ? lineageFields : undefined,
    colors: Object.keys(colors).length ? colors : undefined,
    layerColors: Object.keys(layerColors).length ? layerColors : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}

/** Mescla só tabelas (compat). */
export function mergeTables(model: Model, incoming: Table[]): Model {
  return mergeModel(model, { tables: incoming, refs: [] });
}
