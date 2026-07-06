import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type StatusLogEntry = { ts: number; msg: string };

type Props = {
  status: string;
  logs: StatusLogEntry[];
};

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// v15-04: área de status vira botão → dropdown com os últimos 100 logs (mais recente no topo).
// Sem persistência (memória de sessão). Fecha ao clicar fora (padrão das paletas).
export function StatusLog({ status, logs }: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.('.status-log__pop')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const toggle = () => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`status status-log__btn${open ? ' is-open' : ''}`}
        title="Histórico de status (últimos 100)"
        onClick={toggle}
      >
        {status}
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            className="status-log__pop"
            style={{ position: 'fixed', top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) }}
          >
            {logs.length === 0 ? (
              <div className="status-log__empty">Sem registros nesta sessão</div>
            ) : (
              <ul className="status-log__list">
                {logs.map((e, i) => (
                  <li key={`${e.ts}-${i}`} className="status-log__item">
                    <span className="status-log__time">{fmtTime(e.ts)}</span>
                    <span className="status-log__msg">{e.msg}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
