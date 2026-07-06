import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Handle, Position, useNodeId, useUpdateNodeInternals } from 'reactflow';
import type { ColumnView } from '../dsl/parse';
import {
  COLUMN_VIRTUAL_ROW_H,
  COLUMN_VIRTUALIZE_THRESHOLD,
  COLUMN_VIRTUAL_VIEW_ROWS,
} from './scaleLimits';
import { useTableScrollStore } from './tableScrollStore';
import { Key } from '../icons';

const VIEW_H = COLUMN_VIRTUAL_VIEW_ROWS * COLUMN_VIRTUAL_ROW_H;

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

function ColumnRowContent({
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
  return (
    <div
      className={`col-row${scrollable ? ' col-row--scroll' : ''} ${c.pk ? 'is-pk' : ''} ${isSel ? 'is-selected' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(c.name, e.altKey);
      }}
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
          type="source"
          position={Position.Right}
          id={`fl:s:${c.name}`}
          className="col-handle col-handle--field-lin nodrag nopan"
        />
      )}
    </div>
  );
}

/** Posiciona scroll para coluna selecionada/em edição. */
function scrollToColumnIndex(el: HTMLDivElement, index: number): void {
  if (index < 0) return;
  const rowTop = index * COLUMN_VIRTUAL_ROW_H;
  const rowBottom = rowTop + COLUMN_VIRTUAL_ROW_H;
  if (rowTop < el.scrollTop) el.scrollTop = rowTop;
  else if (rowBottom > el.scrollTop + VIEW_H) el.scrollTop = rowBottom - VIEW_H;
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
  const setScrollTop = useTableScrollStore((s) => s.setScrollTop);

  const publishScroll = useCallback(
    (scrollTop: number) => {
      if (nodeId) setScrollTop(nodeId, scrollTop);
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

  useEffect(() => {
    if (!scrollable || !nodeId) return;
    publishScroll(scrollRef.current?.scrollTop ?? 0);
  }, [scrollable, nodeId, publishScroll]);

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

  const rows = columns.map((c) => <ColumnRowContent key={c.name} {...rowProps} column={c} />);

  if (!scrollable) {
    return <div className="table-node__cols">{rows}</div>;
  }

  return (
    <div
      ref={scrollRef}
      className="table-node__cols table-node__cols--scroll"
      style={{ maxHeight: VIEW_H }}
      onScroll={(e) => {
        publishScroll(e.currentTarget.scrollTop);
        requestAnimationFrame(syncEdgeAnchors);
      }}
    >
      {rows}
    </div>
  );
}
