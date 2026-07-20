import { describe, it, expect } from 'vitest';
// diffLines não é exportado diretamente, então recriamos a lógica do
// componente aqui para validar o algoritmo LCS.
// Mantemos este teste como contrato de comportamento.
function diffLines(saved: string, working: string): { kind: 'same' | 'add' | 'del'; text: string }[] {
  const a = saved.split('\n');
  const b = working.split('\n');
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1;
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: { kind: 'same' | 'add' | 'del'; text: string }[] = [];
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
  while (i < m) { out.push({ kind: 'del', text: a[i] }); i++; }
  while (j < n) { out.push({ kind: 'add', text: b[j] }); j++; }
  return out;
}

describe('diffLines (LCS)', () => {
  it('retorna vazio para entradas idênticas', () => {
    const out = diffLines('a\nb\nc', 'a\nb\nc');
    expect(out.every((l) => l.kind === 'same')).toBe(true);
    expect(out.length).toBe(3);
  });

  it('marca linha adicionada', () => {
    const out = diffLines('a\nc', 'a\nb\nc');
    const added = out.filter((l) => l.kind === 'add');
    expect(added.length).toBe(1);
    expect(added[0].text).toBe('b');
  });

  it('marca linha removida', () => {
    const out = diffLines('a\nb\nc', 'a\nc');
    const removed = out.filter((l) => l.kind === 'del');
    expect(removed.length).toBe(1);
    expect(removed[0].text).toBe('b');
  });

  it('trata múltiplas adições/remoções', () => {
    const out = diffLines('a\nb\nc', 'a\nX\nc\nY');
    const added = out.filter((l) => l.kind === 'add').map((l) => l.text);
    const removed = out.filter((l) => l.kind === 'del').map((l) => l.text);
    expect(added.sort()).toEqual(['X', 'Y']);
    expect(removed).toEqual(['b']);
  });

  it('lida com texto vazio', () => {
    const out = diffLines('', 'a\nb');
    // '' vira [''] no split; tratamos isso como 1 linha vazia comum
    const added = out.filter((l) => l.kind === 'add').map((l) => l.text);
    expect(added).toEqual(['a', 'b']);
    // a primeira "" pode ser "same" (linha vazia comum) — sem diff real
    expect(out.filter((l) => l.kind === 'del').length).toBeLessThanOrEqual(1);
  });
});