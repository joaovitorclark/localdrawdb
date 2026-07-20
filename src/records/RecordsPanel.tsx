import { useEffect, useMemo, useState } from 'react';
import type { ParsedRecords } from '../dsl/records';
import { getColumnSettings, setColumnSetting, setTableOrRecordsNote } from '../dsl/edit';
import { useInteraction } from '../store/interaction';
import type { ParsedFieldLineage, RefView, TableView } from '../dsl/parse';
import { Chevron } from '../icons';
import { useCollapsePersist } from '../hooks/useCollapsePersist';

type Props = {
  records: ParsedRecords[];
  tables: TableView[];
  refs: RefView[];
  lineageFields?: ParsedFieldLineage[];
  dbml: string;
  onApply: (next: string) => void;
  onFocusTable?: (tableId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const RECORDS_OPEN_KEY = 'localdrawdb.recordsPanelOpen';

export function parseRecordsOpen(raw: string | null): boolean {
  return raw === '1';
}

export function loadRecordsOpen(): boolean {
  try {
    return parseRecordsOpen(localStorage.getItem(RECORDS_OPEN_KEY));
  } catch {
    return false;
  }
}

/** Constraints da tabela ativa, derivadas das colunas (pk/notNull) e dos refs (FK). */
function tableConstraints(table: TableView | undefined, refs: RefView[]) {
  if (!table) return { pks: [] as string[], composites: [] as string[][], fks: [] as { col: string; target: string }[], notNull: [] as string[] };
  const pks = table.columns.filter((c) => c.pk).map((c) => c.name);
  const composites = (table.compositePks ?? []).filter((g) => g.length > 1);
  const notNull = table.columns.filter((c) => c.notNull && !c.pk).map((c) => c.name);
  const fks = refs
    .filter((r) => r.source === table.id || r.source === table.name)
    .map((r) => ({ col: r.fromCol, target: `${r.target}.${r.toCol}` }));
  return { pks, composites, fks, notNull };
}

function NoteField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  // Sincroniza com o valor externo (ex.: troca de tabela) só quando não está
  // focado — evita derrubar o que o usuário está digitando.
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  return (
    <label className="records-note-field">
      <span className="records-note-field__label">{label}</span>
      <textarea
        className="records-note-field__input"
        value={draft}
        placeholder={placeholder}
        rows={2}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) onChange(draft);
        }}
      />
    </label>
  );
}

export function RecordsPanel({ records, tables, refs, lineageFields, dbml, onApply, onFocusTable, open: openProp, onOpenChange }: Props) {
  // Persistência via hook unificado (v18-05); prop `open` permite controle externo (v18-07).
  const [collapsed, togglePersisted] = useCollapsePersist('ldb.panel.records', true);
  const open = openProp ?? !collapsed;
  const toggleOpen = () => {
    onOpenChange?.(!open);
    togglePersisted();
  };
  const selectedTable = useInteraction((s) => s.selectedTable);
  const selectedColumn = useInteraction((s) => s.selectedColumn);
  const selectedGroup = useInteraction((s) => s.selectedGroup);

  const effectiveTableId = selectedColumn?.table ?? selectedTable;

  const filtered = useMemo(() => {
    if (selectedGroup) {
      const groupTables = tables.filter((t) => t.group === selectedGroup);
      const ids = new Set(groupTables.map((t) => t.id));
      const names = new Set(groupTables.map((t) => t.name));
      return records.filter((r) => ids.has(r.table) || names.has(r.table));
    }
    if (effectiveTableId) {
      const table = tables.find((t) => t.id === effectiveTableId);
      return records.filter((r) => r.table === effectiveTableId || r.table === table?.name);
    }
    return [];
  }, [records, effectiveTableId, selectedGroup, tables]);

  const activeTable = useMemo(
    () => (effectiveTableId ? tables.find((t) => t.id === effectiveTableId) : undefined),
    [effectiveTableId, tables],
  );

  const constraints = useMemo(() => tableConstraints(activeTable, refs), [activeTable, refs]);
  const hasConstraints =
    constraints.pks.length > 0 ||
    constraints.composites.length > 0 ||
    constraints.fks.length > 0 ||
    constraints.notNull.length > 0;

  const activeRecord = useMemo(() => {
    if (!effectiveTableId) return undefined;
    return records.find((r) => r.table === effectiveTableId || r.table === activeTable?.name);
  }, [records, effectiveTableId, activeTable?.name]);

  const tableNote = activeRecord?.note ?? activeTable?.note ?? '';

  const columnSettings = useMemo(
    () =>
      selectedColumn
        ? getColumnSettings(dbml, selectedColumn.table, selectedColumn.column)
        : null,
    [dbml, selectedColumn],
  );

  const noteOnlyEntries = useMemo(() => {
    if (selectedGroup) {
      return tables
        .filter((t) => t.group === selectedGroup && t.note)
        .filter((t) => !filtered.some((r) => r.table === t.id || r.table === t.name))
        .map((t) => ({ table: t.id, note: t.note! }));
    }
    return [];
  }, [selectedGroup, tables, filtered]);

  // L1: origens da tabela (tabelas que alimentam esta via FK RefView).
  // Uma tabela "fonte" para `effectiveTableId` é aquela cuja FK aponta para esta
  // (source !== effectiveTableId && target === effectiveTableId), ou a própria
  // tabela que serve como pai em self-refs. Mostra fontes upstream + downstream.
  const l1Sources = useMemo(() => {
    if (!effectiveTableId) return [] as { table: string; via: string; direction: 'up' | 'down' }[];
    const out: { table: string; via: string; direction: 'up' | 'down' }[] = [];
    for (const r of refs) {
      const sourceIsThis = r.source === effectiveTableId;
      const targetIsThis = r.target === effectiveTableId;
      if (!sourceIsThis && !targetIsThis) continue;
      const other = sourceIsThis ? r.target : r.source;
      out.push({ table: other, via: r.fromCol, direction: sourceIsThis ? 'down' : 'up' });
    }
    return out;
  }, [refs, effectiveTableId]);

  // L2: origens do campo selecionado (ParsedFieldLineage.target = sel.table/col).
  const l2Sources = useMemo(() => {
    if (!selectedColumn || !lineageFields) return [] as ParsedFieldLineage[];
    return lineageFields.filter(
      (m) => m.targetTable === selectedColumn.table && m.targetColumn === selectedColumn.column,
    );
  }, [lineageFields, selectedColumn]);

  const panelCount = filtered.length + noteOnlyEntries.length + (effectiveTableId ? 1 : 0);

  if (!effectiveTableId && !selectedGroup) return null;
  if (!panelCount && !effectiveTableId) return null;

  const applyTableNote = (note: string) => {
    if (!effectiveTableId) return;
    onApply(setTableOrRecordsNote(dbml, effectiveTableId, note));
  };

  const applyColumnNote = (note: string) => {
    if (!selectedColumn || !columnSettings) return;
    onApply(
      setColumnSetting(dbml, selectedColumn.table, selectedColumn.column, {
        ...columnSettings,
        note,
      }),
    );
  };

  return (
    <div className={`records-panel ${open ? 'is-open' : ''}`}>
      <button className="records-panel__toggle" onClick={toggleOpen}>
        <Chevron dir={open ? 'down' : 'right'} className="icon-inline" size={14} />
        {' '}Dados (amostra) · {Math.max(panelCount, 1)} tabela(s)
      </button>
      {open && (
        <div className="records-panel__body">
          {effectiveTableId && (
            <div className="records-table records-table--notes">
              <div className="records-table__title">{effectiveTableId}</div>
              <NoteField
                label="Nota da tabela"
                value={tableNote}
                placeholder="Descrição ou contexto da tabela…"
                onChange={applyTableNote}
              />
              {selectedColumn && (
                <NoteField
                  label={`Nota · ${selectedColumn.column}`}
                  value={columnSettings?.note ?? ''}
                  placeholder="Descrição da coluna…"
                  onChange={applyColumnNote}
                />
              )}
              {l1Sources.length > 0 && (
                <div className="records-constraints">
                  <div className="records-constraints__title">Origem L1</div>
                  {l1Sources.map((src, i) => (
                    <div key={`l1:${i}`} className="records-constraints__row records-constraints__row--l1">
                      <span className={`records-constraints__tag records-constraints__tag--${src.direction}`}>
                        {src.direction === 'up' ? '↑' : '↓'}
                      </span>
                      {onFocusTable ? (
                        <button
                          type="button"
                          className="records-constraints__link"
                          onClick={() => onFocusTable(src.table)}
                          title={`Ir para ${src.table}`}
                        >
                          {src.table}
                        </button>
                      ) : (
                        src.table
                      )}
                      <span className="records-constraints__via">via {src.via}</span>
                    </div>
                  ))}
                </div>
              )}
              {selectedColumn && l2Sources.length > 0 && (
                <div className="records-constraints">
                  <div className="records-constraints__title">Origem L2 (campo)</div>
                  {l2Sources.map((m, i) => (
                    <div key={`l2:${i}`} className="records-constraints__row records-constraints__row--l2">
                      <span className="records-constraints__tag records-constraints__tag--l2">L2</span>
                      {onFocusTable ? (
                        <button
                          type="button"
                          className="records-constraints__link"
                          onClick={() => onFocusTable(m.sourceTable)}
                          title={`Ir para ${m.sourceTable}`}
                        >
                          {m.sourceTable}.{m.sourceColumn}
                        </button>
                      ) : (
                        <span>
                          {m.sourceTable}.{m.sourceColumn}
                        </span>
                      )}
                      {m.note && <span className="records-constraints__via">— {m.note}</span>}
                    </div>
                  ))}
                </div>
              )}
              {hasConstraints && (
                <div className="records-constraints">
                  <div className="records-constraints__title">Constraints</div>
                  {constraints.pks.length > 0 && (
                    <div className="records-constraints__row">
                      <span className="records-constraints__tag records-constraints__tag--pk">PK</span>
                      {constraints.pks.join(', ')}
                    </div>
                  )}
                  {constraints.composites.map((g, i) => (
                    <div key={`cpk:${i}`} className="records-constraints__row">
                      <span className="records-constraints__tag records-constraints__tag--pk">PK</span>({g.join(', ')})
                    </div>
                  ))}
                  {constraints.fks.map((fk, i) => (
                    <div key={`fk:${i}`} className="records-constraints__row">
                      <span className="records-constraints__tag records-constraints__tag--fk">FK</span>
                      {fk.col} → {fk.target}
                    </div>
                  ))}
                  {constraints.notNull.length > 0 && (
                    <div className="records-constraints__row">
                      <span className="records-constraints__tag">NOT NULL</span>
                      {constraints.notNull.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {noteOnlyEntries.map((e) => (
            <div key={`note:${e.table}`} className="records-table">
              <div className="records-table__title">{e.table}</div>
              <p className="records-table__note">{e.note}</p>
            </div>
          ))}
          {filtered.map((r) => {
            const tbl = tables.find((t) => t.id === r.table || t.name === r.table);
            const displayNote = r.note ?? tbl?.note;
            return (
              <div key={r.table} className="records-table">
                <div className="records-table__title">
                  {r.table} <span className="records-table__count">{r.rows.length} linhas</span>
                </div>
                {displayNote && effectiveTableId !== r.table && effectiveTableId !== tbl?.id && (
                  <p className="records-table__note">{displayNote}</p>
                )}
                <div className="records-table__scroll">
                  <table>
                    {r.columns.length > 0 && (
                      <thead>
                        <tr>
                          {r.columns.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {r.rows.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
