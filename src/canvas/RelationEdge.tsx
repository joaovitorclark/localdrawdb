import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from 'reactflow';
import type { Cardinality } from '../dsl/parse';
import { useColumnEdgeCoords } from './useColumnEdgeCoords';
import { Close } from '../icons';
import { Tooltip } from '../Tooltip';

export type RelationEdgeData = {
  fromRel: Cardinality;
  toRel: Cardinality;
  highlighted?: boolean;
  dimmed?: boolean;
  muted?: boolean;
  /** Foco por coluna: mesma espessura de aresta selecionada, sem neon. */
  emphasized?: boolean;
  /** Ligação agregada para grupo fora da página. */
  externalSummary?: boolean;
  linkCount?: number;
  stubLabel?: string;
  externalDetails?: string[];
  onRemove?: () => void;
};

const markerFor = (rel: Cardinality) => (rel === '*' ? 'url(#cf-many)' : 'url(#cf-one)');

export function RelationEdge({
  source,
  target,
  sourceHandleId,
  targetHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<RelationEdgeData>) {
  const coords = useColumnEdgeCoords(
    source,
    target,
    sourceHandleId,
    targetHandleId,
    'relation',
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  );

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: coords.sourceX,
    sourceY: coords.sourceY,
    targetX: coords.targetX,
    targetY: coords.targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  const active = selected || data?.highlighted;
  const emphasis = selected || data?.emphasized;
  const external = !!data?.externalSummary;

  return (
    <>
      <BaseEdge
        path={path}
        markerStart={markerFor(data?.fromRel ?? '*')}
        markerEnd={markerFor(data?.toRel ?? '1')}
        style={{
          stroke: active ? 'var(--brand-green)' : external ? '#94a3b8' : 'var(--brand-navy)',
          strokeWidth: external ? 1.5 : emphasis ? 3 : data?.highlighted ? 2.5 : 1.5,
          strokeDasharray: external ? '5 4' : undefined,
          opacity: external && !active ? 0.75 : 1,
        }}
      />
      {selected && data?.externalSummary && data.linkCount && data.stubLabel && (
        <EdgeLabelRenderer>
          <div
            className="edge-external-label edge-external-label--detail"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={data.externalDetails?.join('\n')}
          >
            {data.linkCount} ligações → {data.stubLabel}
          </div>
        </EdgeLabelRenderer>
      )}
      {selected && data?.onRemove && !data.externalSummary && (
        <EdgeLabelRenderer>
          <Tooltip label="Remover relação">
            <button
              className="edge-delete"
              aria-label="Remover relação"
              style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
              onClick={(e) => {
                e.stopPropagation();
                data.onRemove?.();
              }}
            >
              <Close className="icon-inline" size={14} />
            </button>
          </Tooltip>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
