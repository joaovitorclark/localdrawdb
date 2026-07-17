import dagre from 'dagre';
import type { ParseResult, TableView } from '../dsl/parse';
import { tableLayerMap } from '../layers';
import type { Positions } from './hooks/useCanvasNodes';
import { nodeHeight, nodeWidth, type NodeMetricsOpts } from './nodeMetrics';

const MARGIN = 20;
const MARGIN_WIDE = 16;
const COMPONENT_GAP = 96;
const COMPONENT_GAP_WIDE = 64;
const CLUSTER_PAD_Y = 40;
const GROUP_EXTRA_SEP = 24;

type LayoutProfile = 'default' | 'wide';
type Rect = { id: string; x: number; y: number; w: number; h: number };

function clusterProfile(clusterKey: string): LayoutProfile {
  if (clusterKey === 'layer:bronze') return 'wide';
  return 'default';
}

/** Mais colunas que linhas — preferência horizontal em clusters esparsos (ex.: bronze). */
export function gridCols(n: number, profile: LayoutProfile = 'default'): number {
  if (n <= 1) return 1;
  if (profile === 'wide') return Math.max(1, Math.ceil(Math.sqrt(n * 2.5)));
  return Math.max(1, Math.ceil(Math.sqrt(n)));
}

function cellMargin(profile: LayoutProfile): number {
  return profile === 'wide' ? MARGIN_WIDE : MARGIN;
}

const WIDE_ROWS_PER_COL = 3;
/** Quebra coluna quando a próxima tabela é muito mais alta que a anterior. */
const WIDE_HEIGHT_BREAK_RATIO = 1.8;

/** Tamanho visual para ordenação bronze (compacto só mostra título — usa nº de colunas). */
function layoutVisualSize(t: TableView, metrics: NodeMetricsOpts): number {
  if (metrics.compact) return t.columns.length;
  return nodeHeight(t, metrics);
}

/** Menores primeiro; colunas à esquerda, maiores à direita (empilhadas por coluna). */
function sortTablesForPack(
  tables: TableView[],
  metrics: NodeMetricsOpts,
  profile: LayoutProfile,
): TableView[] {
  const sorted = [...tables];
  if (profile === 'wide') {
    sorted.sort((a, b) => {
      const sa = layoutVisualSize(a, metrics);
      const sb = layoutVisualSize(b, metrics);
      if (sa !== sb) return sa - sb;
      const wa = nodeWidth(a, metrics);
      const wb = nodeWidth(b, metrics);
      if (wa !== wb) return wa - wb;
      return a.id.localeCompare(b.id);
    });
    return sorted;
  }
  sorted.sort((a, b) => a.id.localeCompare(b.id));
  return sorted;
}

function layoutMetrics(compact: boolean): NodeMetricsOpts {
  return { compact, layout: true };
}

function layerForTable(t: TableView, layerMap: Record<string, string>): string | undefined {
  if (layerMap[t.id]) return layerMap[t.id];
  if (t.schema?.trim()) return t.schema.trim();
  const dot = t.id.indexOf('.');
  if (dot > 0) return t.id.slice(0, dot);
  return undefined;
}

function clusterKey(t: TableView, layerMap: Record<string, string>): string {
  if (t.group?.trim()) return `group:${t.group.trim()}`;
  const layer = layerForTable(t, layerMap);
  if (layer) return `layer:${layer}`;
  return 'default';
}

function buildDegreeMap(parsed: ParseResult, ids: Set<string>): Map<string, number> {
  const deg = new Map<string, number>();
  for (const id of ids) deg.set(id, 0);
  const bump = (a: string, b: string) => {
    if (!ids.has(a) || !ids.has(b)) return;
    deg.set(a, (deg.get(a) ?? 0) + 1);
    deg.set(b, (deg.get(b) ?? 0) + 1);
  };
  for (const r of parsed.refs) bump(r.source, r.target);
  for (const entry of parsed.lineage) {
    if (!ids.has(entry.target)) continue;
    for (const src of entry.sources) {
      if (ids.has(src)) bump(src, entry.target);
    }
  }
  return deg;
}

function connectedComponents(ids: Set<string>, parsed: ParseResult): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x)!;
    while (p !== x) {
      const next = parent.get(p)!;
      parent.set(x, next);
      x = p;
      p = next;
    }
    return p;
  };
  const unite = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const id of ids) parent.set(id, id);
  for (const r of parsed.refs) {
    if (ids.has(r.source) && ids.has(r.target)) unite(r.source, r.target);
  }
  for (const entry of parsed.lineage) {
    if (!ids.has(entry.target)) continue;
    for (const src of entry.sources) {
      if (ids.has(src)) unite(src, entry.target);
    }
  }
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    buckets.set(root, [...(buckets.get(root) ?? []), id]);
  }
  return [...buckets.values()].map((members) => members.sort());
}

function dagreSpacing(n: number, inGroup: boolean): { nodesep: number; ranksep: number } {
  const s = Math.sqrt(Math.max(1, n));
  const extra = inGroup ? GROUP_EXTRA_SEP : 0;
  return {
    nodesep: Math.max(56, Math.round(32 + 6 * s) + extra),
    ranksep: Math.max(100, Math.round(60 + 10 * s) + extra),
  };
}

function countInternalEdges(ids: Set<string>, parsed: ParseResult): number {
  let n = 0;
  for (const r of parsed.refs) {
    if (ids.has(r.source) && ids.has(r.target)) n++;
  }
  for (const entry of parsed.lineage) {
    if (!ids.has(entry.target)) continue;
    for (const src of entry.sources) {
      if (ids.has(src)) n++;
    }
  }
  return n;
}

/** Grade 2D garantida (sem dagre) — usada quando o grafo é esparso ou após colisões. */
function layoutClusterGrid(
  tables: TableView[],
  metrics: NodeMetricsOpts,
  profile: LayoutProfile,
  offsetY = 0,
): Positions {
  const sorted = sortTablesForPack(tables, metrics, profile);
  return packSingletonGrid(sorted, metrics, offsetY, profile).positions;
}

function layoutSubset(
  tables: TableView[],
  parsed: ParseResult,
  metrics: NodeMetricsOpts,
  inGroup: boolean,
  profile: LayoutProfile,
): Positions {
  const ids = new Set(tables.map((t) => t.id));
  const edges = countInternalEdges(ids, parsed);
  const sparse = tables.length >= 4 && edges < tables.length * 0.45;
  if (edges === 0 || sparse || (inGroup && tables.length >= 6 && edges < tables.length)) {
    return layoutClusterGrid(tables, metrics, profile);
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  const { nodesep, ranksep } = dagreSpacing(tables.length, inGroup);
  g.setGraph({ rankdir: 'LR', nodesep, ranksep, marginx: 24, marginy: 24 });

  for (const t of tables) {
    g.setNode(t.id, { width: nodeWidth(t, metrics), height: nodeHeight(t, metrics) });
  }
  for (const r of parsed.refs) {
    if (ids.has(r.source) && ids.has(r.target)) g.setEdge(r.source, r.target);
  }
  for (const entry of parsed.lineage) {
    if (!ids.has(entry.target)) continue;
    for (const src of entry.sources) {
      if (ids.has(src)) g.setEdge(src, entry.target);
    }
  }

  dagre.layout(g);

  const out: Positions = {};
  for (const t of tables) {
    const n = g.node(t.id);
    if (n) out[t.id] = { x: n.x - n.width / 2, y: n.y - n.height / 2 };
  }
  return out;
}

/** Bronze: colunas verticais (menores empilhadas à esquerda; gigantes em coluna própria à direita). */
function packWideColumnMajor(
  tables: TableView[],
  metrics: NodeMetricsOpts,
  offsetY: number,
  margin: number,
): { positions: Positions; maxY: number } {
  const positions: Positions = {};
  const columns: TableView[][] = [];
  let current: TableView[] = [];

  for (const t of tables) {
    if (current.length >= WIDE_ROWS_PER_COL) {
      columns.push(current);
      current = [];
    } else if (current.length > 0) {
      const prev = current[current.length - 1];
      const prevH = layoutVisualSize(prev, metrics);
      const h = layoutVisualSize(t, metrics);
      if (h > prevH * WIDE_HEIGHT_BREAK_RATIO) {
        columns.push(current);
        current = [t];
        continue;
      }
    }
    current.push(t);
  }
  if (current.length) columns.push(current);

  let xAcc = 0;
  let maxY = offsetY;
  for (const colTables of columns) {
    const colWidth =
      Math.max(...colTables.map((t) => nodeWidth(t, metrics))) + margin;
    let yAcc = offsetY;
    for (const t of colTables) {
      positions[t.id] = { x: xAcc, y: yAcc };
      yAcc += nodeHeight(t, metrics) + margin;
      maxY = Math.max(maxY, yAcc - margin);
    }
    xAcc += colWidth;
  }

  return { positions, maxY };
}

/** Empacota tabelas em grade com colunas/linhas de largura variável. */
function packSingletonGrid(
  tables: TableView[],
  metrics: NodeMetricsOpts,
  offsetY: number,
  profile: LayoutProfile = 'default',
): { positions: Positions; maxY: number } {
  const positions: Positions = {};
  if (!tables.length) return { positions, maxY: offsetY };

  const margin = cellMargin(profile);

  if (profile === 'wide') {
    return packWideColumnMajor(tables, metrics, offsetY, margin);
  }

  const cols = gridCols(tables.length, profile);
  const rows = Math.ceil(tables.length / cols);
  const colWidths = new Array<number>(cols).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);

  tables.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    colWidths[col] = Math.max(colWidths[col], nodeWidth(t, metrics) + margin);
    rowHeights[row] = Math.max(rowHeights[row], nodeHeight(t, metrics) + margin);
  });

  const colX: number[] = [];
  let xAcc = 0;
  for (let c = 0; c < cols; c++) {
    colX[c] = xAcc;
    xAcc += colWidths[c];
  }
  const rowY: number[] = [];
  let yAcc = offsetY;
  for (let r = 0; r < rows; r++) {
    rowY[r] = yAcc;
    yAcc += rowHeights[r];
  }

  let maxY = offsetY;
  tables.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = colX[col];
    const y = rowY[row];
    positions[t.id] = { x, y };
    maxY = Math.max(maxY, y + nodeHeight(t, metrics));
  });

  return { positions, maxY };
}

function layoutCluster(
  tables: TableView[],
  parsed: ParseResult,
  metrics: NodeMetricsOpts,
  inGroup: boolean,
  profile: LayoutProfile,
): Positions {
  const ids = new Set(tables.map((t) => t.id));
  const components = connectedComponents(ids, parsed);
  const tableById = new Map(tables.map((t) => [t.id, t] as const));
  const gap = profile === 'wide' ? COMPONENT_GAP_WIDE : COMPONENT_GAP;
  const margin = cellMargin(profile);

  const positions: Positions = {};
  let offsetY = 0;
  const singletons: TableView[] = [];

  for (const memberIds of components) {
    if (memberIds.length === 1) {
      const t = tableById.get(memberIds[0]);
      if (t) singletons.push(t);
      continue;
    }

    const subset = memberIds.map((id) => tableById.get(id)!).filter(Boolean);
    const local = layoutSubset(subset, parsed, metrics, inGroup, profile);
    let maxY = offsetY;
    for (const t of subset) {
      const p = local[t.id];
      if (!p) continue;
      positions[t.id] = { x: p.x, y: p.y + offsetY };
      maxY = Math.max(maxY, p.y + offsetY + nodeHeight(t, metrics));
    }
    offsetY = maxY + gap;
  }

  if (singletons.length) {
    const packed = packSingletonGrid(
      sortTablesForPack(singletons, metrics, profile),
      metrics,
      offsetY,
      profile,
    );
    Object.assign(positions, packed.positions);
    offsetY = packed.maxY + gap;
  }

  let out = resolveOverlaps(positions, tables, parsed, metrics, margin);
  if (countOverlaps(toRects(out, tables, metrics), margin) > 0) {
    out = layoutClusterGrid(tables, metrics, profile);
  }
  return out;
}

function rectsOverlap(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.x < b.x + b.w + margin &&
    a.x + a.w + margin > b.x &&
    a.y < b.y + b.h + margin &&
    a.y + a.h + margin > b.y
  );
}

function toRects(positions: Positions, tables: TableView[], metrics: NodeMetricsOpts): Rect[] {
  return tables
    .filter((t) => positions[t.id])
    .map((t) => ({
      id: t.id,
      x: positions[t.id].x,
      y: positions[t.id].y,
      w: nodeWidth(t, metrics),
      h: nodeHeight(t, metrics),
    }));
}

function countOverlaps(rects: Rect[], margin: number): number {
  let n = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j], margin)) n++;
    }
  }
  return n;
}

/** Empurra nós sobrepostos (só entre as tabelas do conjunto passado). */
export function resolveOverlaps(
  positions: Positions,
  tables: TableView[],
  parsed: ParseResult,
  metrics: NodeMetricsOpts,
  margin = MARGIN,
): Positions {
  const ids = new Set(tables.map((t) => t.id));
  const degree = buildDegreeMap(parsed, ids);
  const pos: Positions = { ...positions };
  const maxIter = Math.max(80, tables.length * 8);

  for (let iter = 0; iter < maxIter; iter++) {
    const rects = toRects(pos, tables, metrics);
    if (countOverlaps(rects, margin) === 0) break;

    let moved = false;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!rectsOverlap(a, b, margin)) continue;

        const moveA = (degree.get(a.id) ?? 0) <= (degree.get(b.id) ?? 0);
        const moveId = moveA ? a.id : b.id;
        const self = moveA ? a : b;
        const other = moveA ? b : a;

        const gapX = other.x + other.w + margin - self.x;
        const gapY = other.y + other.h + margin - self.y;
        const overlapX = self.x + self.w + margin - other.x;
        const overlapY = self.y + self.h + margin - other.y;
        const cur = pos[moveId];
        let nx = cur.x;
        let ny = cur.y;
        if (gapX > 0 && (gapX <= gapY || gapY <= 0)) nx += gapX;
        else if (overlapX > 0 && gapX <= 0) nx += overlapX;
        if (gapY > 0 && (gapY < gapX || gapX <= 0)) ny += gapY;
        else if (overlapY > 0 && gapY <= 0) ny += overlapY;
        if (nx === cur.x && ny === cur.y) {
          nx += margin + 1;
          ny += margin + 1;
        }
        if (nx !== cur.x || ny !== cur.y) {
          pos[moveId] = { x: nx, y: ny };
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return pos;
}

/** Ordem de coluna para layout de linhagem (esquerda → direita = fluxo ETL). */
const LINEAGE_LAYER_RANK: Record<string, number> = {
  bronze: 0,
  raw: 0,
  landing: 0,
  ingestao: 0,
  staging: 5,
  prata: 10,
  silver: 10,
  ouro: 20,
  gold: 20,
};

function lineageLayerRank(layer?: string): number {
  if (!layer) return 900;
  const key = layer.toLowerCase().trim();
  return LINEAGE_LAYER_RANK[key] ?? 900;
}

function tableColumnRank(
  id: string,
  tableById: Map<string, TableView>,
  layerMap: Record<string, string>,
  edges: { source: string; target: string }[],
  ids: Set<string>,
  memo: Map<string, number>,
): number {
  if (memo.has(id)) return memo.get(id)!;
  memo.set(id, 900);

  const t = tableById.get(id);
  if (t) {
    const fromLayer = lineageLayerRank(layerForTable(t, layerMap));
    if (fromLayer < 900) {
      memo.set(id, fromLayer);
      return fromLayer;
    }
  }

  const srcs = edges.filter((e) => e.target === id).map((e) => e.source).filter((s) => ids.has(s));
  if (srcs.length) {
    const col = Math.max(...srcs.map((s) => tableColumnRank(s, tableById, layerMap, edges, ids, memo))) + 1;
    memo.set(id, col);
    return col;
  }

  const tgts = edges.filter((e) => e.source === id).map((e) => e.target).filter((t) => ids.has(t));
  if (tgts.length) {
    const col = Math.max(0, Math.min(...tgts.map((t) => tableColumnRank(t, tableById, layerMap, edges, ids, memo))) - 1);
    memo.set(id, col);
    return col;
  }

  memo.set(id, 900);
  return 900;
}

function lineageTableArea(t: TableView, metrics: NodeMetricsOpts): number {
  return nodeWidth(t, metrics) * nodeHeight(t, metrics);
}

const LINEAGE_MARGIN = 28;
const LINEAGE_BAND_GAP = 180;
const LINEAGE_GROUP_GAP = 64;
/** Padding interno da caixa TableGroup no canvas (useCanvasNodes groupNodes). */
const LINEAGE_GROUP_PAD = 24;
const LINEAGE_GROUP_LABEL = 18;

function shiftPositions(local: Positions, dx: number, dy: number): Positions {
  const out: Positions = {};
  for (const [id, p] of Object.entries(local)) {
    out[id] = { x: p.x + dx, y: p.y + dy };
  }
  return out;
}

function boundsOf(positions: Positions, tables: TableView[], metrics: NodeMetricsOpts): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tables) {
    const p = positions[t.id];
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + nodeWidth(t, metrics));
    maxY = Math.max(maxY, p.y + nodeHeight(t, metrics));
  }
  if (!Number.isFinite(minX)) return null;
  return { id: '', x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function groupSortWeight(tables: TableView[], metrics: NodeMetricsOpts): number {
  return tables.reduce((sum, t) => sum + lineageTableArea(t, metrics), 0);
}

/** Inverso do pack wide normal: maiores primeiro, preenchimento horizontal (linha a linha). */
function sortTablesLargestFirst(tables: TableView[], metrics: NodeMetricsOpts): TableView[] {
  return [...tables].sort((a, b) => {
    const sa = lineageTableArea(a, metrics);
    const sb = lineageTableArea(b, metrics);
    if (sa !== sb) return sb - sa;
    const ha = nodeHeight(a, metrics);
    const hb = nodeHeight(b, metrics);
    if (ha !== hb) return hb - ha;
    return a.id.localeCompare(b.id);
  });
}

function packLineageLayerHorizontal(
  tables: TableView[],
  metrics: NodeMetricsOpts,
  originX: number,
  originY: number,
  margin: number,
): { positions: Positions; width: number; height: number } {
  const sorted = sortTablesLargestFirst(tables, metrics);
  const positions: Positions = {};
  if (!sorted.length) return { positions, width: 0, height: 0 };

  const cols = gridCols(sorted.length, 'wide');
  const rows = Math.ceil(sorted.length / cols);
  const colWidths = new Array<number>(cols).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);

  sorted.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    colWidths[col] = Math.max(colWidths[col], nodeWidth(t, metrics) + margin);
    rowHeights[row] = Math.max(rowHeights[row], nodeHeight(t, metrics) + margin);
  });

  const colX: number[] = [];
  let xAcc = originX;
  for (let c = 0; c < cols; c++) {
    colX[c] = xAcc;
    xAcc += colWidths[c];
  }
  const rowY: number[] = [];
  let yAcc = originY;
  for (let r = 0; r < rows; r++) {
    rowY[r] = yAcc;
    yAcc += rowHeights[r];
  }

  let maxX = originX;
  let maxY = originY;
  sorted.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions[t.id] = { x: colX[col], y: rowY[row] };
    maxX = Math.max(maxX, colX[col] + nodeWidth(t, metrics));
    maxY = Math.max(maxY, rowY[row] + nodeHeight(t, metrics));
  });

  return { positions, width: maxX - originX + margin, height: maxY - originY + margin };
}

/** Layout interno de um TableGroup (ou tabelas soltas): maiores à esquerda; dagre se houver linhagem interna. */
function layoutLineageGroupInternal(
  tables: TableView[],
  parsed: ParseResult,
  metrics: NodeMetricsOpts,
  margin: number,
): Positions {
  const ids = new Set(tables.map((t) => t.id));
  const internalLineage = parsed.lineage.filter(
    (e) => ids.has(e.target) && e.sources.some((s) => ids.has(s)),
  );
  if (internalLineage.length > 0 && tables.length >= 2) {
    return layoutSubset(tables, parsed, metrics, true, 'default');
  }
  return packLineageLayerHorizontal(tables, metrics, 0, 0, margin).positions;
}

function countAllOverlaps(positions: Positions, tables: TableView[], metrics: NodeMetricsOpts, margin: number): number {
  return countOverlaps(toRects(positions, tables, metrics), margin);
}

/**
 * Layout para modo linhagem: faixas por camada (bronze→prata→ouro), TableGroups compactos
 * empilhados na faixa, maiores à esquerda dentro de cada grupo. Usa altura real das tabelas.
 */
export function autolayoutLineagePositions(parsed: ParseResult): Positions {
  const metrics = layoutMetrics(false);
  const layerMap = tableLayerMap(parsed.layerGroups);
  const tables = parsed.tables;
  if (!tables.length) return {};

  const tableById = new Map(tables.map((t) => [t.id, t] as const));
  const ids = new Set(tables.map((t) => t.id));
  const edges: { source: string; target: string }[] = [];
  for (const entry of parsed.lineage) {
    for (const src of entry.sources) {
      if (ids.has(src) && ids.has(entry.target)) edges.push({ source: src, target: entry.target });
    }
  }

  const memo = new Map<string, number>();
  const columnOf = new Map<string, number>();
  for (const t of tables) {
    columnOf.set(t.id, tableColumnRank(t.id, tableById, layerMap, edges, ids, memo));
  }

  const byBand = new Map<number, TableView[]>();
  for (const t of tables) {
    const col = columnOf.get(t.id) ?? 900;
    byBand.set(col, [...(byBand.get(col) ?? []), t]);
  }

  const margin = LINEAGE_MARGIN;
  const positions: Positions = {};
  let bandX = 40;
  const sortedBands = [...byBand.keys()].sort((a, b) => a - b);

  for (const band of sortedBands) {
    const bandTables = byBand.get(band)!;
    const byGroup = new Map<string, TableView[]>();
    for (const t of bandTables) {
      const g = t.group?.trim() || '__solo__';
      byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
    }

    const groupKeys = [...byGroup.keys()].sort((a, b) => {
      const wa = groupSortWeight(byGroup.get(a)!, metrics);
      const wb = groupSortWeight(byGroup.get(b)!, metrics);
      if (wa !== wb) return wb - wa;
      return a.localeCompare(b);
    });

    let bandY = 40;
    let bandMaxX = bandX;

    for (const gk of groupKeys) {
      const gTables = byGroup.get(gk)!;
      let local = layoutLineageGroupInternal(gTables, parsed, metrics, margin);
      local = resolveOverlaps(local, gTables, parsed, metrics, margin);

      const innerOriginX = bandX + LINEAGE_GROUP_PAD;
      const innerOriginY = bandY + LINEAGE_GROUP_PAD + LINEAGE_GROUP_LABEL;
      const shifted = shiftPositions(local, innerOriginX, innerOriginY);
      Object.assign(positions, shifted);

      const box = boundsOf(shifted, gTables, metrics);
      if (box) {
        bandMaxX = Math.max(bandMaxX, box.x + box.w + LINEAGE_GROUP_PAD);
        bandY = box.y + box.h + LINEAGE_GROUP_PAD + LINEAGE_GROUP_GAP;
      }
    }

    bandX = bandMaxX + LINEAGE_BAND_GAP;
  }

  let out = resolveOverlaps(positions, tables, parsed, metrics, margin);
  if (countAllOverlaps(out, tables, metrics, margin) > 0) {
    out = resolveOverlaps(out, tables, parsed, metrics, margin + 16);
  }
  return out;
}

/** Autolayout por cluster (TableGroup → Layer/schema → default), sem sobreposição. */
export function autolayoutPositions(parsed: ParseResult, compact = false): Positions {
  const metrics = layoutMetrics(compact);
  const layerMap = tableLayerMap(parsed.layerGroups);

  const byCluster = new Map<string, TableView[]>();
  for (const t of parsed.tables) {
    const key = clusterKey(t, layerMap);
    byCluster.set(key, [...(byCluster.get(key) ?? []), t]);
  }

  const positions: Positions = {};
  let offsetX = 40;
  const sortedKeys = [...byCluster.keys()].sort();

  for (const key of sortedKeys) {
    const tables = byCluster.get(key)!;
    const inGroup = key.startsWith('group:');
    const profile = clusterProfile(key);
    const margin = cellMargin(profile);
    let cluster = layoutCluster(tables, parsed, metrics, inGroup, profile);
    cluster = resolveOverlaps(cluster, tables, parsed, metrics, margin);

    let clusterMaxX = offsetX;
    for (const t of tables) {
      const p = cluster[t.id];
      if (!p) continue;
      const x = p.x + offsetX;
      positions[t.id] = { x, y: p.y + CLUSTER_PAD_Y };
      clusterMaxX = Math.max(clusterMaxX, x + nodeWidth(t, metrics));
    }
    const clusterWidth = clusterMaxX - offsetX;
    const clusterGap = Math.max(120, Math.round(clusterWidth * 0.18));
    offsetX = clusterMaxX + clusterGap;
  }

  return positions;
}
