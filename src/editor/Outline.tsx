import { useMemo, useState } from 'react';
import { splitDbmlBlocks, type Block } from '../dsl/blocks';
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

export function Outline({ dbml, onGoToLine, onFocusTable }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const blocks = splitDbmlBlocks(dbml);
    const base = blocks.filter((b) => b.type !== 'blank' && b.type !== 'comment');
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((b) => formatLabel(b).toLowerCase().includes(q));
  }, [dbml, query]);

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
          <ul className="outline-panel__list">
            {items.map((b, i) => (
              <li
                key={i}
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
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function formatLabel(b: Block): string {
  if (b.name) return `${b.type === 'table' ? '' : b.type + ' '}${b.name.replace(/"/g, '')}`;
  if (b.type === 'ref') {
    const m = /Ref\s*(?:\w+\s*)?:\s*(.+)/i.exec(b.text);
    return m ? m[1].trim().slice(0, 40) : 'Ref';
  }
  if (b.type === 'lineage') return 'Lineage';
  return b.type;
}
