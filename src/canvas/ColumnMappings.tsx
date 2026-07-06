import { useCallback, useMemo, useState } from 'react';
import type { ParsedFieldLineage, TableView } from '../dsl/parse';
import { Close, Doc } from '../icons';
import { Tooltip } from '../Tooltip';

type MappingKey = {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
};

type Props = {
  tables: TableView[];
  mappings: ParsedFieldLineage[];
  targetTable: string;
  targetColumn: string;
  onAdd: (sourceTable: string, sourceColumn: string, targetColumn: string, note?: string, ref?: string) => void;
  onUpdate: (
    prev: MappingKey,
    next: { sourceTable: string; sourceColumn: string; targetColumn: string; note?: string; ref?: string },
  ) => void;
  onRemove: (sourceTable: string, sourceColumn: string, targetColumn: string) => void;
};

const keysMatch = (a: MappingKey | null, b: MappingKey) =>
  !!a &&
  a.sourceTable === b.sourceTable &&
  a.sourceColumn === b.sourceColumn &&
  a.targetTable === b.targetTable &&
  a.targetColumn === b.targetColumn;

/**
 * Editor de mapeamentos L2 de UM campo (destino fixo = targetColumn). Renderizado
 * dentro do ColumnPanel — mapeamento e edição do campo num painel só.
 */
export function ColumnMappings({ tables, mappings, targetTable, targetColumn, onAdd, onUpdate, onRemove }: Props) {
  const [editing, setEditing] = useState<MappingKey | null>(null);
  const [srcTable, setSrcTable] = useState('');
  const [srcCol, setSrcCol] = useState('');
  const [note, setNote] = useState('');
  const [refPath, setRefPath] = useState('');

  const forColumn = useMemo(
    () => mappings.filter((m) => m.targetTable === targetTable && m.targetColumn === targetColumn),
    [mappings, targetTable, targetColumn],
  );
  const sourceTables = useMemo(() => tables.filter((t) => t.id !== targetTable), [tables, targetTable]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setSrcTable('');
    setSrcCol('');
    setNote('');
    setRefPath('');
  }, []);

  const loadMapping = (m: ParsedFieldLineage) => {
    setEditing({ sourceTable: m.sourceTable, sourceColumn: m.sourceColumn, targetTable: m.targetTable, targetColumn: m.targetColumn });
    setSrcTable(m.sourceTable);
    setSrcCol(m.sourceColumn);
    setNote(m.note ?? '');
    setRefPath(m.ref ?? '');
  };

  const handleAdd = () => {
    if (!srcTable || !srcCol.trim()) return;
    onAdd(srcTable, srcCol.trim(), targetColumn, note.trim() || undefined, refPath.trim() || undefined);
    resetForm();
  };
  const handleSave = () => {
    if (!editing || !srcTable || !srcCol.trim()) return;
    onUpdate(editing, {
      sourceTable: srcTable,
      sourceColumn: srcCol.trim(),
      targetColumn,
      note: note.trim() || undefined,
      ref: refPath.trim() || undefined,
    });
    resetForm();
  };

  return (
    <div className="column-panel__mappings">
      <div className="column-panel__mappings-head">
        <strong>Mapeamentos (L2)</strong>
        <span className="column-panel__mappings-count">{forColumn.length}</span>
      </div>
      <ul className="field-lineage-panel__list">
        {forColumn.map((m) => (
          <li key={`${m.sourceTable}.${m.sourceColumn}`}>
            <button
              type="button"
              className={`field-lineage-panel__row-btn${keysMatch(editing, m) ? ' is-active' : ''}`}
              onClick={() => loadMapping(m)}
            >
              <span className="field-lineage-panel__src">{m.sourceTable}.{m.sourceColumn}</span>
              <span className="field-lineage-panel__arrow">→</span>
              <span className="field-lineage-panel__tgt">{targetColumn}</span>
            </button>
            {(m.note || m.ref) && (
              <div className="field-lineage-panel__meta">
                {m.note && <span title={m.note}>{m.note}</span>}
                {m.ref && (
                  <span title={m.ref}>
                    <Doc className="icon-inline" size={12} /> {m.ref}
                  </span>
                )}
              </div>
            )}
            <Tooltip label="Remover mapeamento">
              <button
                type="button"
                className="field-lineage-panel__del"
                aria-label="Remover mapeamento"
                onClick={() => {
                  onRemove(m.sourceTable, m.sourceColumn, targetColumn);
                  if (keysMatch(editing, m)) resetForm();
                }}
              >
                <Close className="icon-inline" size={14} />
              </button>
            </Tooltip>
          </li>
        ))}
        {forColumn.length === 0 && <li className="field-lineage-panel__empty">Nenhum mapeamento para este campo</li>}
      </ul>
      <div className="field-lineage-panel__add">
        <div className="field-lineage-panel__form-head">
          <span>{editing ? 'Editar mapeamento' : 'Novo mapeamento'}</span>
          {editing && (
            <button type="button" className="field-lineage-panel__new-btn" onClick={resetForm} title="Novo mapeamento">
              +
            </button>
          )}
        </div>
        <label className="field-lineage-panel__field">
          Tabela origem
          <select
            value={srcTable}
            onChange={(e) => {
              setSrcTable(e.target.value);
              setSrcCol('');
            }}
          >
            <option value="">— escolher —</option>
            {sourceTables.map((t) => (
              <option key={t.id} value={t.id}>{t.id}</option>
            ))}
          </select>
        </label>
        <label className="field-lineage-panel__field">
          Coluna origem
          <select value={srcCol} onChange={(e) => setSrcCol(e.target.value)} disabled={!srcTable}>
            <option value="">—</option>
            {(tables.find((t) => t.id === srcTable)?.columns ?? []).map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="field-lineage-panel__field">
          Nota ETL
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="regra de negócio" />
        </label>
        <label className="field-lineage-panel__field">
          Ref (sql/py)
          <input type="text" value={refPath} onChange={(e) => setRefPath(e.target.value)} placeholder="jobs/transform.sql" />
        </label>
        <div className="field-lineage-panel__actions">
          <button type="button" className="field-lineage-panel__add-btn" onClick={editing ? handleSave : handleAdd}>
            {editing ? 'Salvar' : '+ mapeamento'}
          </button>
        </div>
      </div>
    </div>
  );
}
