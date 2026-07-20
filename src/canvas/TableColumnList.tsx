import { useCallback, useEffect, useRef, useState, memo, type ReactNode } from 'react';
import { Handle, Position, useNodeId, useUpdateNodeInternals, useReactFlow } from 'reactflow';
import type { ColumnView } from '../dsl/parse';
import {
  COLUMN_VIRTUAL_ROW_H,
  COLUMN_VIRTUALIZE_THRESHOLD,
  COLUMN_VIRTUAL_VIEW_ROWS,
} from './scaleLimits';
import { useTableScrollStore } from './tableScrollStore';
import { computeVirtualWindow } from './hooks/useVirtualWindow';
import { Key } from '../icons';

const VIEW_H_FALLBACK = COLUMN_VIRTUAL_VIEW_ROWS * COLUMN_VIRTUAL_ROW_H;
const OVERSCAN = 5;

// Alturas reservadas dentro do nó da tabela (para o .table-node__header,
// .col-add e padding) — descontadas da altura do nó para obter o viewport
// disponível das colunas.
const NODE_HEADER_H = 34;
const NODE_ADD_BTN_H = 30;
const NODE_PADDING = 8;
const VIEWPORT_MIN_H = 120;

type ColumnRowProps = {
  column: ColumnView;
  selectedColumn: string | null;
  fieldLineageVisible: boolean;
  lineageMode: boolean;
  editing: string | null;
  draft: string;
  scrollable: boolean;
  onSelect: (column: string, altKey: boolean) => void;
  onStartEdit: (column: string) => void;
  onDraftChange: (value: string) => void;
  onCommitEdit: (oldName: string) => void;
  onCancelEdit: () => void;
};

function ColumnRowContentImpl({
  column: c,
  selectedColumn,
  fieldLineageVisible,
  lineageMode,
  editing,
  draft,
  scrollable,
  onSelect,
  onStartEdit,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
}: ColumnRowProps) {
  const isSel = selectedColumn === c.name;
  // Seleção no pointerup com tolerância de distância: o d3-drag do React Flow
  // suprime o evento `click` ao menor movimento do mouse (jitter comum no Windows).
  // Tolerância maior (12px) cobre trackpads sensíveis sem perder intenção de drag.
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const isInteractiveChild = useCallback(
    (target: EventTarget | null) =>
      !!(target as HTMLElement | null)?.closest?.('.col-handle, .col-edit'),
    [],
  );
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      downPos.current = isInteractiveChild(e.target) ? null : { x: e.clientX, y: e.clientY };
    },
    [isInteractiveChild],
  );
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = downPos.current;
      downPos.current = null;
      if (!d || isInteractiveChild(e.target)) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return; // foi drag
      e.stopPropagation();
      onSelect(c.name, e.altKey);
    },
    [c.name, isInteractiveChild, onSelect],
  );
  return (
    <div
      className={`col-row${scrollable ? ' col-row--scroll' : ''} ${c.pk ? 'is-pk' : ''} ${isSel ? 'is-selected' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {!lineageMode && (
        <Handle type="target" position={Position.Left} id={`t:${c.name}`} className="col-handle nodrag nopan" />
      )}
      {lineageMode && (
        <Handle
          type="target"
          position={Position.Left}
          id={`fl:t:${c.name}`}
          className="col-handle col-handle--field-lin nodrag nopan"
        />
      )}
      {editing === c.name ? (
        <input
          className="col-edit"
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => onCommitEdit(c.name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit(c.name);
            if (e.key === 'Escape') onCancelEdit();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="col-name"
          style={c.color ? { color: c.color } : undefined}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartEdit(c.name);
          }}
        >
          {c.pk ? <Key className="icon-inline col-pk-icon" size={12} /> : null}
          {c.name}
          {c.notNull ? <span className="col-nn">NN</span> : null}
        </span>
      )}
      <span className="col-type">{c.type}</span>
      {!lineageMode && (
        <Handle type="source" position={Position.Right} id={`s:${c.name}`} className="col-handle nodrag nopan" />
      )}
      {lineageMode && (
        <Handle
          type="source" position={Position.Right}
          id={`fl:s:${c.name}`} className="col-handle col-handle--field-lin nodrag nopan"
        />
      )}
    </div>
  );
}

/** Memoizado por coluna: re-renderiza só quando a coluna individual muda. */
const ColumnRowContent = memo(ColumnRowContentImpl, (prev, next) => {
  if (prev.column !== next.column) return false;
  if (prev.selectedColumn !== next.selectedColumn) return false;
  if (prev.editing !== next.editing) return false;
  if (prev.draft !== next.draft) return false;
  if (prev.lineageMode !== next.lineageMode) return false;
  if (prev.fieldLineageVisible !== next.fieldLineageVisible) return false;
  if (prev.scrollable !== next.scrollable) return false;
  // Handlers: re-render quando editing/draft mudam (são usados pelo input)
  if (prev.editing === prev.column.name) return false;
  return true;
});

/** Posiciona scroll para coluna selecionada/em edição. */
function scrollToColumnIndex(el: HTMLDivElement, index: number): void {
  if (index < 0) return;
  const rowTop = index * COLUMN_VIRTUAL_ROW_H;
  const rowBottom = rowTop + COLUMN_VIRTUAL_ROW_H;
  // Usa a altura atual do container em vez da constante fixa — após resize,
  // a viewport mudou e a posição de scroll precisa refletir isso.
  const viewportH = el.clientHeight || VIEW_H_FALLBACK;
  if (rowTop < el.scrollTop) el.scrollTop = rowTop;
  else if (rowBottom > el.scrollTop + viewportH) el.scrollTop = rowBottom - viewportH;
}

export type TableColumnListProps = {
  columns: ColumnView[];
  selectedColumn: string | null;
  fieldLineageVisible: boolean;
  lineageMode: boolean;
  editing: string | null;
  draft: string;
  onSelect: (column: string, altKey: boolean) => void;
  onStartEdit: (column: string) => void;
  onDraftChange: (value: string) => void;
  onCommitEdit: (oldName: string) => void;
  onCancelEdit: () => void;
};

export function TableColumnList(props: TableColumnListProps): ReactNode {
  const {
    columns,
    selectedColumn,
    fieldLineageVisible,
    lineageMode,
    editing,
    draft,
    onSelect,
    onStartEdit,
    onDraftChange,
    onCommitEdit,
    onCancelEdit,
  } = props;

  const scrollable = columns.length > COLUMN_VIRTUALIZE_THRESHOLD;
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();
  const { getNode } = useReactFlow();
  const setScrollTop = useTableScrollStore((s) => s.setScrollTop);
  const [scrollTop, setScrollTopLocal] = useState(0);
  // Altura observada do nó React Flow. Quando muda (resize do usuário),
  // recalcula o viewport e a janela virtual.
  const [nodeH, setNodeH] = useState<number | null>(null);

  // Polling via rAF: alternativa leve ao ResizeObserver. `getNode(id).height`
  // é atualizado pelo React Flow quando NodeResizeControl.onResizeEnd dispara,
  // então o próximo frame já vê o novo valor. Comparação prev===h evita
  // setStates redundantes em tabelas estáticas.
  useEffect(() => {
    if (!scrollable || !nodeId) return;
    let raf = 0;
    const tick = () => {
      const n = getNode(nodeId);
      const h = (n?.height as number | undefined) ?? null;
      setNodeH((prev) => (prev === h ? prev : h));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrollable, nodeId, getNode]);

  // Viewport dinâmico: usa a altura real do nó menos o header + botão + coluna.
  // Enquanto o primeiro frame não foi observado, mantém o fallback (350px).
  const viewportH = nodeH
    ? Math.max(VIEWPORT_MIN_H, nodeH - NODE_HEADER_H - NODE_ADD_BTN_H - NODE_PADDING)
    : VIEW_H_FALLBACK;

  const publishScroll = useCallback(
    (next: number) => {
      if (nodeId) setScrollTop(nodeId, next);
    },
    [nodeId, setScrollTop],
  );

  const syncEdgeAnchors = useCallback(() => {
    if (nodeId) updateNodeInternals(nodeId);
  }, [nodeId, updateNodeInternals]);

  const scrollToColumn = useCallback((columnName: string | null) => {
    const el = scrollRef.current;
    if (!el || !columnName) return;
    const idx = columns.findIndex((c) => c.name === columnName);
    scrollToColumnIndex(el, idx);
  }, [columns]);

  useEffect(() => {
    if (!scrollable) return;
    scrollToColumn(selectedColumn);
    const el = scrollRef.current;
    if (el) publishScroll(el.scrollTop);
    requestAnimationFrame(syncEdgeAnchors);
  }, [scrollable, selectedColumn, scrollToColumn, publishScroll, syncEdgeAnchors]);

  useEffect(() => {
    if (!scrollable) return;
    scrollToColumn(editing);
    const el = scrollRef.current;
    if (el) publishScroll(el.scrollTop);
    requestAnimationFrame(syncEdgeAnchors);
  }, [scrollable, editing, scrollToColumn, publishScroll, syncEdgeAnchors]);

  const rowProps: Omit<ColumnRowProps, 'column'> = {
    selectedColumn,
    fieldLineageVisible,
    lineageMode,
    editing,
    draft,
    scrollable,
    onSelect,
    onStartEdit,
    onDraftChange,
    onCommitEdit,
    onCancelEdit,
  };

  if (!scrollable) {
    return (
      <div className="table-node__cols">
        {columns.map((c) => <ColumnRowContent key={c.name} {...rowProps} column={c} />)}
      </div>
    );
  }

  // Virtualização real (A1 do audit 2026-07-13): só renderiza linhas dentro
  // da janela visível + overscan. Para 200 colunas, isso reduz render de
  // 200 ColumnRowContent + 800 Handles para ~20 linhas + 80 Handles.
  const win = computeVirtualWindow({
    totalItems: columns.length,
    itemHeight: COLUMN_VIRTUAL_ROW_H,
    viewportHeight: viewportH,
    scrollTop,
    overscan: OVERSCAN,
  });
  const visible = columns.slice(win.startIndex, win.endIndex);

  return (
    <div
      ref={scrollRef}
      className="table-node__cols table-node__cols--scroll"
      style={{ maxHeight: viewportH }}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop;
        setScrollTopLocal(top);
        publishScroll(top);
        requestAnimationFrame(syncEdgeAnchors);
      }}
    >
      <div style={{ height: win.totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${win.offsetY}px)` }}>
          {visible.map((c) => (
            <ColumnRowContent key={c.name} {...rowProps} column={c} />
          ))}
        </div>
      </div>
    </div>
  );
}
