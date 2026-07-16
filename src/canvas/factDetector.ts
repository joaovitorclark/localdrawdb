// Detector de tabela-fato para layouts star/snowflake.
//
// Heurística em 3 níveis (escolhe o melhor disponível):
//   1. Tabela marcada com `group: fact` no DBML.
//   2. Tabela com maior número de FKs *outgoing* (referencia mais dimensões).
//      Em modelos bem modelados, a fato tem o maior fan-out — é a "mais conectada para fora".
//   3. Fallback: maior grau total (in + out) no grafo de refs.

import type { ParseResult, TableView } from '../dsl/parse';

export type FactCandidate = {
  id: string;
  score: number;
  reason: 'group:fact' | 'fk-fanout' | 'total-degree';
};

/** Conta FKs outgoing e incoming por tabela. */
export function computeDegrees(
  tables: TableView[],
  refs: { source: string; target: string }[],
): { out: Map<string, number>; inc: Map<string, number> } {
  const ids = new Set(tables.map((t) => t.id));
  const out = new Map<string, number>();
  const inc = new Map<string, number>();
  for (const t of tables) {
    out.set(t.id, 0);
    inc.set(t.id, 0);
  }
  for (const r of refs) {
    if (!ids.has(r.source) || !ids.has(r.target)) continue;
    out.set(r.source, (out.get(r.source) ?? 0) + 1);
    inc.set(r.target, (inc.get(r.target) ?? 0) + 1);
  }
  return { out, inc };
}

/** BFS partindo da fato: cada nível representa a "camada" no snowflake. */
export function bfsLayers(
  factId: string,
  tables: TableView[],
  refs: { source: string; target: string }[],
): Map<string, number> {
  const ids = new Set(tables.map((t) => t.id));
  const adj = new Map<string, Set<string>>();
  for (const t of tables) adj.set(t.id, new Set());
  for (const r of refs) {
    if (!ids.has(r.source) || !ids.has(r.target)) continue;
    adj.get(r.source)!.add(r.target);
    adj.get(r.target)!.add(r.source);
  }

  const layer = new Map<string, number>();
  if (!ids.has(factId)) {
    for (const t of tables) layer.set(t.id, 0);
    return layer;
  }
  layer.set(factId, 0);
  const queue: string[] = [factId];
  while (queue.length) {
    const cur = queue.shift()!;
    const curLayer = layer.get(cur)!;
    for (const next of adj.get(cur) ?? []) {
      if (layer.has(next)) continue; // já visitado — corta ciclo
      layer.set(next, curLayer + 1);
      queue.push(next);
    }
  }
  // Tabelas isoladas (sem ref alguma) ficam na última camada observada.
  let maxLayer = 0;
  for (const v of layer.values()) maxLayer = Math.max(maxLayer, v);
  for (const t of tables) if (!layer.has(t.id)) layer.set(t.id, maxLayer + 1);
  return layer;
}

/**
 * Escolhe a tabela-fato usando as 3 heurísticas em ordem.
 * Retorna null se não houver tabelas.
 */
export function detectFact(parsed: ParseResult): FactCandidate | null {
  if (!parsed.tables.length) return null;
  const tables = parsed.tables;
  const refs = parsed.refs.map((r) => ({ source: r.source, target: r.target }));

  // 1) group: fact explícito
  const explicit = tables.find((t) => t.group?.trim().toLowerCase() === 'fact');
  if (explicit) return { id: explicit.id, score: 0, reason: 'group:fact' };

  // 2) Maior fan-out (FKs outgoing). Só considera "fk-fanout" se houver uma
  // tabela com outgoing claramente maior que as outras; se houver empate
  // amplo (todas com mesmo fan-out ou fan-out ≤ 1), cai para total-degree.
  const { out, inc } = computeDegrees(tables, refs);
  const fanouts = tables.map((t) => out.get(t.id) ?? 0);
  const maxFanout = Math.max(...fanouts);
  const secondMaxFanout = fanouts.filter((f) => f !== maxFanout).reduce((a, b) => Math.max(a, b), 0);
  // "Claramente maior" = max - secondMax ≥ 1, e max ≥ 2 (uma tabela "fato"
  // típica tem várias FKs outgoing).
  const clearFanoutWinner = maxFanout >= 2 && maxFanout - secondMaxFanout >= 1;
  if (clearFanoutWinner) {
    let winner: { id: string; score: number } | null = null;
    for (const t of tables) {
      const f = out.get(t.id) ?? 0;
      if (f === maxFanout && (!winner || f > winner.score)) {
        winner = { id: t.id, score: f };
      }
    }
    if (winner) return { id: winner.id, score: winner.score, reason: 'fk-fanout' };
  }

  // 3) Maior grau total (in + out)
  let bestDegree: { id: string; score: number } | null = null;
  for (const t of tables) {
    const score = (out.get(t.id) ?? 0) + (inc.get(t.id) ?? 0);
    if (!bestDegree || score > bestDegree.score) bestDegree = { id: t.id, score };
  }
  if (bestDegree) return { id: bestDegree.id, score: bestDegree.score, reason: 'total-degree' };
  return null;
}