// Gestão de nós do canvas (padrão Structura): separa estrutura (parsed) de layout
// (posições, propriedade do React Flow). Evita o snap-back ao arrastar.
import { useEffect, useMemo, useRef } from 'react';
import type { Node } from 'reactflow';
import type { ColumnView, ParseResult, TableView } from '../../dsl/parse';
import type { ExternalLinkBadge, TableMeta, TableNodeData } from '../actions';
import type { ExternalGroupStub } from '../pageFilter';
import { nodeHeight, nodeWidth } from '../nodeMetrics';
export type Positions = Record<string, { x: number; y: number }>;

export type NodeExtra = {
  headerColor: string;
  meta: TableMeta;
  externalLinks?: ExternalLinkBadge[];
  /** Colunas com FK/L2 — usado para scroll inicial e alinhar handles. */
  linkedColumns?: string[];
};
export type NodeExtras = Map<string, NodeExtra>;

const FALLBACK_META: TableMeta = {
  sources: [], sample: null, pks: [], fks: [], refsIn: [], columnNotes: [], has: false,
};
const FALLBACK_EXTRA: NodeExtra = { headerColor: '#13284b', meta: FALLBACK_META };

export type NodeOpts = {
  collapsedGroups: Set<string>;
  hiddenTables: Set<string>; // escondidas (camada oculta ou grupo colapsado)
  dimmedTables: Set<string>; // esmaecidas (camada em modo esmaecer)
  groupColors: Record<string, string>; // cor por TableGroup (nome -> hex)
  onToggleGroup: (name: string) => void;
};

const SEP1 = '\u0001';
const SEP2 = '\u0002';
const SEP3 = '\u0003';
const SEP4 = '\u0004';

function colSig(c: ColumnView): string {
  return [c.name, c.type, c.pk ? '1' : '0', c.notNull ? '1' : '0', c.note ?? '', c.color ?? ''].join(SEP1);
}

function metaSig(m: TableMeta): string {
  return [
    m.sources.join(','),
    m.pks.join(','),
    m.fks.map((f) => `${f.column}>${f.ref}`).join(','),
    m.refsIn.join(','),
    m.sample ? `${m.sample.columns.length}x${m.sample.rows.length}` : '0',
    m.columnNotes.map((n) => `${n.column}=${n.note}`).join(','),
    m.note ?? '',
    m.resourceType ?? '',
    m.materialization ?? '',
    (m.tags ?? []).join(','),
  ].join(SEP2);
}

/** Assinatura de conteúdo da tabela: muda só quando algo visível ao render muda. */
function tableDataSig(t: TableView, extra: NodeExtra): string {
  return [
    t.name,
    t.schema ?? '',
    t.note ?? '',
    t.group ?? '',
    (t.compositePks ?? []).map((g) => g.join('+')).join('|'),
    extra.headerColor,
    t.columns.map(colSig).join(SEP3),
    metaSig(extra.meta),
    (extra.externalLinks ?? []).map((l) => `${l.direction}:${l.stubId}:${l.count}`).join(','),
    (extra.linkedColumns ?? []).join(','),
  ].join(SEP4);
}

function gridPosition(index: number): { x: number; y: number } {
  const COLS = 3;
  return { x: (index % COLS) * 320 + 40, y: Math.floor(index / COLS) * 280 + 40 };
}

/** Caixas dos TableGroups (arrastáveis); compactas quando colapsadas. */
function groupNodes(
  tables: TableView[],
  posOf: (t: TableView, i: number) => { x: number; y: number },
  opts: NodeOpts,
  compact: boolean,
): Node[] {
  const metrics = { compact };
  const byGroup = new Map<string, { x: number; y: number; w: number; h: number }[]>();
  tables.forEach((t, i) => {
    if (!t.group) return;
    const p = posOf(t, i);
    byGroup.set(t.group, [
      ...(byGroup.get(t.group) ?? []),
      { x: p.x, y: p.y, w: nodeWidth(t, metrics), h: nodeHeight(t, metrics) },
    ]);
  });

  const pad = 24;
  const out: Node[] = [];
  for (const [name, boxes] of byGroup) {
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const collapsed = opts.collapsedGroups.has(name);
    out.push({
      id: `group:${name}`,
      type: 'group',
      position: { x: minX - pad, y: minY - pad - 16 },
      data: { label: name, collapsed, count: boxes.length, color: opts.groupColors[name], onToggle: () => opts.onToggleGroup(name) },
      draggable: true,
      dragHandle: '.group-node__drag-handle',
      selectable: false,
      className: 'react-flow__node-group-shell',
      zIndex: -1,
      style: collapsed
        ? { width: 240, height: 46 }
        : { width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 + 16 },
    });
  }
  return out;
}

export function useCanvasNodes(
  parsed: ParseResult,
  positions: Positions,
  setNodes: (updater: (prev: Node[]) => Node[]) => void,
  opts: NodeOpts,
  nodeExtras: NodeExtras,
  externalStubs: ExternalGroupStub[] = [],
  selectedTableIds: string[] = [],
  sizes: Record<string, number> = {},
): void {
  // Cache de `data` por id: preserva a identidade do objeto enquanto a assinatura de
  // conteúdo não muda, permitindo que `React.memo(TableNode)` pule re-renders das
  // tabelas não editadas (ganho decisivo para tabelas/diagramas grandes).
  const dataCache = useRef(new Map<string, { sig: string; data: TableNodeData }>());

  useEffect(() => {
    setNodes((prev) => {
      const prevPos = new Map(
        prev.filter((n) => n.type === 'table').map((n) => [n.id, n.position] as const),
      );
      // `selected` vem do store (fonte única). Sem isso, o rebuild perde a seleção e o
      // React Flow dispara onSelectionChange([]) logo após o clique (bug #7).
      const selectedSet = new Set(selectedTableIds);
      const posOf = (t: TableView, i: number) =>
        positions[t.id] ?? prevPos.get(t.id) ?? gridPosition(i);

      const cache = dataCache.current;
      const seen = new Set<string>();
      const tableNodes: Node[] = parsed.tables.map((t, i) => {
        const extra = nodeExtras.get(t.id) ?? FALLBACK_EXTRA;
        const sig = tableDataSig(t, extra);
        seen.add(t.id);
        let entry = cache.get(t.id);
        if (!entry || entry.sig !== sig) {
          entry = {
            sig,
            data: {
              ...t,
              headerColor: extra.headerColor,
              meta: extra.meta,
              ...(extra.externalLinks?.length ? { externalLinks: extra.externalLinks } : {}),
              ...(extra.linkedColumns?.length ? { linkedColumns: extra.linkedColumns } : {}),
            },
          };
          cache.set(t.id, entry);
        }
        return {
          id: t.id,
          type: 'table',
          position: posOf(t, i),
          data: entry.data,
          selected: selectedSet.has(t.id),
          deletable: true,
          hidden: opts.hiddenTables.has(t.id),
          style: {
            ...(opts.dimmedTables.has(t.id) ? { opacity: 0.35 } : {}),
            ...(sizes[t.id] ? { width: sizes[t.id] } : {}),
          },
        };
      });
      for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
      const stubNodes: Node[] = externalStubs.map((stub) => ({
        id: stub.id,
        type: 'externalGroup',
        position: positions[stub.id] ?? { x: 520, y: 80 },
        data: { label: stub.label, tableCount: stub.tableCount, linkCount: stub.linkCount },
        draggable: true,
        selectable: false,
        zIndex: 1,
      }));
      return [...groupNodes(parsed.tables, posOf, opts, false), ...stubNodes, ...tableNodes];
    });
  }, [parsed.tables, positions, setNodes, opts, nodeExtras, externalStubs, selectedTableIds, sizes]);
}
