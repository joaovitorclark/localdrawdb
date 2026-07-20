import { useMemo, useState } from 'react';
import { Close } from '../icons';

type Props = {
  saved: string;
  working: string;
  open: boolean;
  onClose: () => void;
};

type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/**
 * Diff linha-a-linha entre DBML em memória (working) e último salvo em disco
 * (saved). Algoritmo: LCS (Longest Common Subsequence) para alinhar as linhas
 * comuns; demais são marcados como adicionados (+) ou removidos (-).
 */
function diffLines(saved: string, working: string): DiffLine[] {
  const a = saved.split('\n');
  const b = working.split('\n');
  const m = a.length;
  const n = b.length;
  // matriz LCS
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1;
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ kind: 'del', text: a[i] });
    i++;
  }
  while (j < n) {
    out.push({ kind: 'add', text: b[j] });
    j++;
  }
  return out;
}

export function DbmlDiff({ saved, working, open, onClose }: Props) {
  const lines = useMemo(() => (open ? diffLines(saved, working) : []), [saved, working, open]);
  const counts = useMemo(() => {
    let add = 0;
    let del = 0;
    for (const l of lines) {
      if (l.kind === 'add') add++;
      else if (l.kind === 'del') del++;
    }
    return { add, del };
  }, [lines]);
  if (!open) return null;
  return (
    <div className="dbml-diff" role="dialog" aria-label="Diff DBML salvo vs trabalhando">
      <div className="dbml-diff__header">
        <strong>Diff DBML</strong>
        <span className="dbml-diff__counts">
          <span className="dbml-diff__add">+{counts.add}</span>
          <span className="dbml-diff__del">-{counts.del}</span>
        </span>
        <button type="button" className="dbml-diff__close" aria-label="Fechar" onClick={onClose}>
          <Close className="icon-inline" size={14} />
        </button>
      </div>
      <pre className="dbml-diff__body">
        {lines.map((l, i) => (
          <div key={i} className={`dbml-diff__line dbml-diff__line--${l.kind}`}>
            <span className="dbml-diff__sign">
              {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
            </span>
            <span className="dbml-diff__text">{l.text || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}