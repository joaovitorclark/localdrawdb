// Parse de DBML no browser (@dbml/core) -> nós/arestas para o React Flow.
import { Parser } from '@dbml/core';
import {
  extractRecords,
  parseLayerGroup,
  parseLineageBlock,
  parseLineageFieldsBlock,
  splitTableColumn,
  type ParsedFieldLineage,
  type ParsedLayerGroup,
  type ParsedLineage,
  type ParsedRolename,
} from './dbmlClean';
import type { ParsedRecords } from './records';
import { resolveParseErrorLine } from './lineLocate';
import { splitDbmlBlocks } from './blocks';

export {
  extractRecords,
  parseLayerGroup,
  parseLineageBlock,
  parseLineageFieldsBlock,
  splitTableColumn,
  type ParsedFieldLineage,
  type ParsedLayerGroup,
  type ParsedLineage,
  type ParsedRolename,
} from './dbmlClean';

export type Cardinality = '*' | '1';
export type ColumnView = {
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  note?: string;
  /** Teste dbt accepted_values (do bloco Dbt { }). */
  acceptedValues?: string[];
  /** Cor do nome do campo (do bloco Colors {}, chave `tabela.coluna`). */
  color?: string;
};
export type TableView = {
  id: string; // schema.tabela (ou tabela)
  name: string;
  schema?: string;
  group?: string;
  note?: string;
  compositePks?: string[][];
  columns: ColumnView[];
  // ---- Metadados dbt (do bloco Dbt { }) ----
  resourceType?: 'model' | 'source' | 'seed' | 'snapshot';
  materialization?: 'table' | 'view' | 'incremental' | 'ephemeral';
  tags?: string[];
};
export type RefView = {
  id: string;
  source: string;
  target: string;
  label: string;
  fromCol: string;
  toCol: string;
  fromRel: Cardinality; // cardinalidade do lado source
  toRel: Cardinality; // cardinalidade do lado target
};
export type ParseResult = {
  tables: TableView[];
  refs: RefView[];
  records: ParsedRecords[];
  layerGroups: ParsedLayerGroup[];
  lineage: ParsedLineage[];
  lineageFields: ParsedFieldLineage[];
  rolenames: ParsedRolename[];
  /** Cor por tabela (do bloco Colors {}) — id da tabela -> hex/nome. */
  colors: Record<string, string>;
  error?: string;
  /** Linha 0-based no buffer do editor (quando disponível). */
  errorLine?: number;
};

const qualified = (schema: string | undefined, name: string) =>
  schema && schema !== 'public' ? `${schema}.${name}` : name;

/** Extrai mensagem e linha do CompilerError do @dbml/core (linha ainda no buffer clean). */
function formatParseError(e: any): { rawMessage: string; cleanLine0?: number } {
  const diag = e?.diags?.[0];
  if (diag?.message) {
    const line1 = diag.location?.start?.line as number | undefined;
    const cleanLine0 = line1 != null ? line1 - 1 : undefined;
    return { rawMessage: diag.message, cleanLine0 };
  }
  return { rawMessage: e?.message ?? 'DBML inválido' };
}

function buildParseError(
  dbml: string,
  rawMessage: string,
  cleanLine0: number | undefined,
  mapCleanLine: (n: number) => number,
): { message: string; line?: number } {
  const line0 = resolveParseErrorLine(dbml, rawMessage, cleanLine0, mapCleanLine);
  const line1 = line0 != null ? line0 + 1 : undefined;
  const message = line1 ? `Linha ${line1}: ${rawMessage}` : rawMessage;
  return { message, line: line0 };
}

const stripQuotes = (s: string) => s.replace(/["`]/g, '').trim();

function tableIdMatches(member: string, tableId: string): boolean {
  const a = stripQuotes(member).toLowerCase();
  const b = stripQuotes(tableId).toLowerCase();
  if (a === b) return true;
  return a.split('.').pop() === b.split('.').pop();
}

/**
 * Normaliza um id de tabela como o parser o enxerga: minúsculas + trim.
 * Usado para detectar duplicatas antes de mutar o DBML (A3 do audit
 * 2026-07-13) — antes desse helper, addTable/renameTable aceitavam
 * nomes como `Gold.Dim_Customer` mesmo já existindo `gold.dim_customer`,
 * corrompendo o modelo silenciosamente.
 */
export function normalizeTableId(id: string): string {
  return stripQuotes(id).toLowerCase();
}

/** Mesma normalização mas só minúsculas + trim (sem strip de aspas/backticks). */
export function normalizeColumnName(name: string): string {
  return name.trim().toLowerCase();
}

/** Retorna o id existente que colide com `candidate` (case-insensitive, esquema opcional), ou null. */
export function findDuplicateTableId(candidate: string, existing: string[]): string | null {
  const norm = normalizeTableId(candidate);
  if (!norm) return null;
  const candShort = norm.split('.').pop();
  for (const id of existing) {
    const existingNorm = normalizeTableId(id);
    if (!existingNorm) continue;
    if (existingNorm === norm) return id;
    if (candShort && existingNorm.split('.').pop() === candShort) return id;
  }
  return null;
}

/** Retorna o nome existente que colide com `candidate` (case-insensitive), ou null. */
export function findDuplicateColumnName(candidate: string, existing: string[]): string | null {
  const norm = normalizeColumnName(candidate);
  if (!norm) return null;
  for (const name of existing) {
    if (normalizeColumnName(name) === norm) return name;
  }
  return null;
}

/** TableGroup no DBML → campo group das tabelas (páginas do canvas). */
function applyTableGroupMembership(dbml: string, tables: TableView[]): void {
  for (const b of splitDbmlBlocks(dbml)) {
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
      for (const t of tables) {
        if (tableIdMatches(member, t.id)) t.group = groupName;
      }
    }
  }
}

export function parseDbml(dbml: string): ParseResult {
  if (!dbml.trim()) {
    return { tables: [], refs: [], records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {} };
  }
  const { clean, records, layerGroups, lineage, lineageFields, dbtTables, rolenames, colors, mapCleanLineToOriginal } =
    extractRecords(dbml);
  const colorsMap = Object.fromEntries(colors.map((c) => [c.table, c.color]));
  let db: any;
  try {
    db = Parser.parse(clean, 'dbml');
  } catch (e: any) {
    const { rawMessage, cleanLine0 } = formatParseError(e);
    const { message, line } = buildParseError(dbml, rawMessage, cleanLine0, mapCleanLineToOriginal);
    return {
      tables: [], refs: [], records, layerGroups, lineage, lineageFields, rolenames, colors: colorsMap, error: message, errorLine: line,
    };
  }

  const tables: TableView[] = [];
  const refs: RefView[] = [];

  for (const schema of db.schemas) {
    const schemaName = schema.name && schema.name !== 'public' ? schema.name : undefined;
    for (const t of schema.tables) {
      const tableId = qualified(schemaName, t.name);
      const columns: ColumnView[] = t.fields.map((f: any) => ({
        name: f.name,
        type: f.type.type_name,
        pk: !!f.pk,
        notNull: !!f.not_null,
        note: f.note || undefined,
        color: colorsMap[`${tableId}.${f.name}`],
      }));
      const compositePks: string[][] = [];
      for (const idx of (t as any).indexes ?? []) {
        const cols = (idx.columns ?? []).map((c: any) =>
          typeof c === 'string' ? c : (c.value ?? c.name ?? ''),
        ).filter(Boolean);
        if (idx.pk && cols.length > 1) {
          compositePks.push(cols);
          for (const n of cols) {
            const col = columns.find((c) => c.name === n);
            if (col) col.pk = true;
          }
        }
      }
      tables.push({
        id: tableId,
        name: t.name,
        schema: schemaName,
        group: t.group?.name || undefined,
        note: t.note || undefined,
        compositePks: compositePks.length ? compositePks : undefined,
        columns,
      });
    }
    for (const r of schema.refs) {
      const [a, b] = r.endpoints;
      const from = a.relation === '*' ? a : b;
      const to = from === a ? b : a;
      const sourceId = qualified(from.schemaName, from.tableName);
      const targetId = qualified(to.schemaName, to.tableName);
      refs.push({
        id: `${sourceId}.${from.fieldNames[0]}->${targetId}.${to.fieldNames[0]}`,
        source: sourceId,
        target: targetId,
        label: `${from.fieldNames[0]} → ${to.fieldNames[0]}`,
        fromCol: from.fieldNames[0],
        toCol: to.fieldNames[0],
        fromRel: from.relation === '*' ? '*' : '1',
        toRel: to.relation === '*' ? '*' : '1',
      });
    }
  }

  for (const rec of records) {
    if (!rec.note) continue;
    const t = tables.find((x) => x.id === rec.table || x.name === rec.table);
    if (t && !t.note) t.note = rec.note;
  }

  applyTableGroupMembership(dbml, tables);

  // Anexa metadados dbt (bloco Dbt { }) às tabelas/colunas correspondentes.
  for (const d of dbtTables) {
    const t = tables.find((x) => x.id === d.tableName || tableIdMatches(d.tableName, x.id));
    if (!t) continue;
    if (d.resourceType) t.resourceType = d.resourceType;
    if (d.materialization) t.materialization = d.materialization;
    if (d.tags?.length) t.tags = d.tags;
    for (const [colName, dc] of Object.entries(d.columns ?? {})) {
      const col = t.columns.find((c) => c.name === colName);
      if (col && dc.acceptedValues?.length) col.acceptedValues = dc.acceptedValues;
    }
  }

  return { tables, refs, records, layerGroups, lineage, lineageFields, rolenames, colors: colorsMap };
}

/** Snippet de colunas de metadados padrão do lakehouse. */
export const METADATA_SNIPPET = [
  '  transact_id string',
  '  ingestion_timestamp timestamp',
  '  capture_timestamp timestamp',
  '  business_hash string',
  '  content_hash string',
  '  operation_type string',
].join('\n');

const SIMPLE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Cita partes do nome (schema.tabela) que não sejam identificadores simples. */
export function dbmlIdent(name: string): string {
  return name
    .split('.')
    .map((part) => (SIMPLE_IDENT.test(part) ? part : `"${part.replace(/"/g, '')}"`))
    .join('.');
}

/** Template de uma nova tabela (nome citado se tiver hífen/espaço). */
export const newTableTemplate = (name: string) =>
  `\nTable ${dbmlIdent(name)} {\n  id bigint [pk]\n${METADATA_SNIPPET}\n}\n`;
