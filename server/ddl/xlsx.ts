// Gerador XLSX (dicionário de dados em aba única).
//
// Layout da aba "Dicionário":
//   schema | tabela | coluna | tipo | pk | not_null | nullable | default |
//   fk_target | description | constraints | table_note | tags
//
// Cada linha = 1 coluna do modelo. A coluna `tabela` se repete para
// facilitar filtros no Excel; `table_note` repete o note da tabela em
// todas as linhas dela (preserva contexto quando o usuário filtra).

import * as XLSX from 'xlsx';
import type { ColumnTest, Model, Table, Ref } from '../model.ts';

const HEADERS = [
  'schema',
  'tabela',
  'coluna',
  'tipo',
  'pk',
  'nullable',
  'default',
  'fk_target',
  'description',
  'constraints',
  'examples',
  'table_note',
  'tags',
] as const;

function fkTarget(table: Table, column: string, refs: Ref[]): string {
  for (const r of refs) {
    if (r.from.table === table.name && r.from.column === column) {
      return `${r.to.table}.${r.to.column}`;
    }
  }
  return '';
}

function constraintsFor(col: { tests?: ColumnTest[] }): string {
  if (!col.tests?.length) return '';
  return col.tests
    .map((t: ColumnTest): string => {
      switch (t.kind) {
        case 'accepted_values':
          return `[${t.values.join(', ')}]`;
        case 'unique':
          return 'unique';
        case 'not_null':
          return 'not_null';
        case 'relationships':
          return `relationships → ${t.to}.${t.field}`;
      }
    })
    .join('; ');
}

function examplesFor(table: Table, column: string): string {
  const rec = table.records;
  if (!rec) return '';
  const idx = rec.columns.indexOf(column);
  if (idx < 0) return '';
  const seen = new Set<string>();
  const examples: string[] = [];
  for (const row of rec.rows) {
    const v = row[idx];
    if (v == null || v === '') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    examples.push(v);
    if (examples.length >= 5) break;
  }
  return examples.join(', ');
}

function rowFor(table: Table, column: string, refs: Ref[]): (string | number)[] {
  const col = table.columns.find((c) => c.name === column);
  if (!col) return [];
  const isPk = !!col.pk;
  const isNN = col.nullable === false;
  return [
    table.schema ?? '',
    table.name,
    col.name,
    col.args ? `${col.type}(${col.args})` : col.type,
    isPk ? 'PK' : '',
    isNN ? 'NO' : 'YES',
    '', // default — DBML não tem sintaxe explícita; fica em examples
    fkTarget(table, col.name, refs),
    col.note ?? '',
    constraintsFor(col),
    examplesFor(table, col.name),
    table.note ?? '',
    (table.tags ?? []).join(', '),
  ];
}

export function modelToDicionarioXlsx(model: Model): Buffer {
  const rows: (string | number)[][] = [HEADERS as unknown as string[]];

  for (const table of model.tables) {
    for (const col of table.columns) {
      const r = rowFor(table, col.name, model.refs);
      if (r.length) rows.push(r);
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  // Larguras razoáveis para visualização inicial no Excel.
  sheet['!cols'] = [
    { wch: 12 }, // schema
    { wch: 24 }, // tabela
    { wch: 22 }, // coluna
    { wch: 14 }, // tipo
    { wch: 4 },  // pk
    { wch: 10 }, // nullable
    { wch: 10 }, // default
    { wch: 28 }, // fk_target
    { wch: 40 }, // description
    { wch: 30 }, // constraints
    { wch: 30 }, // examples
    { wch: 40 }, // table_note
    { wch: 22 }, // tags
  ];

  // Congela a primeira linha.
  sheet['!freeze'] = { ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Dicionário');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}