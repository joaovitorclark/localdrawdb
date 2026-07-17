import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background, Controls, MiniMap, Panel, ConnectionMode, SelectionMode, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type OnSelectionChangeParams,
} from 'reactflow';
import { getNodesBounds, getViewportForBounds } from 'reactflow';
import 'reactflow/dist/style.css';
import { TableNode } from './TableNode';
import { RelationEdge } from './RelationEdge';
import { LineageEdge } from './LineageEdge';
import { FieldLineageEdge } from './FieldLineageEdge';
import { EdgeMarkers } from './EdgeMarkers';
import { GroupNode } from './GroupNode';
import { ExternalGroupNode } from './ExternalGroupNode';
import {
  aggregateCrossLinks,
  type CrossPageRef,
  type ExternalGroupStub,
} from './pageFilter';
import { useCanvasEdges } from './hooks/useCanvasEdges';
import { useCanvasNodes, type NodeExtras, type NodeOpts, type Positions } from './hooks/useCanvasNodes';
import { useInteraction } from '../store/interaction';
import type { ParseResult, ParsedFieldLineage } from '../dsl/parse';
import type { LineageLink, TableSize } from '../api';
import { DEFAULT_LINEAGE_SOURCE, DEFAULT_LINEAGE_TARGET, isLineageHandle, pickLineageHandles } from './lineageHandles';
import { diagramOverviewBounds, focusFieldMappingInView, focusTableInView } from './focusTableView';
import { SelectionBar } from './SelectionBar';
import { MINIMAP_MAX_TABLES, SKIP_INITIAL_FIT_TABLES } from './scaleLimits';

const isMacOs = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);

/**
 * Regras CSS por id relacionado — evita `setNodes` em hover/seleção (Fase 2 perf).
 * Diferencia a seleção pra não parecer sobreposta: a tabela em foco tem contorno forte
 * (sólido = selecionada; tracejado = tabela da coluna selecionada, #7b); os vizinhos
 * relacionados (FK/linhagem) só ficam sem esmaecer, com um contorno fino secundário.
 */
function CanvasFocusStyles({
  focus,
  related,
  columnFocus,
}: {
  focus: Set<string>;
  related: Set<string> | null;
  columnFocus: boolean;
}) {
  const css = useMemo(() => {
    if (!related?.size) return '';
    const rules: string[] = [];
    for (const id of related) {
      const esc = CSS.escape(id);
      rules.push(`.canvas-wrap--focus .react-flow__node[data-id="${esc}"] { opacity: 1; }`);
      if (!focus.has(id)) {
        // Vizinho relacionado: contorno fino, secundário — não parece "selecionado".
        rules.push(
          `.canvas-wrap--focus .react-flow__node[data-id="${esc}"] .table-node {`,
          '  outline: 1px solid var(--brand-green);',
          '  outline-offset: 1px;',
          '}',
        );
      }
    }
    for (const id of focus) {
      const esc = CSS.escape(id);
      rules.push(
        `.canvas-wrap--focus .react-flow__node[data-id="${esc}"] .table-node {`,
        `  outline: 2px ${columnFocus ? 'dashed' : 'solid'} var(--brand-green);`,
        '  outline-offset: 1px;',
        '}',
      );
    }
    return rules.join('\n');
  }, [focus, related, columnFocus]);
  if (!css) return null;
  return <style data-canvas-focus="">{css}</style>;
}

const stripHandle = (h: string | null | undefined) => (h ? h.replace(/^[st]:/, '') : '');
const nodeTypes = { table: TableNode, group: GroupNode, externalGroup: ExternalGroupNode };
const edgeTypes = { relation: RelationEdge, lineage: LineageEdge, fieldLineage: FieldLineageEdge };

export type RefEndpoints = { fromTbl: string; fromCol: string; toTbl: string; toCol: string };

type Props = {
  parsed: ParseResult;
  /** Cor de cabeçalho + metadados pré-computados por tabela (memoização dos nós). */
  nodeExtras: NodeExtras;
  positions: Positions;
  sizes: Record<string, TableSize>;
  onPositionsChange: (p: Positions) => void;
  onCreateRef: (a: string, ac: string, b: string, bc: string) => void;
  onRemoveRef: (a: string, ac: string, b: string, bc: string) => void;
  onRemoveTable: (tableId: string) => void;
  onRemoveTables?: (tableIds: string[]) => void;
  staleWarning?: boolean;
  lineage: LineageLink[];
  lineageFields: ParsedFieldLineage[];
  onCreateLineage: (source: string, target: string) => void;
  onRemoveLineage: (source: string, target: string) => void;
  onRemoveFieldLineage: (
    sourceTable: string, sourceColumn: string, targetTable: string, targetColumn: string,
  ) => void;
  onCreateFieldLineage: (
    sourceTable: string, sourceColumn: string, targetTable: string, targetColumn: string,
  ) => void;
  layerOf: (tableId: string) => string | undefined;
  collapsedGroups: string[];
  onToggleGroup: (name: string) => void;
  focusTableId?: string | null;
  /** Incrementa para repetir foco na mesma tabela (ex.: posição recém-atribuída). */
  focusNonce?: number;
  onFocusTableDone?: () => void;
  /** Clique numa tabela (não em coluna) → rola editor DBML + seleciona. */
  onTableClick?: (tableId: string) => void;
  /** Incrementa após Organizar canvas para dar fitView. */
  fitViewTrigger?: number;
  /** Grupos fora da página (stub colapsado). */
  externalStubs?: ExternalGroupStub[];
  /** FKs que cruzam a fronteira da página ativa. */
  crossRefs?: CrossPageRef[];
};

function fitDiagram(
  getNodes: () => Node[],
  fitBounds: ReturnType<typeof useReactFlow>['fitBounds'],
  duration = 0,
) {
  const bounds = diagramOverviewBounds(getNodes());
  if (!bounds) return false;
  fitBounds(bounds, { padding: 0.14, duration });
  return true;
}

function AutolayoutFitHelper({ trigger }: { trigger?: number }) {
  const { fitBounds, getNodes } = useReactFlow();
  useEffect(() => {
    if (!trigger) return;
    fitDiagram(getNodes, fitBounds, 200);
  }, [trigger, fitBounds, getNodes]);
  return null;
}

function InitialFitHelper({ tableCount }: { tableCount: number }) {
  const { fitBounds, getNodes } = useReactFlow();
  const done = useRef(false);
  const enabled = tableCount > 0 && tableCount <= SKIP_INITIAL_FIT_TABLES;
  useEffect(() => {
    if (!enabled || done.current || tableCount === 0) return;
    let cancelled = false;
    const tryFit = (attempt = 0) => {
      if (cancelled || done.current) return;
      if (fitDiagram(getNodes, fitBounds, 0)) {
        done.current = true;
        return;
      }
      if (attempt < 40) requestAnimationFrame(() => tryFit(attempt + 1));
    };
    requestAnimationFrame(() => tryFit());
    return () => {
      cancelled = true;
    };
  }, [tableCount, fitBounds, getNodes, enabled]);
  return null;
}

function FocusTableHelper({
  tableId,
  focusNonce,
  onDone,
}: {
  tableId: string | null | undefined;
  focusNonce?: number;
  onDone?: () => void;
}) {
  const { setCenter, getNode } = useReactFlow();
  useEffect(() => {
    if (!tableId) return;
    let cancelled = false;
    const tryFocus = (attempt = 0) => {
      if (cancelled) return;
      if (focusTableInView(getNode, setCenter, tableId)) {
        onDone?.();
        return;
      }
      if (attempt < 40) requestAnimationFrame(() => tryFocus(attempt + 1));
      else onDone?.();
    };
    requestAnimationFrame(() => tryFocus());
    return () => {
      cancelled = true;
    };
  }, [tableId, focusNonce, setCenter, getNode, onDone]);
  return null;
}

function FocusFieldMappingHelper() {
  const focused = useInteraction((s) => s.focusedFieldMapping);
  const nonce = useInteraction((s) => s.fieldMappingFocusNonce);
  const { fitBounds, getNode } = useReactFlow();
  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    const tryFocus = (attempt = 0) => {
      if (cancelled) return;
      if (focusFieldMappingInView(getNode, fitBounds, focused.sourceTable, focused.targetTable)) return;
      if (attempt < 40) requestAnimationFrame(() => tryFocus(attempt + 1));
    };
    requestAnimationFrame(() => tryFocus());
    return () => {
      cancelled = true;
    };
  }, [focused, nonce, fitBounds, getNode]);
  return null;
}

/**
 * Bridge para o export PNG. Vive DENTRO do <ReactFlowProvider> para ter
 * acesso ao `useReactFlow`. Recebe pedidos via window event; usa
 * `setViewport` para enquadrar os nós-alvo, espera 2 frames, captura com
 * `toPng`, e restaura a viewport.
 *
 * Por que setViewport + toPng (em vez de aplicar CSS transform):
 * O `.react-flow__viewport` já tem o transform de pan/zoom do ReactFlow.
 * Aplicar uma transform CSS adicional destrói o layout (conteúdo colapsa
 * num canto — bug que o usuário viu no PNG). A solução oficial do React
 * Flow é reposicionar a viewport via API, deixar o React Flow re-renderizar
 * com o novo transform, e capturar.
 */
function PngExportBridge() {
  const rf = useReactFlow();
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { scope?: 'full' | 'selection' } | undefined;
      const scope = detail?.scope ?? 'full';
      const finish = (dataUrl?: string, error?: Error) => {
        window.dispatchEvent(new CustomEvent('ldb:pngResult', {
          detail: error ? { error: error.message } : { dataUrl },
        }));
      };
      try {
        const all = rf.getNodes();
        const targetNodes = scope === 'selection'
          ? all.filter((n) => n.selected)
          : all;
        if (!targetNodes.length) {
          finish(undefined, new Error('Nenhuma tabela para exportar'));
          return;
        }
        const before = rf.getViewport();
        const { toPng } = await import('html-to-image');
        const bounds = getNodesBounds(targetNodes);
        const padding = 48;
        const width = bounds.width + padding * 2;
        const height = bounds.height + padding * 2;
        const vp = getViewportForBounds(bounds, width, height, 0.5, 2, padding);
        rf.setViewport(vp, { duration: 0 });
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
        if (!viewport) {
          rf.setViewport(before, { duration: 0 });
          finish(undefined, new Error('Canvas não encontrado'));
          return;
        }
        const dataUrl = await toPng(viewport, {
          backgroundColor: '#ffffff',
          pixelRatio: 2,
          width,
          height,
          cacheBust: true,
        });
        rf.setViewport(before, { duration: 0 });
        finish(dataUrl);
      } catch (e) {
        finish(undefined, e instanceof Error ? e : new Error(String(e)));
      }
    };
    window.addEventListener('ldb:requestPng', handler);
    return () => window.removeEventListener('ldb:requestPng', handler);
  }, [rf]);
  return null;
}

export function Canvas(props: Props) {
  const { parsed, nodeExtras, positions, sizes, onPositionsChange, onCreateRef, onRemoveRef, onRemoveTable, onRemoveTables,
    staleWarning, lineage, lineageFields, onCreateLineage, onRemoveLineage, onRemoveFieldLineage, onCreateFieldLineage,
    layerOf, collapsedGroups, onToggleGroup, focusTableId, focusNonce, onFocusTableDone, onTableClick, fitViewTrigger,
    externalStubs = [], crossRefs = [] } = props;
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const hovered = useInteraction((s) => s.hoveredTableId);
  const selectedTableIds = useInteraction((s) => s.selectedTableIds);
  const setSelectedTableIds = useInteraction((s) => s.setSelectedTableIds);
  const clearCanvasSelection = useInteraction((s) => s.clearCanvasSelection);
  const fieldLineageVisible = useInteraction((s) => s.fieldLineageVisible);
  const focusedFieldMapping = useInteraction((s) => s.focusedFieldMapping);
  const selectFieldLineageMapping = useInteraction((s) => s.selectFieldLineageMapping);
  const setFocusedFieldMapping = useInteraction((s) => s.setFocusedFieldMapping);
  const setHovered = useInteraction((s) => s.setHovered);
  const selectColumn = useInteraction((s) => s.selectColumn);
  const selectedColumn = useInteraction((s) => s.selectedColumn);
  const selectGroup = useInteraction((s) => s.selectGroup);
  const hiddenLayers = useInteraction((s) => s.hiddenLayers);
  const layerDimMode = useInteraction((s) => s.layerDimMode);
  const lineageMode = useInteraction((s) => s.lineageMode);
  const lineageVisible = useInteraction((s) => s.lineageVisible);
  const relationsVisible = useInteraction((s) => s.relationsVisible);
  const selectedTable = useInteraction((s) => s.selectedTable);
  /** L1 no canvas: só o toggle "Mostrar linhagem" (modo linhagem ≠ mostrar arestas). */
  const showLineageEdges = lineageVisible;
  const [connecting, setConnecting] = useState(false);

  // Esc desseleciona coluna e seleção do canvas (fora de inputs — o editor de nome
  // de coluna trata o próprio Escape). Complementa o onPaneClick, que não mexe na coluna.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      selectColumn(null);
      clearCanvasSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectColumn, clearCanvasSelection]);

  const focusTables = useMemo(() => {
    if (selectedTableIds.length) return selectedTableIds;
    if (selectedColumn) return [selectedColumn.table];
    if (focusedFieldMapping) {
      return focusedFieldMapping.sourceTable === focusedFieldMapping.targetTable
        ? [focusedFieldMapping.sourceTable]
        : [focusedFieldMapping.sourceTable, focusedFieldMapping.targetTable];
    }
    if (fieldLineageVisible && selectedTable) return [selectedTable];
    if (hovered) return [hovered];
    return [];
  }, [selectedTableIds, selectedColumn, focusedFieldMapping, fieldLineageVisible, selectedTable, hovered]);

  const focusSet = useMemo(() => new Set(focusTables), [focusTables]);

  const aggregatedCrossLinks = useMemo(
    () => aggregateCrossLinks(crossRefs, externalStubs),
    [crossRefs, externalStubs],
  );

  const related = useMemo(() => {
    if (!focusTables.length) return null;
    const set = new Set<string>(focusTables);
    for (const ft of focusTables) {
      if (!lineageMode) {
        for (const r of parsed.refs) {
          if (r.source === ft) set.add(r.target);
          if (r.target === ft) set.add(r.source);
        }
      }
      if (lineageVisible) {
        for (const l of lineage) {
          if (l.source === ft) set.add(l.target);
          if (l.target === ft) set.add(l.source);
        }
      }
      if (fieldLineageVisible) {
        for (const m of lineageFields) {
          if (m.targetTable === ft || m.sourceTable === ft) {
            set.add(m.targetTable);
            set.add(m.sourceTable);
          }
        }
      }
      for (const link of aggregatedCrossLinks) {
        if (link.visibleTable === ft) set.add(link.stubId);
      }
    }
    return set;
  }, [focusTables, parsed.refs, lineage, lineageFields, lineageMode, lineageVisible, fieldLineageVisible, crossRefs, aggregatedCrossLinks]);


  // Visibilidade por camada + colapso → hidden/dim.
  const opts = useMemo<NodeOpts>(() => {
    const collapsed = new Set(collapsedGroups);
    const hidden = new Set<string>();
    const dimmed = new Set<string>();
    for (const t of parsed.tables) {
      const groupHidden = t.group ? collapsed.has(t.group) : false;
      const layer = layerOf(t.id);
      const layerOff = !!layer && hiddenLayers.has(layer);
      if (groupHidden || (layerOff && !layerDimMode)) hidden.add(t.id);
      else if (layerOff && layerDimMode) dimmed.add(t.id);
    }
    const groupColors: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.colors)) if (k.startsWith('@')) groupColors[k.slice(1)] = v;
    return { collapsedGroups: collapsed, hiddenTables: hidden, dimmedTables: dimmed, groupColors, onToggleGroup };
  }, [parsed.tables, parsed.colors, collapsedGroups, hiddenLayers, layerDimMode, layerOf, onToggleGroup]);

  useCanvasNodes(parsed, positions, setNodes, opts, nodeExtras, externalStubs, selectedTableIds, sizes);

  useCanvasEdges(setEdges, {
    parsed,
    aggregatedCrossLinks,
    lineage,
    lineageFields,
    positions,
    relationsVisible,
    showLineageEdges,
    fieldLineageVisible,
    lineageMode,
    focusTables,
    focusedFieldMapping,
    selectedColumn,
    onRemoveRef,
    onRemoveLineage,
    onRemoveFieldLineage,
  });

  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
      const ids = selNodes.filter((n) => n.type === 'table').map((n) => n.id);
      // Só sincroniza se a seleção do ReactFlow realmente divergiu do estado interno.
      // Caso contrário, é só reflexo de useCanvasNodes ter aplicado `selected: true`
      // baseado em selectedTableIds (ex.: focar uma coluna via command palette, ou
      // clicar numa coluna que também seleciona sua tabela). Sem esse guarda,
      // `selectColumn(null)` apaga a coluna destacada que o usuário acabou de escolher.
      const prev = useInteraction.getState().selectedTableIds;
      const sameAsState =
        ids.length === prev.length && ids.every((id, idx) => id === prev[idx]);
      setSelectedTableIds(ids);
      if (ids.length && !sameAsState) selectColumn(null);

      if (!lineageMode) return;

      const fieldEdge = selEdges.find((e) => e.type === 'fieldLineage');
      const mapping = (fieldEdge?.data as { mapping?: typeof focusedFieldMapping })?.mapping;
      if (fieldEdge?.selected && mapping) {
        selectFieldLineageMapping(mapping);
        return;
      }
      if (ids.length === 1 && !fieldEdge?.selected) {
        setFocusedFieldMapping(null);
      }
    },
    [lineageMode, setSelectedTableIds, selectColumn, selectFieldLineageMapping, setFocusedFieldMapping, useInteraction],
  );

  const isValidConnection = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      if (lineageMode) {
        const portToPort = isLineageHandle(c.sourceHandle) && isLineageHandle(c.targetHandle);
        const fieldToField = !!c.sourceHandle?.startsWith('fl:s:') && !!c.targetHandle?.startsWith('fl:t:');
        return portToPort || fieldToField;
      }
      return !!c.sourceHandle?.startsWith('s:') && !!c.targetHandle?.startsWith('t:');
    },
    [lineageMode],
  );

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target) return;
    if (lineageMode) {
      // Puxar entre handles de coluna (fl:) cria mapeamento campo→campo.
      if (c.sourceHandle?.startsWith('fl:s:') && c.targetHandle?.startsWith('fl:t:')) {
        onCreateFieldLineage(c.source, c.sourceHandle.slice(5), c.target, c.targetHandle.slice(5));
        return;
      }
      onCreateLineage(c.source, c.target);
      const id = `lin:${c.source}->${c.target}`;
      const sourceHandle =
        c.sourceHandle && isLineageHandle(c.sourceHandle)
          ? c.sourceHandle
          : (() => {
              const sp = positions[c.source];
              const tp = positions[c.target];
              const srcTable = parsed.tables.find((t) => t.id === c.source);
              const tgtTable = parsed.tables.find((t) => t.id === c.target);
              return sp && tp
                ? pickLineageHandles(sp, tp, srcTable, tgtTable).sourceHandle
                : DEFAULT_LINEAGE_SOURCE;
            })();
      const targetHandle =
        c.targetHandle && isLineageHandle(c.targetHandle)
          ? c.targetHandle
          : (() => {
              const sp = positions[c.source];
              const tp = positions[c.target];
              const srcTable = parsed.tables.find((t) => t.id === c.source);
              const tgtTable = parsed.tables.find((t) => t.id === c.target);
              return sp && tp
                ? pickLineageHandles(sp, tp, srcTable, tgtTable).targetHandle
                : DEFAULT_LINEAGE_TARGET;
            })();
      setEdges((prev) => {
        const rest = prev.filter((e) => e.id !== id);
        return [
          ...rest,
          {
            id,
            source: c.source!,
            target: c.target!,
            type: 'lineage',
            sourceHandle,
            targetHandle,
            data: { onRemove: () => onRemoveLineage(c.source!, c.target!) },
          },
        ];
      });
      return;
    }
    onCreateRef(c.source, stripHandle(c.sourceHandle), c.target, stripHandle(c.targetHandle));
  }, [lineageMode, onCreateLineage, onCreateFieldLineage, onCreateRef, onRemoveLineage, parsed.tables, positions, setEdges]);

  // Mover grupo inteiro: aplica o delta às tabelas-membro.
  const groupDrag = useRef<{ name: string; last: { x: number; y: number } } | null>(null);
  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    if (node.type === 'group') groupDrag.current = { name: node.id.slice(6), last: node.position };
  }, []);
  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    if (node.type !== 'group' || !groupDrag.current) return;
    const dx = node.position.x - groupDrag.current.last.x;
    const dy = node.position.y - groupDrag.current.last.y;
    if (dx === 0 && dy === 0) return;
    const name = groupDrag.current.name;
    setNodes((nds) => nds.map((n) =>
      n.type === 'table' && (n.data as any).group === name
        ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
        : n));
    groupDrag.current.last = node.position;
  }, [setNodes]);
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    if (node.type === 'group') {
      const name = node.id.slice(6);
      const updated = { ...positions };
      for (const n of nodes) if (n.type === 'table' && (n.data as any).group === name) updated[n.id] = n.position;
      onPositionsChange(updated);
      groupDrag.current = null;
      return;
    }
    if (node.type !== 'table' && node.type !== 'externalGroup') return;
    const selectedIds = new Set(nodes.filter((n) => n.selected && n.type === 'table').map((n) => n.id));
    if (selectedIds.size > 1) {
      const updated = { ...positions };
      for (const n of nodes) {
        if (n.type === 'table' && selectedIds.has(n.id)) updated[n.id] = n.position;
      }
      onPositionsChange(updated);
    } else {
      onPositionsChange({ ...positions, [node.id]: node.position });
    }
  }, [nodes, positions, onPositionsChange]);

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const tableIds = deleted.filter((n) => n.type === 'table').map((n) => n.id);
      if (!tableIds.length) return;
      if (tableIds.length === 1) onRemoveTable(tableIds[0]);
      else onRemoveTables?.(tableIds);
    },
    [onRemoveTable, onRemoveTables],
  );

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    for (const e of deleted) {
      if (e.type === 'lineage') onRemoveLineage(e.source, e.target);
      else if (e.type === 'fieldLineage') (e.data as { onRemove?: () => void })?.onRemove?.();
      else {
        const ep = e.data?.endpoints as RefEndpoints | undefined;
        if (ep) onRemoveRef(ep.fromTbl, ep.fromCol, ep.toTbl, ep.toCol);
      }
    }
  }, [onRemoveLineage, onRemoveRef]);

  const onEdgeUpdate = useCallback((oldEdge: Edge, c: Connection) => {
    if (lineageMode || oldEdge.type !== 'relation') return;
    const ep = oldEdge.data?.endpoints as RefEndpoints | undefined;
    if (!ep || !c.source || !c.target) return;
    const fromCol = stripHandle(c.sourceHandle); const toCol = stripHandle(c.targetHandle);
    if (!fromCol || !toCol) return;
    onRemoveRef(ep.fromTbl, ep.fromCol, ep.toTbl, ep.toCol);
    onCreateRef(c.source, fromCol, c.target, toCol);
  }, [lineageMode, onRemoveRef, onCreateRef]);

  const tableCount = parsed.tables.length;
  // Minimap sempre presente. Em modelos muito grandes (>MINIMAP_MAX_TABLES)
  // renderiza um modo lite (sem cor por nó) por custo de pintura.
  const miniMapLite = tableCount > MINIMAP_MAX_TABLES;
  const showMiniMap = true;

  return (
    <div className={`canvas-wrap${related?.size ? ' canvas-wrap--focus' : ''}`}>
      <CanvasFocusStyles focus={focusSet} related={related} columnFocus={!!selectedColumn} />
      {staleWarning && (
        <div className="canvas-stale-banner" role="status">
          Canvas mostra último modelo válido — corrija o DBML no editor
        </div>
      )}
      <SelectionBar onRemoveTables={onRemoveTables} />
      <EdgeMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodesDelete={onNodesDelete}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectStart={lineageMode ? () => setConnecting(true) : undefined}
        onConnectEnd={() => setConnecting(false)}
        isValidConnection={isValidConnection}
        connectionMode={lineageMode ? ConnectionMode.Loose : ConnectionMode.Strict}
        connectionRadius={lineageMode ? 56 : 24}
        nodesConnectable
        connectOnClick={false}
        edgesUpdatable={!lineageMode}
        className={
          lineageMode
            ? `canvas--lineage-mode${connecting ? ' canvas--lineage-connecting' : ''}`
            : undefined
        }
        onEdgesDelete={onEdgesDelete}
        onEdgeUpdate={onEdgeUpdate}
        deleteKeyCode={['Delete', 'Backspace']}
        onNodeMouseEnter={(_, n) => { if (n.type === 'table') setHovered(n.id); }}
        onNodeMouseLeave={() => setHovered(null)}
        onNodeClick={(_, n) => {
          if (n.type === 'group') selectGroup(n.id.replace(/^group:/, ''));
          else if (n.type === 'table') onTableClick?.(n.id);
        }}
        // Clique/arrasto no pane NÃO desseleciona a coluna: o usuário pode arrastar o
        // canvas para seguir uma ligação. A coluna sai com Esc, outra coluna ou outra seleção.
        onPaneClick={() => { clearCanvasSelection(); }}
        onSelectionChange={onSelectionChange}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={isMacOs() ? 'Meta' : 'Control'}
        elementsSelectable
        edgesFocusable
        // Tolerância de jitter do mouse (Windows): até 4px de movimento ainda é clique
        // de coluna, não drag do nó — sem isso o onClick da coluna nunca dispara.
        nodeDragThreshold={4}
        minZoom={0.25}
        onlyRenderVisibleElements
      >
        <InitialFitHelper tableCount={tableCount} />
        <AutolayoutFitHelper trigger={fitViewTrigger} />
        <FocusTableHelper tableId={focusTableId} focusNonce={focusNonce} onDone={onFocusTableDone} />
        <FocusFieldMappingHelper />
        <PngExportBridge />
        <Background />
        <Controls />
        {showMiniMap ? (
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={0}
            nodeColor={
              miniMapLite
                ? () => '#13284b'
                : (n) =>
                    n.type === 'group'
                      ? 'transparent'
                      : ((n.data as { headerColor?: string })?.headerColor ?? '#13284b')
            }
          />
        ) : null}
      </ReactFlow>
    </div>
  );
}
