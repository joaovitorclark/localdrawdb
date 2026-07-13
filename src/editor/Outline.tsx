import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import React from 'react';
import { splitDbmlBlocks, type Block } from '../dsl/blocks';
import { computeVirtualWindow } from '../canvas/hooks/useVirtualWindow';
import { Chevron } from '../icons';

type Props = {
  dbml: string;
  onGoToLine: (line: number) => void;
  onFocusTable?: (tableId: string) => void;
};

const ICONS: Record<string, string> = {
  table: '▪',
  ref: '→',
  tableGroup: '▣',
  layerGroup: '◈',
  lineage: '⟿',
  records: '⊞',
  enum: '▦',
  project: '◉',
};

// Virtualização (A2 do audit 2026-07-13): a partir deste número de blocos
// renderizamos só a janela visível + overscan. Sem isso, digitar no editor
// re-renderizava todos os blocos a cada keystroke.
const VIRTUALIZE_THRESHOLD = 80;
const ROW_HEIGHT = 26; // ~26px por linha do outline (medido)
const OVERSCAN = 8;

export function Outline({ dbml, onGoToLine, onFocusTable }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);

  // useDeferredValue: splitDbmlBlocks é O(n) no tamanho do DBML. Quando o
  // usuário digita, o dbml muda a cada caractere; sem deferred, render fica
  // caro em modelos grandes. Com deferred, o React pode segurar o re-split
  // até a pintura seguinte, mantendo o editor responsivo.
  const deferredDbml = useDeferredValue(dbml);

  const items = useMemo(() => {
    const blocks = splitDbmlBlocks(deferredDbml);
    const base = blocks.filter((b) => b.type !== 'blank' && b.type !== 'comment');
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((b) => formatLabel(b).toLowerCase().includes(q));
  }, [deferredDbml, query]);

  const listRef = useRef<HTMLUListElement>(null);
  const [viewportHeight, setViewportHeight] = useState(400);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, [collapsed]);

  const virtualize = items.length > VIRTUALIZE_THRESHOLD;

  return (
    <div className={`outline-panel ${collapsed ? 'is-collapsed' : ''}`}>
      <button className="outline-panel__toggle" onClick={() => setCollapsed((c) => !c)}>
        <Chevron dir={collapsed ? 'right' : 'down'} className="icon-inline" size={14} />
        {' '}Outline
      </button>
      {!collapsed && (
        <>
          <input
            className="outline-panel__search"
            type="search"
            placeholder="Filtrar blocos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul
            ref={listRef}
            className="outline-panel__list"
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            {!virtualize && items.map((b, i) => (
              <OutlineItem
                key={i}
                block={b}
                onGoToLine={onGoToLine}
                onFocusTable={onFocusTable}
              />
            ))}
            {virtualize && (() => {
              const win = computeVirtualWindow({
                totalItems: items.length,
                itemHeight: ROW_HEIGHT,
                viewportHeight,
                scrollTop,
                overscan: OVERSCAN,
              });
              const visible = items.slice(win.startIndex, win.endIndex);
              return (
                <li aria-hidden="true" style={{ position: 'relative' }}>
                  <div style={{ height: win.totalHeight }}>
                    <div style={{ transform: `translateY(${win.offsetY}px)` }}>
                      {visible.map((b, j) => (
                        <OutlineItem
                          key={win.startIndex + j}
                          block={b}
                          onGoToLine={onGoToLine}
                          onFocusTable={onFocusTable}
                        />
                      ))}
                    </div>
                  </div>
                </li>
              );
            })()}
          </ul>
        </>
      )}
    </div>
  );
}

function OutlineItemImpl({
  block: b,
  onGoToLine,
  onFocusTable,
}: {
  block: Block;
  onGoToLine: (line: number) => void;
  onFocusTable?: (tableId: string) => void;
}) {
  return (
    <li
      className="outline-panel__item"
      onClick={() => {
        if (b.lineStart != null) onGoToLine(b.lineStart);
        if (b.type === 'table' && b.name && onFocusTable) {
          onFocusTable(b.name.replace(/"/g, ''));
        }
      }}
    >
      <span className="outline-panel__icon">{ICONS[b.type] || '·'}</span>
      <span className="outline-panel__label">{formatLabel(b)}</span>
    </li>
  );
}

const OutlineItem = React.memo(OutlineItemImpl);

function formatLabel(b: Block): string {
  if (b.name) return `${b.type === 'table' ? '' : b.type + ' '}${b.name.replace(/"/g, '')}`;
  if (b.type === 'ref') {
    const m = /Ref\s*(?:\w+\s*)?:\s*(.+)/i.exec(b.text);
    return m ? m[1].trim().slice(0, 40) : 'Ref';
  }
  if (b.type === 'lineage') return 'Lineage';
  return b.type;
}
