import { useEffect, useRef, useState } from 'react';
import { Chevron } from './icons';

type Variant = 'default' | 'star' | 'snowflake';

type Props = {
  /** Recebe a variante escolhida. `undefined` = layout padrão (cluster-based). */
  onPick: (variant?: 'star' | 'snowflake') => void;
};

const OPTIONS: { id: Variant | 'default'; label: string; description: string }[] = [
  { id: 'default', label: 'Padrão (cluster)', description: 'Agrupa por TableGroup/camada' },
  { id: 'star', label: 'Star schema', description: 'Fato central + dimensões em volta' },
  { id: 'snowflake', label: 'Snowflake', description: 'Fato central + sub-dimensões concêntricas' },
];

export function OrganizeMenu({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="toolbar__organize-menu" ref={rootRef}>
      <button
        type="button"
        className="toolbar__organize-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Organizar canvas <Chevron dir="down" className="icon-inline" size={14} />
      </button>
      {open ? (
        <div className="toolbar__organize-dropdown" role="menu">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="toolbar__organize-item"
              onClick={() => {
                setOpen(false);
                onPick(opt.id === 'default' ? undefined : opt.id);
              }}
            >
              <span className="toolbar__organize-item-label">{opt.label}</span>
              <span className="toolbar__organize-item-desc">{opt.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}