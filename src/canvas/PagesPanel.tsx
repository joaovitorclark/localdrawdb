import { useMemo, useState } from 'react';
import type { CanvasPage } from '../api';
import { ALL_PAGE_ID } from './scaleLimits';
import { useCollapsePersist } from '../hooks/useCollapsePersist';

type Props = {
  pages: CanvasPage[];
  activePageIds: string[];
  totalTables: number;
  visibleTables: number;
  onChangeActivePages: (ids: string[]) => void;
};

export function PagesPanel({
  pages,
  activePageIds,
  totalTables,
  visibleTables,
  onChangeActivePages,
}: Props) {
  const [collapsed, toggleCollapsed] = useCollapsePersist('ldb.panel.pages', true);
  const selectablePages = useMemo(() => pages.filter((p) => p.id !== ALL_PAGE_ID), [pages]);
  const showAll = activePageIds.includes(ALL_PAGE_ID);
  const selected = useMemo(() => new Set(activePageIds), [activePageIds]);

  if (selectablePages.length === 0) return null;

  const toggleAll = (checked: boolean) => {
    if (checked) onChangeActivePages([ALL_PAGE_ID]);
    else onChangeActivePages([]);
  };

  const togglePage = (pageId: string, checked: boolean) => {
    let next = activePageIds.filter((id) => id !== ALL_PAGE_ID);
    if (checked) {
      if (!next.includes(pageId)) next = [...next, pageId];
    } else {
      next = next.filter((id) => id !== pageId);
    }
    onChangeActivePages(next);
  };

  return (
    <div className={`pages-panel ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        type="button"
        className="pages-panel__collapse"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expandir páginas' : 'Recolher páginas'}
      >
        {collapsed ? '▸ Páginas' : '▾ Páginas no canvas'}
      </button>
      {!collapsed && (
        <>
          <p className="pages-panel__hint">
            {visibleTables === 0 && totalTables > 0
              ? 'Nenhum assunto selecionado — marque abaixo para carregar o canvas.'
              : `${visibleTables} de ${totalTables} tabela(s) visíveis — modelo completo no editor.`}
          </p>
          <label className="pages-panel__row">
            <input type="checkbox" checked={showAll} onChange={(e) => toggleAll(e.target.checked)} />
            Todas
          </label>
          {selectablePages.map((p) => (
            <label key={p.id} className="pages-panel__row">
              <input
                type="checkbox"
                checked={!showAll && selected.has(p.id)}
                disabled={showAll}
                onChange={(e) => togglePage(p.id, e.target.checked)}
              />
              {p.name}
            </label>
          ))}
        </>
      )}
    </div>
  );
}
