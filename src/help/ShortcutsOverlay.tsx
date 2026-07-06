import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Gesture, ShortcutRow } from './gestures';

type Props = {
  open: boolean;
  shortcuts: ShortcutRow[];
  gestures: Gesture[];
  onClose: () => void;
};

export function ShortcutsOverlay({ open, shortcuts, gestures, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!dialogRef.current?.contains(target)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div className="shortcuts-overlay__backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="shortcuts-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Atalhos e gestos"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <header className="shortcuts-overlay__header">
          <h2 className="shortcuts-overlay__title">Atalhos e gestos</h2>
          <button type="button" className="shortcuts-overlay__close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        <div className="shortcuts-overlay__body">
          <section className="shortcuts-overlay__column">
            <h3 className="shortcuts-overlay__column-title">Atalhos</h3>
            <ul className="shortcuts-overlay__list">
              {shortcuts.map((row) => (
                <li key={`${row.label}-${row.keys}`} className="shortcuts-overlay__row">
                  <kbd className="shortcuts-overlay__keys">{row.keys}</kbd>
                  <span className="shortcuts-overlay__label">{row.label}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="shortcuts-overlay__column">
            <h3 className="shortcuts-overlay__column-title">Gestos do canvas</h3>
            <ul className="shortcuts-overlay__list">
              {gestures.map((entry) => (
                <li key={entry.gesture} className="shortcuts-overlay__row">
                  <span className="shortcuts-overlay__gesture">{entry.gesture}</span>
                  <span className="shortcuts-overlay__effect">{entry.effect}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
