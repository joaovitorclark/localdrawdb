import { useMemo, useState } from 'react';
import type { Layer } from '../api';
import { LAYER_PRESETS } from '../layers';
import { useInteraction } from '../store/interaction';
import { Chevron, Dot } from '../icons';
import { Tooltip } from '../Tooltip';
import { useCollapsePersist } from '../hooks/useCollapsePersist';

type Props = {
  layers: Layer[];
  tables: { id: string }[];
  onAddLayer: (n: string, c: string) => void;
  onFocusTable: (tableId: string) => void;
  onAutolayout?: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

export function LayersPanel({
  layers,
  tables,
  onAddLayer,
  onFocusTable,
  onAutolayout,
  collapsed: collapsedProp,
  onCollapsedChange,
}: Props) {
  // Persistência via hook unificado (v18-05); prop `collapsed` permite controle externo
  // pelo command palette (v18-07).
  const [persistedCollapsed, togglePersisted] = useCollapsePersist('ldb.panel.layers', false);
  const collapsed = collapsedProp ?? persistedCollapsed;
  const toggleCollapsed = () => {
    onCollapsedChange?.(!collapsed);
    togglePersisted();
  };
  const [tableQuery, setTableQuery] = useState('');
  const hiddenLayers = useInteraction((s) => s.hiddenLayers);
  const toggleLayer = useInteraction((s) => s.toggleLayer);
  const layerDimMode = useInteraction((s) => s.layerDimMode);
  const toggleDimMode = useInteraction((s) => s.toggleDimMode);
  const lineageVisible = useInteraction((s) => s.lineageVisible);
  const toggleLineageVisible = useInteraction((s) => s.toggleLineageVisible);
  const lineageMode = useInteraction((s) => s.lineageMode);
  const toggleLineageMode = useInteraction((s) => s.toggleLineageMode);
  const relationsVisible = useInteraction((s) => s.relationsVisible);
  const toggleRelationsVisible = useInteraction((s) => s.toggleRelationsVisible);
  const fieldLineageVisible = useInteraction((s) => s.fieldLineageVisible);
  const toggleFieldLineageVisible = useInteraction((s) => s.toggleFieldLineageVisible);

  const filteredTables = useMemo(() => {
    const q = tableQuery.trim().toLowerCase();
    const sorted = [...tables].sort((a, b) => a.id.localeCompare(b.id));
    if (!q) return sorted;
    return sorted.filter((t) => t.id.toLowerCase().includes(q));
  }, [tables, tableQuery]);

  return (
    <div className={`layers-panel ${collapsed ? 'is-collapsed' : ''}`}>
      <Tooltip label={collapsed ? 'Expandir painel' : 'Recolher painel'}>
        <button
          type="button"
          className="layers-panel__collapse"
          onClick={toggleCollapsed}
        >
          <Chevron dir={collapsed ? 'left' : 'down'} className="icon-inline" size={14} />
          {collapsed ? ' Camadas' : ' Camadas e tabelas'}
        </button>
      </Tooltip>
      {!collapsed && (
        <>
          <div className="layers-panel__title">Camadas</div>
          {layers.map((l) => (
            <label key={l.id} className="layers-panel__row">
              <input type="checkbox" checked={!hiddenLayers.has(l.id)} onChange={() => toggleLayer(l.id)} />
              <span className="layer-dot" style={{ background: l.color }} />
              {l.name}
            </label>
          ))}
          <button
            className="layers-panel__add"
            onClick={() => {
              const name = prompt('Nome da nova camada:');
              if (!name) return;
              const color = prompt('Cor (hex):', '#6b7280') || '#6b7280';
              onAddLayer(name.trim(), color.trim());
            }}
          >
            + camada
          </button>
          <select
            className="layers-panel__preset"
            value=""
            title="Insere as camadas de uma nomenclatura medallion (dbt)"
            onChange={(e) => {
              const preset = LAYER_PRESETS[e.target.value];
              if (preset) for (const l of preset.layers) onAddLayer(l.name, l.color);
              e.currentTarget.value = '';
            }}
          >
            <option value="">+ inserir preset…</option>
            {Object.values(LAYER_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="layers-panel__sep" />
          <label className="layers-panel__row">
            <input type="checkbox" checked={layerDimMode} onChange={toggleDimMode} />
            Esmaecer (em vez de esconder)
          </label>
          <div className="layers-panel__sep" />
          <div className="layers-panel__title">Linhagem</div>
          <label className="layers-panel__row">
            <input type="checkbox" checked={lineageVisible} onChange={toggleLineageVisible} />
            Mostrar linhagem
          </label>
          <label className="layers-panel__row">
            <input type="checkbox" checked={relationsVisible} onChange={toggleRelationsVisible} />
            Mostrar relacionamentos
          </label>
          <label className="layers-panel__row">
            <input type="checkbox" checked={fieldLineageVisible} onChange={toggleFieldLineageVisible} />
            Mostrar linhagem de campos
          </label>
          <Tooltip label="Editar linhagem nas bordas das tabelas">
            <button
              type="button"
              className={`layers-panel__lineage-btn ${lineageMode ? 'is-active' : ''}`}
              onClick={toggleLineageMode}
            >
              <Dot filled={lineageMode} className="icon-inline" size={10} />
              {lineageMode ? ' Modo linhagem (ativo)' : ' Modo linhagem'}
            </button>
          </Tooltip>
          {lineageMode && (
            <p className="layers-panel__hint">
              Arraste entre os pontos nas bordas. Relacionamentos desligam automaticamente.
              Organizar canvas empilha TableGroups por camada (bronze→ouro), maiores à esquerda dentro de cada grupo.
            </p>
          )}

          <div className="layers-panel__sep" />
          <div className="layers-panel__title">Tabelas</div>
          <input
            className="layers-panel__search"
            type="search"
            placeholder="Buscar tabela…"
            value={tableQuery}
            onChange={(e) => setTableQuery(e.target.value)}
          />
          <ul className="layers-panel__tables">
            {filteredTables.map((t) => (
              <li key={t.id}>
                <Tooltip label="Clique para ir à tabela no canvas">
                  <button
                    type="button"
                    className="layers-panel__table-btn"
                    onClick={() => onFocusTable(t.id)}
                    onDoubleClick={() => onFocusTable(t.id)}
                  >
                    {t.id}
                  </button>
                </Tooltip>
              </li>
            ))}
            {filteredTables.length === 0 && (
              <li className="layers-panel__empty">Nenhuma tabela</li>
            )}
          </ul>
          {onAutolayout && (
            <button
              type="button"
              className={`layers-panel__autolayout${lineageMode ? ' layers-panel__autolayout--lineage' : ''}`}
              onClick={onAutolayout}
            >
              Organizar canvas
            </button>
          )}
          <p className="layers-panel__hint">
            {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)
              ? 'Cmd+clique ou arraste para selecionar várias tabelas.'
              : 'Ctrl+clique ou arraste para selecionar várias tabelas.'}
          </p>

          {fieldLineageVisible && (
            <p className="layers-panel__hint">
              Arestas finas só nas tabelas selecionadas. Edite mapeamentos no painel inferior direito.
            </p>
          )}
        </>
      )}
    </div>
  );
}
