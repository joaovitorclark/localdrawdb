/** Normaliza id de tabela pra comparação: minúsculas + sem aspas/backticks. */
export function normalizeTableIdForMatch(id: string): string {
  return id.replace(/["`']/g, '').trim().toLowerCase();
}

/**
 * Match pairwise de ids de tabela.
 *
 * - Exact (após normalize) → true
 * - Ambos qualificados e diferentes → false (nunca cruza schema via short name)
 * - Pelo menos um sem schema → compara só o nome curto
 *
 * Para "membro de grupo com regra de ambiguidade", use {@link resolveMemberTableIds}.
 */
export function tableIdsMatch(a: string, b: string): boolean {
  const x = normalizeTableIdForMatch(a);
  const y = normalizeTableIdForMatch(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xQualified = x.includes('.');
  const yQualified = y.includes('.');
  if (xQualified && yQualified) return false;
  return x.split('.').pop() === y.split('.').pop();
}

/**
 * Resolve um membro de TableGroup/LayerGroup contra a lista de tabelas.
 *
 * - Membro qualificado → só match exact (após normalize); sem fallback de short name
 * - Membro sem schema → match por short name **somente** se houver exatamente 1 candidato
 */
export function resolveMemberTableIds(member: string, tableIds: string[]): string[] {
  const m = normalizeTableIdForMatch(member);
  if (!m) return [];

  const normalized = tableIds.map((id) => ({ id, norm: normalizeTableIdForMatch(id) }));
  const exact = normalized.filter((t) => t.norm === m).map((t) => t.id);
  if (exact.length) return exact;

  if (m.includes('.')) return [];

  const short = normalized.filter((t) => t.norm.split('.').pop() === m).map((t) => t.id);
  return short.length === 1 ? short : [];
}
