import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { filterCommands, type Command } from './registry';

type Props = {
  open: boolean;
  commands: Command[];
  onClose: () => void;
};

export function CommandPalette({ open, commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => filterCommands(commands, query, 12), [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [open, results.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!dialogRef.current?.contains(target)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const runSelected = async () => {
    const command = results[selectedIndex];
    if (!command) return;
    await command.run();
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((index) => (results.length ? (index + 1) % results.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void runSelected();
    }
  };

  return createPortal(
    <div className="command-palette__overlay" role="presentation">
      <div
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className="command-palette__input"
          type="search"
          placeholder="Buscar tabela, coluna ou ação…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <ul className="command-palette__list" role="listbox" aria-label="Resultados">
          {results.length === 0 && (
            <li className="command-palette__empty">Nenhum resultado</li>
          )}
          {results.map((command, index) => {
            const isColumn = command.kind === 'column';
            const labelParts = isColumn ? command.label.split('.') : null;
            const columnName = labelParts ? labelParts[labelParts.length - 1] : '';
            const tableLabel = isColumn
              ? command.label.slice(0, command.label.length - columnName.length - 1)
              : '';
            return (
              <li key={command.id}>
                <button
                  type="button"
                  className={`command-palette__item${index === selectedIndex ? ' is-active' : ''}`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    void command.run();
                    onClose();
                  }}
                >
                  <span className="command-palette__label">
                    {isColumn ? (
                      <>
                        <span className="cp-table">{tableLabel}</span>
                        <span className="cp-dot">.</span>
                        <span className="cp-col">{columnName}</span>
                      </>
                    ) : (
                      command.label
                    )}
                  </span>
                  <span className="command-palette__meta">
                    {command.shortcut && <span className="command-palette__shortcut">{command.shortcut}</span>}
                    <span className="command-palette__kind">
                      {command.kind === 'table' ? 'Tabela' :
                       command.kind === 'column' ? 'Coluna' : 'Ação'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
