// Conversão DBML <-> modelo canônico.
// DBML é a fonte de verdade do projeto; o modelo é o intermediário para os geradores.
import { Parser } from '@dbml/core';
import { quoteDbmlNote } from '../src/dsl/dbmlNotes.ts';
import { extractRecords } from './dbmlClean.ts';
import { parseTypeName, qualifiedName } from './model.ts';
import type { Column, ColumnTest, FieldLineageEntry, LineageEntry, Model, Ref, Table } from './model.ts';

const REL_TO_KIND: Record<string, '>' | '<' | '-' | '<>'> = {
  '*': '>', // muitos -> um (lado "from")
  '1': '-',
};

const stripQuotes = (s: string) => s.replace(/["`]/g, '').trim();

function indexColName(c: unknown): string {
  if (typeof c === 'string') return c;
  const o = c as { value?: string; name?: string };
  return o?.value ?? o?.name ?? '';
}

function isDegenerateRef(r: Ref): boolean {
  return (
    r.from.table.toLowerCase() === r.to.table.toLowerCase() &&
    r.from.column.toLowerCase() === r.to.column.toLowerCase()
  );
}

function tableIdMatches(a: string, b: string): boolean {
  const x = stripQuotes(a).toLowerCase();
  const y = stripQuotes(b).toLowerCase();
  if (x === y) return true;
  const lastX = x.split('.').pop()!;
  const lastY = y.split('.').pop()!;
  return lastX === lastY && (x.endsWith('.' + lastY) || y.endsWith('.' + lastX));
}

/** Faz parse de uma string DBML para o modelo canônico (inclui LayerGroup, Records, PK composta, Dbt). */
export function dbmlToModel(dbml: string): Model {
  const { clean, records, layerGroups, lineage, lineageFields, dbtTables, colors } =
    extractRecords(dbml);
  const db = Parser.parse(clean, 'dbml');
  const tables: Table[] = [];
  const refs: Ref[] = [];

  for (const schema of db.schemas) {
    const schemaName = schema.name && schema.name !== 'public' ? schema.name : undefined;

    for (const t of schema.tables) {
      const compositePks: string[][] = [];
      const columns: Column[] = t.fields.map((f: any) => {
        const { base, args } = parseTypeName(f.type.type_name);
        return {
          name: f.name,
          type: base,
          args,
          pk: !!f.pk,
          nullable: f.not_null ? false : true,
          unique: !!f.unique || undefined,
          note: f.note || undefined,
        };
      });

      for (const idx of (t as any).indexes ?? []) {
        const cols = (idx.columns ?? []).map(indexColName).filter(Boolean);
        if (idx.pk && cols.length > 1) {
          compositePks.push(cols);
          for (const n of cols) {
            const col = columns.find((c) => c.name === n);
            if (col) {
              col.pk = true;
              col.nullable = false;
            }
          }
        }
      }

      tables.push({
        name: t.name,
        schema: schemaName,
        columns,
        note: t.note || undefined,
        group: t.group?.name || undefined,
        compositePks: compositePks.length ? compositePks : undefined,
      });
    }

    for (const r of schema.refs) {
      const [a, b] = r.endpoints;
      const fromEp = a.relation === '*' ? a : b;
      const toEp = fromEp === a ? b : a;
      const epName = (ep: any) =>
        ep.schemaName && ep.schemaName !== 'public'
          ? `${ep.schemaName}.${ep.tableName}`
          : ep.tableName;
      const ref: Ref = {
        from: { table: epName(fromEp), column: fromEp.fieldNames[0] },
        to: { table: epName(toEp), column: toEp.fieldNames[0] },
        kind: REL_TO_KIND[fromEp.relation] ?? '>',
      };
      if (!isDegenerateRef(ref)) refs.push(ref);
    }
  }

  for (const lg of layerGroups) {
    for (const member of lg.tables) {
      const t = tables.find((x) => tableIdMatches(qualifiedName(x), member));
      if (t) t.layer = lg.name;
    }
  }

  for (const rec of records) {
    const t = tables.find((x) => tableIdMatches(qualifiedName(x), rec.table) || x.name === rec.table);
    if (!t) continue;
    if (rec.rows.length) {
      t.records = {
        columns: rec.columns.length ? rec.columns : t.columns.map((c) => c.name),
        rows: rec.rows,
      };
    }
    if (rec.note) {
      t.note = rec.note;
      t.noteInRecordsOnly = true;
    }
  }

  // Aplica metadados dbt (bloco Dbt { }) às tabelas correspondentes
  for (const dbt of dbtTables) {
    const t = tables.find((x) => tableIdMatches(qualifiedName(x), dbt.tableName));
    if (!t) continue;
    if (dbt.resourceType) t.resourceType = dbt.resourceType;
    if (dbt.materialization) t.materialization = dbt.materialization;
    if (dbt.tags?.length) t.tags = [...dbt.tags];
    if (dbt.meta && Object.keys(dbt.meta).length) t.dbtMeta = { ...dbt.meta };

    // Testes accepted_values por coluna (unique/not_null são derivados do DBML nativo)
    if (dbt.columns) {
      for (const [colName, colDbt] of Object.entries(dbt.columns)) {
        const col = t.columns.find((c) => c.name === colName);
        if (!col) continue;
        const tests: ColumnTest[] = col.tests ? [...col.tests] : [];
        if (colDbt.acceptedValues?.length) {
          tests.push({ kind: 'accepted_values', values: colDbt.acceptedValues });
        }
        if (tests.length) col.tests = tests;
      }
    }
  }

  const modelLineage: LineageEntry[] | undefined = lineage.length
    ? lineage.map((l) => ({ target: l.target, sources: [...l.sources] }))
    : undefined;
  const modelLineageFields: FieldLineageEntry[] | undefined = lineageFields.length
    ? lineageFields.map((f) => ({ ...f }))
    : undefined;

  const modelColors: Record<string, string> = {};
  for (const c of colors) modelColors[c.table] = c.color;
  const modelLayerColors: Record<string, string> = {};
  for (const lg of layerGroups) {
    if (lg.color) modelLayerColors[lg.name] = lg.color;
  }

  return {
    tables,
    refs,
    lineage: modelLineage,
    lineageFields: modelLineageFields,
    colors: Object.keys(modelColors).length ? modelColors : undefined,
    layerColors: Object.keys(modelLayerColors).length ? modelLayerColors : undefined,
  };
}

function quoteNote(note: string): string {
  return quoteDbmlNote(note);
}

/** Serializa o modelo canônico de volta para DBML (texto versionável). */
export function modelToDbml(model: Model): string {
  const out: string[] = [];

  for (const t of model.tables) {
    out.push(`Table ${qualifiedName(t)} {`);
    const compositeOnly = new Set(
      (t.compositePks ?? []).filter((g) => g.length > 1).flat(),
    );
    for (const c of t.columns) {
      const type = c.args ? `${c.type}(${c.args})` : c.type;
      const settings: string[] = [];
      const isPk = c.pk && !compositeOnly.has(c.name);
      if (isPk) settings.push('pk');
      // PK já implica not null — omite o setting explícito para não duplicar
      if (c.nullable === false && !isPk) settings.push('not null');
      if (c.unique) settings.push('unique');
      if (c.note) settings.push(`note: ${quoteNote(c.note)}`);
      const suffix = settings.length ? ` [${settings.join(', ')}]` : '';
      out.push(`  ${c.name} ${type}${suffix}`);
    }
    for (const group of t.compositePks ?? []) {
      if (group.length > 1) out.push(`  indexes {\n    (${group.join(', ')}) [pk]\n  }`);
    }
    if (t.note && !t.noteInRecordsOnly) out.push(`  Note: ${quoteNote(t.note)}`);
    out.push('}');
    out.push('');
  }

  for (const r of model.refs) {
    out.push(
      `Ref: ${r.from.table}.${r.from.column} ${r.kind} ${r.to.table}.${r.to.column}`,
    );
  }

  if (model.lineage?.length) {
    out.push('');
    out.push('Lineage {');
    for (const entry of model.lineage) {
      out.push(`  ${entry.target} < ${entry.sources.join(', ')}`);
    }
    out.push('}');
  }

  if (model.lineageFields?.length) {
    out.push('');
    out.push('LineageFields {');
    for (const f of model.lineageFields) {
      const settings: string[] = [];
      if (f.note) settings.push(`note: ${quoteNote(f.note)}`);
      if (f.ref) settings.push(`ref: ${quoteNote(f.ref)}`);
      const suffix = settings.length ? ` [${settings.join(', ')}]` : '';
      out.push(`  ${f.targetTable}.${f.targetColumn} < ${f.sourceTable}.${f.sourceColumn}${suffix}`);
    }
    out.push('}');
  }

  const groups = new Map<string, string[]>();
  for (const t of model.tables) {
    if (t.group) {
      const list = groups.get(t.group) ?? [];
      list.push(qualifiedName(t));
      groups.set(t.group, list);
    }
  }
  if (groups.size) out.push('');
  for (const [name, members] of groups) {
    out.push(`TableGroup ${name} {`);
    for (const m of members) out.push(`  ${m}`);
    out.push('}');
  }

  const layers = new Map<string, string[]>();
  for (const t of model.tables) {
    if (t.layer) {
      const list = layers.get(t.layer) ?? [];
      list.push(qualifiedName(t));
      layers.set(t.layer, list);
    }
  }
  if (layers.size) out.push('');
  for (const [name, members] of layers) {
    const color = model.layerColors?.[name];
    out.push(`LayerGroup ${name}${color ? ` [color: ${color}]` : ''} {`);
    for (const m of members) out.push(`  ${m}`);
    out.push('}');
  }

  for (const t of model.tables) {
    const hasRows = t.records && t.records.rows.length;
    const hasImportNote = t.note && (t.noteInRecordsOnly || hasRows);
    if (!hasRows && !hasImportNote) continue;
    const qn = qualifiedName(t);
    const colHeader = t.records?.columns.length ? `(${t.records.columns.join(', ')})` : '';
    out.push('');
    out.push(`Records ${qn}${colHeader} {`);
    if (hasImportNote && t.note) out.push(`  Note: ${quoteNote(t.note)}`);
    for (const row of t.records?.rows ?? []) {
      out.push(`  ${row.map((v) => (/[,']/.test(v) ? `'${v}'` : v)).join(', ')}`);
    }
    out.push('}');
  }

  // Bloco Dbt { } — emitido apenas quando há metadados dbt em alguma tabela.
  // Colunas PK omitem unique/not_null (já implícitos); accepted_values vão aqui.
  // unique/not_null são derivados do DBML nativo; relationships são derivados de Refs.
  const dbtLines: string[] = [];
  for (const t of model.tables) {
    const qn = qualifiedName(t);
    const tableLines: string[] = [];

    if (t.resourceType) tableLines.push(`    resource_type: ${t.resourceType}`);
    if (t.materialization) tableLines.push(`    materialization: ${t.materialization}`);
    if (t.tags?.length) {
      const tagList = t.tags.map((tag) => `'${tag}'`).join(', ');
      tableLines.push(`    tags: [${tagList}]`);
    }
    if (t.dbtMeta && Object.keys(t.dbtMeta).length) {
      tableLines.push('    meta {');
      for (const [key, val] of Object.entries(t.dbtMeta)) {
        const serialized = typeof val === 'string' ? `'${val}'` : String(val);
        tableLines.push(`      ${key}: ${serialized}`);
      }
      tableLines.push('    }');
    }

    // Testes accepted_values por coluna (unique/not_null derivados nativamente)
    const colLines: string[] = [];
    for (const c of t.columns) {
      const avTests = (c.tests ?? []).filter((test) => test.kind === 'accepted_values') as
        Array<{ kind: 'accepted_values'; values: string[] }>;
      if (avTests.length) {
        const valList = avTests[0].values.map((v) => `'${v}'`).join(', ');
        colLines.push(`      ${c.name} {`);
        colLines.push(`        accepted_values: [${valList}]`);
        colLines.push('      }');
      }
    }
    if (colLines.length) {
      tableLines.push('    columns {');
      tableLines.push(...colLines);
      tableLines.push('    }');
    }

    if (tableLines.length) {
      dbtLines.push(`  table ${qn} {`);
      dbtLines.push(...tableLines);
      dbtLines.push('  }');
    }
  }

  if (dbtLines.length) {
    out.push('');
    out.push('Dbt {');
    out.push(...dbtLines);
    out.push('}');
  }

  const colorEntries = Object.entries(model.colors ?? {});
  if (colorEntries.length) {
    out.push('');
    out.push('Colors {');
    for (const [key, color] of colorEntries) out.push(`  ${key}: ${color}`);
    out.push('}');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
