import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from 'reactflow';
import { Close } from '../icons';
import { Tooltip } from '../Tooltip';

export type LineageEdgeData = {
  highlighted?: boolean;
  dimmed?: boolean;
  onRemove?: () => void;
};

// Aresta L1 (tabela→tabela): roxa contínua, portas no meio das 4 bordas.
export function LineageEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected,
}: EdgeProps<LineageEdgeData>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8,
  });
  const active = selected || data?.highlighted;
  const dimmed = data?.dimmed && !selected;
  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: active ? '#7c3aed' : '#8b5cf6',
          strokeWidth: selected ? 3.5 : active ? 3 : 2,
          opacity: dimmed ? 0.2 : 1,
        }}
      />
      {!dimmed && (
        <EdgeLabelRenderer>
          <div
            className={`lineage-label${active ? ' lineage-label--active' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            ⟿ derivado de
            {selected && data?.onRemove && (
              <Tooltip label="Remover linhagem">
                <button
                  className="edge-delete"
                  aria-label="Remover linhagem"
                  onClick={(e) => { e.stopPropagation(); data.onRemove?.(); }}
                >
                  <Close className="icon-inline" size={14} />
                </button>
              </Tooltip>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
