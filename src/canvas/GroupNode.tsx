// Caixa de TableGroup: drag só na alça (rótulo + bordas); interior permite pan.
// Cor do grupo (--group-color): aplicada à borda tracejada e ao rótulo.
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasActions, TABLE_COLORS } from './actions';

type GroupData = { label: string; collapsed: boolean; count: number; color?: string; onToggle?: () => void };

function GroupNodeImpl({ data }: { data: GroupData }) {
  const actions = useCanvasActions();
  const [rect, setRect] = useState<DOMRect | null>(null); // paleta aberta = rect do botão
  const btnRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const style = data.color ? ({ '--group-color': data.color } as CSSProperties) : undefined;

  const close = useCallback(() => setRect(null), []);

  // Fecha ao clicar fora (o botão e a paleta portada ficam em subárvores diferentes).
  useEffect(() => {
    if (!rect) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || paletteRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [rect, close]);

  return (
    <div className={`group-node ${data.collapsed ? 'is-collapsed' : ''}`} style={style}>
      {!data.collapsed && (
        <>
          <div className="group-node__edge group-node__edge--top group-node__drag-handle" />
          <div className="group-node__edge group-node__edge--bottom group-node__drag-handle" />
          <div className="group-node__edge group-node__edge--left group-node__drag-handle" />
          <div className="group-node__edge group-node__edge--right group-node__drag-handle" />
        </>
      )}
      <span className="group-node__label group-node__drag-handle">
        <button
          type="button"
          className="group-node__toggle"
          title={data.collapsed ? 'Expandir' : 'Colapsar'}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle?.();
          }}
        >
          {data.collapsed ? '▸' : '▾'}
        </button>
        {data.label}
        {data.collapsed ? ` · ${data.count} tabela(s)` : ''}
        <button
          ref={btnRef}
          type="button"
          className="group-node__color nodrag nopan"
          title="Cor do grupo"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setRect((r) => (r ? null : (btnRef.current?.getBoundingClientRect() ?? null)));
          }}
        >
          ◑
        </button>
      </span>
      {/* Portada pra document.body: o group node é z-index:-1 e as tabelas cobririam a paleta. */}
      {rect &&
        createPortal(
          <div
            ref={paletteRef}
            className="color-palette color-palette--group nodrag nopan"
            style={{ position: 'fixed', top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 250) }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="color-palette__row">
              {TABLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  style={{ background: c }}
                  onClick={() => {
                    actions.onSetGroupColor(data.label, c);
                    close();
                  }}
                />
              ))}
              <button
                type="button"
                className="color-reset"
                title="Sem cor"
                onClick={() => {
                  actions.onSetGroupColor(data.label, null);
                  close();
                }}
              >
                ✕
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export const GroupNode = memo(GroupNodeImpl);
