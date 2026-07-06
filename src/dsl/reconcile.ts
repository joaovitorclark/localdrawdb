// Análise de renames para o commit: o que mudou e quantas referências cada rename toca.
import { detectRenames, type DetectedRename } from './renameDetect';
import { normalizeEol } from './blocks';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripQuotes = (s: string) => s.replace(/["`]/g, '').trim();

export type RenameImpact = { rename: DetectedRename; refCount: number; affectsRefs: boolean };

/** Conta ocorrências que a propagação tocaria, fora da definição da própria entidade. */
export function countRenameRefs(src: string, rename: DetectedRename): number {
  src = normalizeEol(src); // CRLF-safe: contagem alinhada ao replace real

  if (rename.kind === 'table') {
    const old = stripQuotes(rename.oldId);
    const re = new RegExp(`(?<![\\w.])${escapeRegex(old)}(?![\\w])`, 'g');
    const total = (src.match(re) ?? []).length;
    // desconta a definição (cabeçalho `Table old`)
    const headerRe = new RegExp(`Table\\s+"?${escapeRegex(old)}"?`, 'g');
    const headers = (src.match(headerRe) ?? []).length;
    return Math.max(0, total - headers);
  }
  // coluna: conta `table.oldCol` qualificado fora da própria tabela
  const t = stripQuotes(rename.table);
  const q = `${t}.${rename.oldCol}`;
  const re = new RegExp(`(?<![\\w.])${escapeRegex(q)}(?![\\w])`, 'g');
  return (src.match(re) ?? []).length;
}

/** detectRenames + impacto por item (texto estável, chamado no commit). */
export function analyzeRenames(committed: string, buffer: string): RenameImpact[] {
  return detectRenames(committed, buffer).map((rename) => {
    const refCount = countRenameRefs(buffer, rename);
    return { rename, refCount, affectsRefs: refCount > 0 };
  });
}
