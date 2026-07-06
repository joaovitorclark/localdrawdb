import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Dot, Warning } from '../icons';
import { Tooltip } from '../Tooltip';

export type StatusLogEntry = { ts: number; msg: string };

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export type StatusIcon = 'warning' | 'dot' | 'check' | null;

type Props = {
  status: string;
  saveState: SaveState;
  logs: StatusLogEntry[];
};

export function statusLabel(
  saveState: SaveState,
  status: string,
): { text: string; cls: string; icon: StatusIcon } {
  const cls = `savestate--${saveState}`;
  if (saveState === 'saving') return { text: 'Salvando…', cls, icon: null };
  if (saveState === 'error') return { text: 'Falha ao salvar', cls, icon: 'warning' };
  if (saveState === 'dirty') return { text: 'Não salvo', cls, icon: 'dot' };
  if (status !== 'Pronto') return { text: status, cls, icon: null };
  return { text: 'Salvo', cls, icon: 'check' };
}

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function StatusIconView({ icon }: { icon: StatusIcon }) {
  if (icon === 'warning') return <Warning className="icon-inline status-log__icon" size={14} />;
  if (icon === 'dot') return <Dot filled className="icon-inline status-log__icon" size={10} />;
  if (icon === 'check') return <Check className="icon-inline status-log__icon" size={14} />;
  return null;
}

// v15-04: área de status vira botão → dropdown com os últimos 100 logs (mais recente no topo).
// Sem persistência (memória de sessão). Fecha ao clicar fora (padrão das paletas).
export function StatusLog({ status, saveState, logs }: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { text, cls, icon } = statusLabel(saveState, status);

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
      <Tooltip label="Histórico de status (últimos 100)">
        <button
          ref={btnRef}
          type="button"
          className={`status status-log__btn ${cls}${open ? ' is-open' : ''}`}
          onClick={toggle}
        >
          <StatusIconView icon={icon} />
          {text}
        </button>
      </Tooltip>
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
