import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModelIssue } from '../dsl/validateModel';
import { Warning } from '../icons';
import { Tooltip } from '../Tooltip';

type Props = {
  issues: ModelIssue[];
  onFocusTable?: (tableId: string) => void;
  onGoToLine?: (line: number) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

// v15-03: badge compacto no topo (perto de Salvar/status). Sem problemas → oculto.
// Clique abre a lista num popover via portal (não coberto pelos nós do canvas).
export function ProblemsPanel({ issues, onFocusTable, onGoToLine, open, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  const errors = useMemo(() => issues.filter((i) => i.severity === 'error'), [issues]);
  const warns = useMemo(() => issues.filter((i) => i.severity === 'warn'), [issues]);

  // Fecha ao clicar fora (badge e popover) — padrão das paletas.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (badgeRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.('.problems-pop')) return;
      setInternalOpen(false);
      onOpenChange?.(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [isOpen, onOpenChange]);

  // Some se não há problemas.
  if (!issues.length) return null;

  const severity = errors.length ? 'error' : 'warn';
  const label = errors.length
    ? `${errors.length} erro${errors.length !== 1 ? 's' : ''}${warns.length ? ` · ${warns.length} aviso${warns.length !== 1 ? 's' : ''}` : ''}`
    : `${warns.length} aviso${warns.length !== 1 ? 's' : ''}`;

  const toggle = () => {
    if (badgeRef.current) setRect(badgeRef.current.getBoundingClientRect());
    const next = !isOpen;
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <>
      <Tooltip label="Problemas do modelo">
        <button
          ref={badgeRef}
          type="button"
          className={`problems-badge problems-badge--${severity}${isOpen ? ' is-open' : ''}`}
          onClick={toggle}
        >
          <Warning className="icon-inline problems-badge__icon" size={14} />
          <span className="problems-badge__label">{label}</span>
        </button>
      </Tooltip>
      {isOpen &&
        rect &&
        createPortal(
          <div
            className="problems-pop"
            style={{
              position: 'fixed',
              top: rect.bottom + 4,
              right: Math.max(8, window.innerWidth - rect.right),
            }}
          >
            <ul className="problems-pop__list">
              {issues.map((issue, i) => (
                <li key={i} className={`problems-pop__item problems-pop__item--${issue.severity}`}>
                  <div className="problems-pop__row">
                    {issue.line != null && onGoToLine && (
                      <Tooltip label="Ir à linha no editor">
                        <button
                          type="button"
                          className="problems-pop__goto"
                          onClick={() => { onGoToLine(issue.line!); setInternalOpen(false); onOpenChange?.(false); }}
                        >
                          Linha
                        </button>
                      </Tooltip>
                    )}
                    {issue.tableId && onFocusTable && (
                      <Tooltip label="Ir para tabela no canvas">
                        <button
                          type="button"
                          className="problems-pop__goto"
                          onClick={() => { onFocusTable(issue.tableId!); setInternalOpen(false); onOpenChange?.(false); }}
                        >
                          Tabela
                        </button>
                      </Tooltip>
                    )}
                    <span className="problems-pop__msg">{issue.message}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
