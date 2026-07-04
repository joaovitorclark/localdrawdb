import { useMemo, useState } from 'react';
import { useInteraction } from '../store/interaction';
import { getColumnSettings, setColumnColor, setColumnSetting, type ColSettings } from '../dsl/edit';
import type { TableView } from '../dsl/parse';

type Props = {
  dbml: string;
  tables: TableView[];
  onApply: (next: string) => void;
  onRenameColumn?: (table: string, oldName: string, newName: string) => void;
  onGoToColumn?: (table: string, column: string) => void;
};

const COLLAPSE_KEY = 'localdrawdb.columnPanelCollapsed';

/** Cores pré-definidas pra pintar o nome do campo (semáforo) + custom. */
const FIELD_COLORS = [
  { label: 'Vermelho', value: '#dc2626' },
  { label: 'Amarelo', value: '#d4af37' },
  { label: 'Verde', value: '#15803d' },
];

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function ColumnPanel({ dbml, tables, onApply, onRenameColumn, onGoToColumn }: Props) {
  const sel = useInteraction((s) => s.selectedColumn);
  const selectColumn = useInteraction((s) => s.selectColumn);
  const [nameDraft, setNameDraft] = useState('');
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  const table = useMemo(
    () => (sel ? tables.find((t) => t.id === sel.table) : undefined),
    [tables, sel],
  );

  const settings = useMemo(
    () => (sel ? getColumnSettings(dbml, sel.table, sel.column) : null),
    [dbml, sel],
  );

  const refOptions = useMemo(() => {
    if (!sel) return [];
    const out: { value: string; label: string }[] = [];
    for (const t of tables) {
      for (const c of t.columns) {
        if (t.id === sel.table && c.name === sel.column) continue;
        if (c.pk) out.push({ value: `${t.id}.${c.name}`, label: `${t.id}.${c.name} (PK)` });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [tables, sel]);

  const compositeHint = useMemo(() => {
    if (!sel || !table) return null;
    const groups = table.compositePks?.filter((g) => g.includes(sel.column) && g.length > 1);
    if (!groups?.length) return null;
    return groups.map((g) => `(${g.join(', ')})`).join(', ');
  }, [table, sel]);

  if (!sel || !settings) return null;

  const apply = (patch: ColSettings) =>
    onApply(setColumnSetting(dbml, sel.table, sel.column, { ...settings, ...patch }));

  const commitRename = () => {
    const v = nameDraft.trim();
    if (!v || v === sel.column || !onRenameColumn) return;
    onRenameColumn(sel.table, sel.column, v);
    selectColumn({ table: sel.table, column: v });
    setNameDraft(v);
  };

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const refValue = settings.refTarget ?? '';

  // Tests dbt derivados para a coluna (read-only summary).
  const selCol = table?.columns.find((c) => c.name === sel.column);
  const dbtTests: string[] = [];
  if (settings.pk) dbtTests.push('unique', 'not_null');
  else if (settings.notNull) dbtTests.push('not_null');
  if (selCol?.acceptedValues?.length) dbtTests.push(`accepted_values: [${selCol.acceptedValues.join(', ')}]`);
  if (settings.refTarget) dbtTests.push(`relationships → ${settings.refTarget}`);

  return (
    <div className={`column-panel ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="column-panel__head">
        <button
          type="button"
          className="column-panel__collapse"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expandir editor' : 'Recolher editor'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <strong className="column-panel__col">{sel.column}</strong>
        <span className="column-panel__tbl">{sel.table}</span>
        <button className="column-panel__close" onClick={() => selectColumn(null)}>
          ✕
        </button>
      </div>
      {!collapsed && (
        <>
          {compositeHint && (
            <p className="column-panel__hint">PK composta: {compositeHint}</p>
          )}
          <label className="column-panel__field">
            Nome
            <input
              type="text"
              value={nameDraft || sel.column}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
              }}
            />
          </label>
          {onGoToColumn && (
            <button
              type="button"
              className="column-panel__dbml-btn"
              onClick={() => onGoToColumn(sel.table, sel.column)}
            >
              Editar no DBML
            </button>
          )}
          <div className="column-panel__field">
            Cor do nome
            <div className="column-panel__colors">
              {FIELD_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`col-color-dot${selCol?.color === c.value ? ' is-active' : ''}`}
                  style={{ background: c.value }}
                  title={c.label}
                  onClick={() => onApply(setColumnColor(dbml, sel.table, sel.column, c.value))}
                />
              ))}
              <input
                type="color"
                className="col-color-custom"
                value={selCol?.color ?? '#888888'}
                title="Cor personalizada"
                onChange={(e) => onApply(setColumnColor(dbml, sel.table, sel.column, e.target.value))}
              />
              <button
                type="button"
                className="col-color-clear"
                title="Sem cor"
                onClick={() => onApply(setColumnColor(dbml, sel.table, sel.column, null))}
              >
                ✕
              </button>
            </div>
          </div>
          <label className="column-panel__row">
            <input type="checkbox" checked={!!settings.pk} onChange={(e) => apply({ pk: e.target.checked })} />
            Primary key
          </label>
          <label className="column-panel__field">
            Referência (FK)
            <select
              value={refValue}
              onChange={(e) => apply({ refTarget: e.target.value || null })}
            >
              <option value="">— nenhuma —</option>
              {refOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="column-panel__row">
            <input
              type="checkbox"
              checked={!!settings.notNull}
              onChange={(e) => apply({ notNull: e.target.checked })}
            />
            Not null
          </label>
          <label className="column-panel__field">
            Note
            <input
              type="text"
              value={settings.note ?? ''}
              onChange={(e) => apply({ note: e.target.value })}
              placeholder="descrição"
            />
          </label>
          <label className="column-panel__field">
            Default
            <input
              type="text"
              value={settings.default ?? ''}
              onChange={(e) => apply({ default: e.target.value })}
              placeholder="ex.: 0 ou 'x'"
            />
          </label>
          {dbtTests.length > 0 && (
            <div className="column-panel__tests">
              <span className="column-panel__tests-label">Tests dbt</span>
              <ul>
                {dbtTests.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
