import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeResizeControl } from 'reactflow';
import { useInteraction } from '../store/interaction';
import { useCanvasActions, TABLE_COLORS, type TableNodeData } from './actions';
import { externalSourceHandle, externalTargetHandle } from './pageFilter';
import { LineagePorts } from './LineagePorts';
import { TableInfoPopover } from './TableInfoPopover';
import { TableColumnList } from './TableColumnList';

// Nó de tabela: colunas + FK por handle, ou cartão compacto + portas de linhagem (draw.io).
// Memoizado: `data` (incl. cor/meta pré-computadas) só muda quando o conteúdo da própria
// tabela muda, então editar uma tabela não re-renderiza as demais.
function TableNodeImpl({ data }: { data: TableNodeData }) {
  const actions = useCanvasActions();
  // Assinatura escopada à própria tabela: selecionar coluna em outra tabela não
  // dispara re-render aqui (retorna sempre null).
  const selectedColumn = useInteraction((s) =>
    s.selectedColumn && s.selectedColumn.table === data.id ? s.selectedColumn.column : null,
  );
  const lineageMode = useInteraction((s) => s.lineageMode);
  const lineageVisible = useInteraction((s) => s.lineageVisible);
  const fieldLineageVisible = useInteraction((s) => s.fieldLineageVisible);
  const showLineagePorts = lineageMode || lineageVisible;
  const [palette, setPalette] = useState(false);
  const [infoRect, setInfoRect] = useState<DOMRect | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const colorRef = useRef<HTMLSpanElement>(null);

  // Fecha a paleta ao clicar fora (evita paleta "presa aberta").
  useEffect(() => {
    if (!palette) return;
    const onDown = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setPalette(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [palette]);

  const color = data.headerColor;
  const meta = data.meta;

  const commitEdit = (oldName: string) => {
    const v = draft.trim();
    if (v && v !== oldName) actions.onRenameColumn(data.id, oldName, v);
    setEditing(null);
  };

  return (
    <div
      className={`table-node-shell${lineageMode ? ' table-node-shell--lineage' : ''}${showLineagePorts ? ' table-node-shell--lineage-ports' : ''}`}
    >
      {showLineagePorts && <LineagePorts />}
      <NodeResizeControl
        position="right"
        minWidth={200}
        onResizeEnd={(_, params) => actions.onResizeTable(data.id, params.width)}
        className="table-resize-handle"
        style={{ background: 'transparent', border: 'none' }}
      />
      <div className="table-node">
        <div className="table-node__header" style={{ background: color }}>
          <span
            className="table-node__title"
            title="Duplo-clique para renomear a tabela"
            onDoubleClick={(e) => {
              e.stopPropagation();
              const nv = prompt('Novo nome da tabela (schema.tabela):', data.id);
              if (nv && nv.trim()) actions.onRenameTable(data.id, nv.trim());
            }}
          >
            {data.schema && <span className="table-node__schema">{data.schema}.</span>}
            {data.name}
          </span>
          {meta.has && (
            <span
              className="table-node__info"
              onMouseEnter={(e) => setInfoRect(e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => setInfoRect(null)}
            >
              ⓘ
              {infoRect &&
                createPortal(
                  <TableInfoPopover
                    meta={meta}
                    style={{
                      position: 'fixed',
                      top: infoRect.bottom + 4,
                      left: Math.min(infoRect.left, window.innerWidth - 280),
                    }}
                  />,
                  document.body,
                )}
            </span>
          )}
          <button
            type="button"
            className="table-node__delete"
            title="Apagar tabela"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Apagar tabela ${data.id} e refs relacionadas?`)) {
                actions.onRemoveTable(data.id);
              }
            }}
          >
            ×
          </button>
          <span className="table-node__color-control" ref={colorRef}>
            <button
              type="button"
              className="table-node__color"
              title="Cor / camada da tabela"
              onClick={(e) => {
                e.stopPropagation();
                setPalette((p) => !p);
              }}
            >
              ●
            </button>
            {palette && (
              <div className="color-palette" onClick={(e) => e.stopPropagation()}>
                <div className="color-palette__row">
                  {TABLE_COLORS.map((c) => (
                    <button key={c} type="button" style={{ background: c }} onClick={() => { actions.onSetColor(data.id, c); setPalette(false); }} />
                  ))}
                  <button type="button" className="color-reset" title="Sem cor (usar camada)" onClick={() => { actions.onSetColor(data.id, null); setPalette(false); }}>✕</button>
                </div>
                <div className="color-palette__layers">
                  {actions.layers.map((l) => (
                    <button key={l.id} type="button" className="layer-pick" onClick={() => { actions.onSetLayer(data.id, l.id); setPalette(false); }}>
                      <span className="layer-dot" style={{ background: l.color }} /> {l.name}
                    </button>
                  ))}
                  <button type="button" className="layer-pick" onClick={() => { actions.onSetLayer(data.id, null); setPalette(false); }}>sem camada</button>
                </div>
              </div>
            )}
          </span>
        </div>

        {data.externalLinks?.length ? (
          <div className="table-node__external-bar">
            {data.externalLinks.map((link) => (
              <span
                key={`${link.direction}:${link.stubId}`}
                className="table-node__external-chip"
                title={
                  link.direction === 'out'
                    ? `${link.count} ligação(ões) → ${link.label} (fora da página)`
                    : `${link.count} ligação(ões) ← ${link.label} (fora da página)`
                }
              >
                {link.direction === 'out' ? (
                  <Handle
                    type="source"
                    position={Position.Top}
                    id={externalSourceHandle(link.stubId)}
                    className="external-link-handle nodrag nopan"
                  />
                ) : (
                  <Handle
                    type="target"
                    position={Position.Top}
                    id={externalTargetHandle(link.stubId)}
                    className="external-link-handle nodrag nopan"
                  />
                )}
                <span className="table-node__external-chip-text">
                  {link.direction === 'out' ? '→' : '←'} {link.label}
                  <span className="table-node__external-chip-count">{link.count}</span>
                </span>
              </span>
            ))}
          </div>
        ) : null}

        <TableColumnList
          columns={data.columns}
          selectedColumn={selectedColumn}
          fieldLineageVisible={fieldLineageVisible}
          lineageMode={lineageMode}
          editing={editing}
          draft={draft}
          onSelect={(column, altKey) => {
            if (altKey && actions.onGoToColumn) {
              actions.onGoToColumn(data.id, column);
              return;
            }
            actions.onSelectColumn(data.id, column);
          }}
          onStartEdit={(column) => {
            setEditing(column);
            setDraft(column);
          }}
          onDraftChange={setDraft}
          onCommitEdit={commitEdit}
          onCancelEdit={() => setEditing(null)}
        />
        <button
          className="col-add"
          onClick={(e) => {
            e.stopPropagation();
            actions.onAddColumn(data.id);
          }}
        >
          + coluna
        </button>
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeImpl);
