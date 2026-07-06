// F3 — Import dbt. Lê três formatos e produz o Model canônico:
//  1. schema.yml / properties.yml avulso (models + sources + tests).
//  2. Projeto dbt em pasta: schema.yml + *.sql (ref()/source() → lineage L1).
//  3. dbt-docs (manifest.json): DAG, tipos reais e tests resolvidos.
// Inverte a codificação do export (F2) para round-trip semântico.
import yaml from 'js-yaml';
import { parseTypeName, qualifiedName } from './model.ts';
import type { Column, FieldLineageEntry, LineageEntry, Model, Ref, Table } from './model.ts';

/** Acumulador de metadados LocalDrawDB (meta.localdrawdb) coletados dos yml. */
type LdbAcc = {
  colors: Record<string, string>;
  layerColors: Record<string, string>;
  lineageFields: FieldLineageEntry[];
};

const newLdbAcc = (): LdbAcc => ({ colors: {}, layerColors: {}, lineageFields: [] });

/** Espalha os campos do acumulador no Model (omitindo vazios). */
function applyLdbAcc(model: Model, acc: LdbAcc): Model {
  if (Object.keys(acc.colors).length) model.colors = acc.colors;
  if (Object.keys(acc.layerColors).length) model.layerColors = acc.layerColors;
  if (acc.lineageFields.length) model.lineageFields = acc.lineageFields;
  return model;
}

/**
 * Aplica `meta.localdrawdb` de uma entrada de tabela (model ou source): schema (se a
 * pasta não definiu), layer/group, PK explícita (vence a inferência por tests; 2+
 * colunas = composta), records; cores vão para o acumulador. Depois coleta a meta
 * das colunas (cor do nome + mapeamento L2).
 */
function applyLdbMeta(table: Table, entry: any, acc: LdbAcc): void {
  const ldb = entry?.meta?.localdrawdb;
  if (ldb && typeof ldb === 'object') {
    if (!table.schema && typeof ldb.schema === 'string') table.schema = ldb.schema;
    if (typeof ldb.layer === 'string') table.layer = ldb.layer;
    if (typeof ldb.group === 'string') table.group = ldb.group;
    const qn = qualifiedName(table);
    if (typeof ldb.color === 'string') acc.colors[qn] = ldb.color;
    if (table.group && typeof ldb.groupColor === 'string') {
      acc.colors[`@${table.group}`] = ldb.groupColor;
    }
    if (table.layer && typeof ldb.layerColor === 'string') {
      acc.layerColors[table.layer] = ldb.layerColor;
    }
    if (Array.isArray(ldb.pk) && ldb.pk.length) {
      const names = ldb.pk.map(String);
      for (const c of table.columns) c.pk = false;
      if (names.length === 1) {
        const col = table.columns.find((c) => c.name === names[0]);
        if (col) col.pk = true;
      } else {
        table.compositePks = [names];
      }
    }
    if (ldb.records && Array.isArray(ldb.records.rows)) {
      table.records = {
        columns: Array.isArray(ldb.records.columns)
          ? ldb.records.columns.map(String)
          : table.columns.map((c) => c.name),
        rows: ldb.records.rows.map((r: unknown) => (Array.isArray(r) ? r.map(String) : [])),
      };
    }
  }

  const qn = qualifiedName(table);
  for (const c of entry?.columns ?? []) {
    const cldb = c?.meta?.localdrawdb;
    if (!cldb || typeof cldb !== 'object') continue;
    if (typeof cldb.color === 'string') acc.colors[`${qn}.${c.name}`] = cldb.color;
    const map = cldb.map;
    if (map && typeof map.table === 'string' && typeof map.column === 'string') {
      acc.lineageFields.push({
        targetTable: qn,
        targetColumn: String(c.name),
        sourceTable: map.table,
        sourceColumn: map.column,
        ...(typeof map.note === 'string' ? { note: map.note } : {}),
        ...(typeof map.ref === 'string' ? { ref: map.ref } : {}),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers comuns
// ---------------------------------------------------------------------------

function colFromType(dataType?: unknown): { type: string; args?: string } {
  if (typeof dataType !== 'string' || !dataType.trim()) return { type: 'string' };
  const { base, args } = parseTypeName(dataType);
  return { type: base, args };
}

/** Extrai o nome de `ref('x')`; aceita aspas opcionais ou nome puro. */
function unwrapRef(expr: unknown): string {
  const s = String(expr ?? '');
  const m = /ref\(\s*['"]?([^'")\s]+)['"]?\s*\)/.exec(s);
  return m ? m[1] : s.trim();
}

const tableKey = (t: Pick<Table, 'name' | 'schema'>) => `${t.schema ?? ''}.${t.name}`.toLowerCase();

const MATERIALIZATIONS = new Set(['table', 'view', 'incremental', 'ephemeral']);
function asMaterialization(v?: string): Table['materialization'] | undefined {
  return v && MATERIALIZATIONS.has(v) ? (v as Table['materialization']) : undefined;
}

/**
 * Aplica os tests crus de uma coluna, mutando-a e empurrando Refs.
 * unique+not_null na primeira ocorrência da tabela → PK; nas seguintes → unique + not null.
 */
function applyColumnTests(
  table: Table,
  col: Column,
  rawTests: unknown[],
  pkAssigned: { value: boolean },
  refs: Ref[],
): void {
  let hasUnique = false;
  let hasNotNull = false;
  for (const t of rawTests) {
    if (t === 'unique') hasUnique = true;
    else if (t === 'not_null') hasNotNull = true;
    else if (t && typeof t === 'object') {
      const o = t as Record<string, any>;
      if (o.accepted_values) {
        const values = (o.accepted_values.values ?? []).map(String);
        (col.tests ??= []).push({ kind: 'accepted_values', values });
      } else if (o.relationships) {
        refs.push({
          from: { table: table.name, column: col.name },
          to: { table: unwrapRef(o.relationships.to), column: String(o.relationships.field ?? '') },
          kind: '>',
        });
      }
    }
  }
  if (hasUnique && hasNotNull && !pkAssigned.value) {
    col.pk = true;
    col.nullable = false;
    pkAssigned.value = true;
  } else {
    if (hasUnique) col.unique = true;
    if (hasNotNull) col.nullable = false;
  }
}

/** Resolve tests de todas as colunas de uma tabela (rastreando a PK por tabela). */
function finalizeTests(table: Table, rawByCol: Map<string, unknown[]>, refs: Ref[]): void {
  const pkAssigned = { value: false };
  for (const col of table.columns) {
    applyColumnTests(table, col, rawByCol.get(col.name) ?? [], pkAssigned, refs);
  }
}

const rawTestsOf = (c: any): unknown[] => c?.data_tests ?? c?.tests ?? [];

// ---------------------------------------------------------------------------
// 1. schema.yml / properties.yml
// ---------------------------------------------------------------------------

function parseModelEntry(m: any, defaultSchema: string | undefined, refs: Ref[], acc: LdbAcc): Table {
  const table: Table = { name: m.name, columns: [] };
  if (defaultSchema) table.schema = defaultSchema;
  if (m.description) table.note = String(m.description);
  const config = m.config ?? {};
  if (config.materialized) table.materialization = config.materialized;
  const tags = config.tags ?? m.tags;
  if (Array.isArray(tags) && tags.length) table.tags = tags.map(String);

  const rawByCol = new Map<string, unknown[]>();
  for (const c of m.columns ?? []) {
    const col: Column = { name: c.name, ...colFromType(c.data_type) };
    if (c.description) col.note = String(c.description);
    table.columns.push(col);
    rawByCol.set(c.name, rawTestsOf(c));
  }
  finalizeTests(table, rawByCol, refs);
  applyLdbMeta(table, m, acc);
  return table;
}

function parseSourceTable(st: any, schema: string | undefined, refs: Ref[], acc: LdbAcc): Table {
  const table: Table = { name: st.name, columns: [], resourceType: 'source' };
  if (schema) table.schema = schema;
  if (st.description) table.note = String(st.description);
  const rawByCol = new Map<string, unknown[]>();
  for (const c of st.columns ?? []) {
    const col: Column = { name: c.name, ...colFromType(c.data_type) };
    if (c.description) col.note = String(c.description);
    table.columns.push(col);
    rawByCol.set(c.name, rawTestsOf(c));
  }
  finalizeTests(table, rawByCol, refs);
  applyLdbMeta(table, st, acc);
  return table;
}

/** schema.yml/properties.yml avulso → Model. `defaultSchema` aplica-se aos models. */
export function schemaYmlToModel(content: string, defaultSchema?: string): Model {
  let doc: any;
  try {
    doc = yaml.load(content);
  } catch {
    return { tables: [], refs: [] };
  }
  const tables: Table[] = [];
  const refs: Ref[] = [];
  const acc = newLdbAcc();
  if (doc && Array.isArray(doc.models)) {
    for (const m of doc.models) tables.push(parseModelEntry(m, defaultSchema, refs, acc));
  }
  if (doc && Array.isArray(doc.sources)) {
    for (const s of doc.sources) {
      const schema = s.schema ?? s.name;
      for (const st of s.tables ?? []) tables.push(parseSourceTable(st, schema, refs, acc));
    }
  }
  return applyLdbAcc({ tables, refs }, acc);
}

// ---------------------------------------------------------------------------
// 2. Projeto dbt em pasta (schema.yml + *.sql)
// ---------------------------------------------------------------------------

/** Schema = diretório-pai imediato do arquivo, exceto 'models'/raiz. */
function schemaFromPath(filePath: string): string | undefined {
  const parts = filePath.split('/').filter(Boolean);
  const parent = parts[parts.length - 2];
  if (!parent || parent === 'models' || parent === 'seeds') return undefined;
  return parent;
}

function extractSqlDeps(sql: string): {
  deps: string[];
  materialized?: string;
  tags?: string[];
} {
  const deps: string[] = [];
  for (const m of sql.matchAll(/\{\{\s*ref\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g)) deps.push(m[1]);
  for (const m of sql.matchAll(/\{\{\s*source\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g)) {
    deps.push(m[1]);
  }
  const cfg = /\{\{\s*config\(([\s\S]*?)\)\s*\}\}/.exec(sql);
  let materialized: string | undefined;
  let tags: string[] | undefined;
  if (cfg) {
    const mm = /materialized\s*=\s*['"]([^'"]+)['"]/.exec(cfg[1]);
    if (mm) materialized = mm[1];
    const tm = /tags\s*=\s*\[([^\]]*)\]/.exec(cfg[1]);
    if (tm) {
      tags = tm[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
  }
  return { deps: [...new Set(deps)], materialized, tags };
}

/** Projeto em pasta (lista de arquivos yml+sql) → Model. */
export function dbtProjectToModel(files: { file: string; content: string }[]): Model {
  const byKey = new Map<string, Table>();
  const refs: Ref[] = [];
  const acc = newLdbAcc();
  const refSeen = new Set<string>();
  const addRef = (r: Ref) => {
    const k = `${r.from.table}.${r.from.column}->${r.to.table}.${r.to.column}`.toLowerCase();
    if (!refSeen.has(k)) {
      refSeen.add(k);
      refs.push(r);
    }
  };

  for (const f of files) {
    if (!/\.ya?ml$/i.test(f.file)) continue;
    let doc: any;
    try {
      doc = yaml.load(f.content);
    } catch {
      continue;
    }
    // dbt_project.yml tem `models:` como objeto (config), não array — ignorado.
    if (!doc || (!Array.isArray(doc.models) && !Array.isArray(doc.sources))) continue;
    const m = schemaYmlToModel(f.content, schemaFromPath(f.file));
    for (const t of m.tables) byKey.set(tableKey(t), t);
    for (const r of m.refs) addRef(r);
    Object.assign(acc.colors, m.colors ?? {});
    Object.assign(acc.layerColors, m.layerColors ?? {});
    if (m.lineageFields?.length) acc.lineageFields.push(...m.lineageFields);
  }

  const lineage: LineageEntry[] = [];
  for (const f of files) {
    if (!/\.sql$/i.test(f.file)) continue;
    const name = (f.file.split('/').pop() ?? f.file).replace(/\.sql$/i, '');
    const { deps, materialized, tags } = extractSqlDeps(f.content);
    let table = [...byKey.values()].find((t) => t.name === name);
    if (!table) {
      table = { name, columns: [] };
      const s = schemaFromPath(f.file);
      if (s) table.schema = s;
      byKey.set(tableKey(table), table);
    }
    if (!table.materialization) table.materialization = asMaterialization(materialized);
    if (!table.tags && tags?.length) table.tags = tags;
    if (deps.length) {
      // Qualifica pelo schema quando a tabela é conhecida (ref()/source() usam nome cru).
      const byName = (n: string) => [...byKey.values()].find((t) => t.name === n);
      const sources = deps.map((d) => {
        const src = byName(d);
        return src ? qualifiedName(src) : d;
      });
      lineage.push({ target: qualifiedName(table), sources });
    }
  }

  return applyLdbAcc(
    { tables: [...byKey.values()], refs, ...(lineage.length ? { lineage } : {}) },
    acc,
  );
}

// ---------------------------------------------------------------------------
// 3. dbt-docs (manifest.json) — meta.localdrawdb fora do escopo (v18-11)
// ---------------------------------------------------------------------------

const MODEL_RESOURCE = new Set(['model', 'seed', 'snapshot']);

export function manifestToModel(manifest: any): Model {
  const nodes: Record<string, any> = manifest?.nodes ?? {};
  const sources: Record<string, any> = manifest?.sources ?? {};
  const byId = new Map<string, Table>();
  const nameById = new Map<string, string>();
  const rawTestsByTable = new Map<string, Map<string, unknown[]>>();
  const refs: Ref[] = [];

  const addColumns = (table: Table, cols: Record<string, any> | undefined) => {
    for (const [cname, c] of Object.entries(cols ?? {})) {
      const col: Column = { name: c?.name ?? cname, ...colFromType(c?.data_type) };
      if (c?.description) col.note = String(c.description);
      table.columns.push(col);
    }
  };

  // Models / seeds / snapshots
  for (const [id, n] of Object.entries(nodes)) {
    if (!MODEL_RESOURCE.has(n?.resource_type)) continue;
    const table: Table = { name: n.name, columns: [] };
    if (n.schema) table.schema = n.schema;
    if (n.description) table.note = String(n.description);
    if (n.resource_type !== 'model') table.resourceType = n.resource_type;
    const config = n.config ?? {};
    if (config.materialized) table.materialization = config.materialized;
    if (Array.isArray(config.tags) && config.tags.length) table.tags = config.tags.map(String);
    addColumns(table, n.columns);
    byId.set(id, table);
    nameById.set(id, n.name);
  }

  // Sources
  for (const [id, s] of Object.entries(sources)) {
    const table: Table = { name: s.name, columns: [], resourceType: 'source' };
    if (s.schema) table.schema = s.schema;
    if (s.description) table.note = String(s.description);
    addColumns(table, s.columns);
    byId.set(id, table);
    nameById.set(id, s.name);
  }

  // Tests → coleta crua por (tabela, coluna)
  for (const n of Object.values(nodes)) {
    if (n?.resource_type !== 'test') continue;
    const meta = n.test_metadata ?? {};
    const kind = meta.name;
    const kwargs = meta.kwargs ?? {};
    const colName = n.column_name ?? kwargs.column_name;
    const modelId = (n.depends_on?.nodes ?? []).find((d: string) => byId.has(d));
    if (!modelId || !colName || !kind) continue;
    const perCol = rawTestsByTable.get(modelId) ?? new Map<string, unknown[]>();
    const list = perCol.get(colName) ?? [];
    if (kind === 'unique' || kind === 'not_null') list.push(kind);
    else if (kind === 'accepted_values') list.push({ accepted_values: { values: kwargs.values ?? [] } });
    else if (kind === 'relationships') list.push({ relationships: { to: kwargs.to, field: kwargs.field } });
    perCol.set(colName, list);
    rawTestsByTable.set(modelId, perCol);
  }

  // Aplica tests + monta lineage
  const lineage: LineageEntry[] = [];
  for (const [id, table] of byId) {
    const perCol = rawTestsByTable.get(id) ?? new Map();
    finalizeTests(table, perCol, refs);
  }
  for (const [id, n] of Object.entries(nodes)) {
    if (!MODEL_RESOURCE.has(n?.resource_type)) continue;
    const sourcesOf = (n.depends_on?.nodes ?? [])
      .filter((d: string) => byId.has(d))
      .map((d: string) => nameById.get(d)!)
      .filter(Boolean);
    if (sourcesOf.length) lineage.push({ target: n.name, sources: [...new Set<string>(sourcesOf)] });
  }

  return { tables: [...byId.values()], refs, ...(lineage.length ? { lineage } : {}) };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Detecta o formato dbt entre os arquivos e produz o Model.
 * Preferência: manifest.json (mais robusto) > projeto/schema.yml. null se não houver dbt.
 */
export function dbtFilesToModel(files: { file: string; content: string }[]): Model | null {
  const manifest = files.find((f) => /(^|\/)manifest\.json$/i.test(f.file));
  if (manifest) {
    try {
      return manifestToModel(JSON.parse(manifest.content));
    } catch {
      // manifest ilegível — cai para os demais formatos
    }
  }
  const hasYml = files.some((f) => /\.ya?ml$/i.test(f.file));
  const hasJinjaSql = files.some((f) => /\.sql$/i.test(f.file) && /\{\{/.test(f.content));
  if (!hasYml && !hasJinjaSql) return null;
  const model = dbtProjectToModel(files);
  return model.tables.length ? model : null;
}
