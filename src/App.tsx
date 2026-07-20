import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useDeferredValue, startTransition, type MouseEvent as ReactMouseEvent } from 'react';
import type { EditorHandle } from './editor/Editor';
import { Canvas } from './canvas/Canvas';
import { METADATA_SNIPPET, newTableTemplate, parseDbml, findDuplicateTableId, findDuplicateColumnName, type ParseResult } from './dsl/parse';
import { validateModel } from './dsl/validateModel';
import { splitDbmlBlocks } from './dsl/blocks';
import { organize } from './dsl/organize';
import { autolayoutLineagePositions, autolayoutPositions } from './canvas/autolayout';
import { defaultTablePosition } from './canvas/defaultTablePosition';
import { ProblemsPanel } from './canvas/ProblemsPanel';
import { StatusLog, type StatusLogEntry } from './canvas/StatusLog';
import {
  appendRef, removeRef, removeTable, renameColumnAllRefs, renameTable, addColumn, setTableLayer, addLayerGroup,
  addLineageEntry, removeLineageEntry, addFieldLineageEntry, removeFieldLineageEntry, updateFieldLineageEntry,
} from './dsl/edit';
import { RecordsPanel } from './records/RecordsPanel';
import { ColumnPanel } from './canvas/ColumnPanel';
import { CanvasActionsCtx, type CanvasActions, type TableMeta } from './canvas/actions';
import { LayersPanel } from './canvas/LayersPanel';
import { CanvasLeftDock } from './canvas/CanvasLeftDock';
import { PageImportWizard } from './canvas/PageImportWizard';
import { allTablesPage, aggregateCrossLinks, buildCanvasViewModel, defaultExternalStubPosition, isExternalStubNodeId, layoutExternalStubsOnTop, pagesFromTableGroups, stubsWithLinkCounts } from './canvas/pageFilter';
import type { ExternalLinkBadge } from './canvas/actions';
import {
  ALL_PAGE_ID,
  LARGE_DIAGRAM_HINT,
  PAGE_WIZARD_THRESHOLD,
} from './canvas/scaleLimits';
import { layersFromGroups, tableLayerMap, layerColorOf } from './layers';
import { useInteraction } from './store/interaction';
import { analyzeRenames } from './dsl/reconcile';
import type { RenameImpact } from './dsl/reconcile';
import { isCompleteTableId, setTableColor, setGroupColor } from './dsl/edit';
import { classifyChildFks } from './dsl/rolename';
import { propagateKeyRename, keepSeparateKeyRename } from './dsl/propagateKeyRename';
import { RenameConfirmModal } from './editor/RenameConfirmModal';
import { resolveTableId, tableAtLine, lineOfTable, lineOfColumn } from './dsl/lineLocate';
import {
  shouldPanToTable,
  shouldSyncCursorLine,
  shouldSyncEditorTable,
  type FocusTableOptions,
} from './editor/syncEditorCanvas';
import { ExportMenu } from './ExportMenu';
import { DbmlDiff } from './components/DbmlDiff';
import { ProjectSwitcher } from './ProjectSwitcher';
import { Undo, Redo, Search } from './icons';
import { Tooltip } from './Tooltip';
import { pinnedCreatedMessage } from './projectMessages';
import { exportInputL2Warning } from './exportWarnings';
import { CommandPalette } from './palette/CommandPalette';
import { buildCommands, type CommandAction } from './palette/registry';
import { ShortcutsOverlay } from './help/ShortcutsOverlay';
import { CANVAS_GESTURES, shortcutsFromCommands } from './help/gestures';
import * as api from './api';
import type { CanvasPage, LineageLink, ProjectMeta, TableSize } from './api';

type Positions = Record<string, { x: number; y: number }>;
type Colors = Record<string, string>;
type Snapshot = { dbml: string; positions: Positions; colors: Colors };
const Editor = lazy(async () => {
  const mod = await import('./editor/Editor');
  return { default: mod.Editor };
});

function resolveActivePageIds(
  canvas: api.CanvasState | undefined,
  tableCount: number,
): string[] {
  if (canvas?.activePageIds != null) return canvas.activePageIds;
  if (canvas?.activePageId != null) return [canvas.activePageId];
  if (tableCount > PAGE_WIZARD_THRESHOLD) return [];
  return [ALL_PAGE_ID];
}

/**
 * Mantém a mesma referência enquanto o conteúdo (por JSON) não muda. Usado para
 * estabilizar arrays derivados do parse (que geram nova identidade a cada keystroke)
 * e assim manter callbacks/contexto memoizados.
 */
function useStable<T>(value: T): T {
  const ref = useRef(value);
  const sig = JSON.stringify(value);
  const sigRef = useRef(sig);
  if (sig !== sigRef.current) {
    sigRef.current = sig;
    ref.current = value;
  }
  return ref.current;
}

function loadStoredFlag(key: string, fallback: boolean): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return fallback;
  }
}

const SAMPLE = `TableGroup vendas {
  loja.cliente
  loja.pedido
}

LayerGroup bronze [color: #b08d57] {
  loja.cliente
}

Table loja.cliente {
  id bigint [pk]
  nome string
  email string
  Note: 'Dimensão de clientes'
}

Table loja.pedido {
  id bigint [pk]
  cliente_id bigint
  total decimal(18,2)
  criado_em timestamp
}

Ref: loja.pedido.cliente_id > loja.cliente.id

Lineage {
  loja.pedido < loja.cliente
}
`;

/**
 * Aplica uma lista de impacts ao DBML e retorna o texto atualizado + contagem de refs
 * efetivamente atualizadas (apenas renames que passaram na validação de ID completo).
 * Também sincroniza a seleção de coluna no canvas após um rename de coluna (Fix A).
 *
 * @param keyColFn - função usada para renomear colunas-chave (com FKs filhas).
 *   Default: propagateKeyRename (propaga o novo nome às filhas herdadas).
 *   Passa keepSeparateKeyRename para manter filhas com nome próprio e registrar rolenames.
 */
function applyRenames(
  src: string,
  impacts: RenameImpact[],
  migrateTableId: (oldId: string, newId: string) => void,
  keyColFn: (out: string, table: string, oldCol: string, newCol: string) => string = propagateKeyRename,
): { dbml: string; appliedRefCount: number } {
  let out = src;
  let appliedRefCount = 0;
  for (const { rename, refCount } of impacts) {
    if (rename.kind === 'table') {
      if (isCompleteTableId(rename.oldId) && isCompleteTableId(rename.newId)) {
        out = renameTable(out, rename.oldId, rename.newId);
        migrateTableId(rename.oldId, rename.newId);
        appliedRefCount += refCount; // Fix B: soma só quando efetivamente aplicado
      }
    } else if (rename.kind === 'column') {
      const selCol = useInteraction.getState().selectedColumn;
      // Usa keyColFn para colunas-chave (com FKs filhas); renameColumnAllRefs para as demais
      const isKey = classifyChildFks(src, rename.table, rename.oldCol).length > 0;
      if (isKey) {
        out = keyColFn(out, rename.table, rename.oldCol, rename.newCol);
      } else {
        out = renameColumnAllRefs(out, rename.table, rename.oldCol, rename.newCol);
      }
      appliedRefCount += refCount;
      // Fix A: sincroniza selectedColumn no canvas após rename de coluna
      if (selCol?.table === rename.table && selCol?.column === rename.oldCol) {
        useInteraction.getState().selectColumn({ table: rename.table, column: rename.newCol });
      }
    }
  }
  return { dbml: out, appliedRefCount };
}

export default function App() {
  const [dbml, setDbml] = useState('');
  const [positions, setPositions] = useState<Positions>({});
  const [sizes, setSizes] = useState<Record<string, TableSize>>({});
  const [colors, setColors] = useState<Colors>({});
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [canvasPages, setCanvasPages] = useState<CanvasPage[]>([allTablesPage()]);
  const [activePageIds, setActivePageIds] = useState<string[]>([]);
  const [pageWizardOpen, setPageWizardOpen] = useState(false);
  const [pageWizardTableCount, setPageWizardTableCount] = useState(0);
  const [status, setStatus] = useState('Carregando…');
  // v15-04: histórico de status (ring buffer dos últimos 100) para o dropdown de logs.
  const [logs, setLogs] = useState<StatusLogEntry[]>([]);
  const pushStatus = useCallback((msg: string) => {
    setStatus(msg);
    if (msg) setLogs((l) => [{ ts: Date.now(), msg }, ...l].slice(0, 100));
  }, []);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [autoSave, setAutoSave] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [layersPanelCollapsed, setLayersPanelCollapsed] = useState(() => loadStoredFlag('localdrawdb.layersPanelCollapsed', false));
  const [recordsPanelOpen, setRecordsPanelOpen] = useState(true);
  const [problemsPanelOpen, setProblemsPanelOpen] = useState(false);
  const [focusTableId, setFocusTableId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [editorWidth, setEditorWidth] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem('ldb.editorWidth'));
    return saved > 0 ? saved : null; // null = usa o default do CSS (40%)
  });
  const [resizingEditor, setResizingEditor] = useState(false);
  const panesRef = useRef<HTMLElement>(null);
  const startEditorResize = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const panes = panesRef.current;
    if (!panes) return;
    const rect = panes.getBoundingClientRect();
    setResizingEditor(true);
    const onMove = (ev: globalThis.MouseEvent) => {
      const w = Math.max(240, Math.min(ev.clientX - rect.left, rect.width - 320));
      setEditorWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setResizingEditor(false);
      setEditorWidth((w) => {
        if (w) localStorage.setItem('ldb.editorWidth', String(Math.round(w)));
        return w;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);
  const [fitViewTrigger, setFitViewTrigger] = useState(0);
  // Estado multi-projetos (F2)
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState('');
  const [pinnedProjectId, setPinnedProjectId] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<{
    impacts: RenameImpact[];
    buffer: string;
    committed: string;
  } | null>(null);
  const loadedRef = useRef(false);
  const prevDbmlRef = useRef('');
  const dbmlRef = useRef('');
  const editorRef = useRef<EditorHandle>(null);
  const renameTimer = useRef<ReturnType<typeof setTimeout>>();
  const selectColumn = useInteraction((s) => s.selectColumn);

  // Histórico global (undo/redo) de snapshots {dbml, positions, colors}.
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const baselineRef = useRef<Snapshot | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    try {
      localStorage.setItem('localdrawdb.layersPanelCollapsed', layersPanelCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [layersPanelCollapsed]);

  // Carrega a lista de projetos e o projeto ativo na montagem (F2).
  useEffect(() => {
    api
      .listProjects()
      .then(async ({ activeId, projects: list }) => {
        setProjects(list);
        setCurrentProjectId(activeId);
        const p = await api.loadProjectById(activeId);
        const dbml0 = p.dbml || SAMPLE;
        const pos0 = p.canvas?.positions ?? {};
        const col0 = p.canvas?.colors ?? {};
        const parsed0 = parseDbml(dbml0);
        const groupPages = pagesFromTableGroups(parsed0.error ? { tables: [], refs: [], records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {} } : parsed0);
        const pages0 =
          p.canvas?.pages?.length
            ? p.canvas.pages
            : groupPages.length
              ? [allTablesPage(), ...groupPages]
              : [allTablesPage()];
        const active0 = resolveActivePageIds(p.canvas, parsed0.tables.length);
        startTransition(() => {
          setDbml(dbml0);
          setPositions(pos0);
          setSizes(api.normalizeSizes(p.canvas?.sizes));
          setColors(col0);
          setCollapsedGroups(p.canvas?.collapsedGroups ?? []);
          setCanvasPages(pages0);
          setActivePageIds(active0);
        });
        prevDbmlRef.current = dbml0;
        baselineRef.current = { dbml: dbml0, positions: pos0, colors: col0 };
        const n = parsed0.tables.length;
        pushStatus(
          n > PAGE_WIZARD_THRESHOLD && active0.length === 0
            ? `${n} tabelas carregadas — marque assuntos no painel Páginas`
            : n >= LARGE_DIAGRAM_HINT
              ? `${n} tabelas carregadas — use páginas/camadas para navegar`
              : 'Pronto',
        );
        setSaveState('saved');
      })
      .catch(() => {
        // Backend offline — fallback para legacy ou exemplo
        api
          .loadProject()
          .then((p) => {
            const dbml0 = p.dbml || SAMPLE;
            const pos0 = p.canvas?.positions ?? {};
            const col0 = p.canvas?.colors ?? {};
            setDbml(dbml0);
            prevDbmlRef.current = dbml0;
            setPositions(pos0);
            setSizes(api.normalizeSizes(p.canvas?.sizes));
            setColors(col0);
            setCollapsedGroups(p.canvas?.collapsedGroups ?? []);
            baselineRef.current = { dbml: dbml0, positions: pos0, colors: col0 };
            pushStatus('Pronto');
            setSaveState('saved');
          })
          .catch(() => {
            setDbml(SAMPLE);
            baselineRef.current = { dbml: SAMPLE, positions: {}, colors: {} };
            pushStatus('Backend offline — editando localmente');
            setSaveState('saved');
          });
      })
      .finally(() => {
        loadedRef.current = true;
      });
  }, []);

  // Busca metadados do servidor na montagem para detectar instância fixada (F3).
  useEffect(() => {
    api.getMeta().then((m) => setPinnedProjectId(m.pinnedProjectId)).catch(() => {});
  }, []);

  // Commit debounced ao histórico: empurra o baseline anterior quando o estado muda.
  useEffect(() => {
    if (!loadedRef.current) return;
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      const base = baselineRef.current;
      const cur: Snapshot = { dbml, positions, colors };
      if (
        base &&
        (base.dbml !== cur.dbml || base.positions !== cur.positions || base.colors !== cur.colors)
      ) {
        setPast((p) => [...p, base].slice(-100));
        setFuture([]);
        baselineRef.current = cur;
      }
    }, 400);
    return () => clearTimeout(commitTimer.current);
  }, [dbml, positions, colors]);

  // Espelha dbml no ref para que handleEditorCommit leia o buffer atual sem re-criar.
  useEffect(() => { dbmlRef.current = dbml; }, [dbml]);

  const applySnapshot = useCallback((s: Snapshot) => {
    clearTimeout(commitTimer.current);
    clearTimeout(renameTimer.current);
    baselineRef.current = s;
    prevDbmlRef.current = s.dbml;
    setDbml(s.dbml);
    setPositions(s.positions);
    setColors(s.colors);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [{ dbml, positions, colors }, ...f]);
      applySnapshot(prev);
      return p.slice(0, -1);
    });
  }, [dbml, positions, colors, applySnapshot]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => [...p, { dbml, positions, colors }]);
      applySnapshot(next);
      return f.slice(1);
    });
  }, [dbml, positions, colors, applySnapshot]);

  // Marca dirty quando qualquer dado muda após o load — exceto durante a
  // janela "saved" (deixar o reset para idle acontecer sem flip-flopping).
  useEffect(() => {
    if (!loadedRef.current) return;
    setSaveState((s) => {
      if (s === 'idle' || s === 'saving' || s === 'saved') return s;
      return 'dirty';
    });
  }, [dbml, positions, sizes, colors, collapsedGroups, canvasPages, activePageIds]);

  const handleSave = useCallback((explicitDbml?: string) => {
    setSaveState('saving');
    // Salva pelo ID do projeto ativo quando disponível; cai no endpoint legacy senão.
    // explicitDbml é usado pelo Ctrl+S para garantir que o texto recém-reconciliado seja
    // persistido mesmo antes que o setDbml(out) do handleEditorCommit seja processado.
    const dbmlToSave = explicitDbml !== undefined ? explicitDbml : dbml;
    const canvas = { positions, sizes, colors, collapsedGroups, pages: canvasPages, activePageIds };
    const saveCall = currentProjectId
      ? api.saveProjectById(currentProjectId, dbmlToSave, canvas)
      : api.saveProject(dbmlToSave, canvas);
    saveCall
      .then(() => setSaveState('saved'))
      .catch(() => setSaveState('error'));
  }, [currentProjectId, dbml, positions, sizes, colors, collapsedGroups, canvasPages, activePageIds]);

  // Auto-save: quando ativo, salva após 1.5s de dirty.
  useEffect(() => {
    if (!autoSave || saveState !== 'dirty') return;
    const id = setTimeout(handleSave, 1500);
    return () => clearTimeout(id);
  }, [autoSave, saveState, handleSave]);

  // Após "Salvo" (1.5s), volta para "Salvar" ocioso — evita o botão "Salvar"
// ficar fixo após salvar sem nova edição. Mais curto que 2s para reduzir
// o tempo em que o usuário vê o estado travado.
  useEffect(() => {
    if (saveState !== 'saved') return;
    const id = setTimeout(() => setSaveState('idle'), 1500);
    return () => clearTimeout(id);
  }, [saveState]);

  // Parse imediato (validação, editor). Canvas usa parse adiado abaixo.
  const parsed = useMemo(() => parseDbml(dbml), [dbml]);
  const dbmlBlocks = useMemo(() => splitDbmlBlocks(dbml), [dbml]);
  const dbmlDeferred = useDeferredValue(dbml);
  const parsedDeferred = useMemo(() => parseDbml(dbmlDeferred), [dbmlDeferred]);
  const canvasParsePending = dbml !== dbmlDeferred;

  // Mantém o último modelo válido no canvas mesmo com erro de digitação no editor.
  const [canvasModel, setCanvasModel] = useState<ParseResult>({
    tables: [], refs: [], records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {},
  });
  useEffect(() => {
    if (!parsed.error) setCanvasModel(parsed);
  }, [parsed]);

  const [canvasModelDeferred, setCanvasModelDeferred] = useState<ParseResult>({
    tables: [], refs: [], records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {},
  });
  useEffect(() => {
    if (!parsedDeferred.error) setCanvasModelDeferred(parsedDeferred);
  }, [parsedDeferred]);

  /** Modelo ao vivo quando o parse é válido; evita canvas defasado após mutações (ex.: remover Ref). */
  const activeModel = useMemo(
    () => (parsed.error ? canvasModel : parsed),
    [parsed, canvasModel],
  );

  const canvasBaseModel = useMemo(
    () => (parsedDeferred.error ? canvasModelDeferred : parsedDeferred),
    [parsedDeferred, canvasModelDeferred],
  );

  const canvasView = useMemo(
    () => buildCanvasViewModel(canvasBaseModel, canvasPages, activePageIds),
    [canvasBaseModel, canvasPages, activePageIds],
  );
  const canvasActiveModel = canvasView.model;
  const canvasStubs = useMemo(
    () => stubsWithLinkCounts(canvasView.stubs, canvasView.crossRefs),
    [canvasView.stubs, canvasView.crossRefs],
  );
  const externalLinksByTable = useMemo(() => {
    const map = new Map<string, ExternalLinkBadge[]>();
    for (const link of aggregateCrossLinks(canvasView.crossRefs, canvasView.stubs)) {
      const list = map.get(link.visibleTable) ?? [];
      list.push({
        stubId: link.stubId,
        label: link.stubLabel,
        count: link.count,
        direction: link.direction,
      });
      map.set(link.visibleTable, list);
    }
    return map;
  }, [canvasView.crossRefs, canvasView.stubs]);

  const editorCursorLineRef = useRef(-1);
  const editingTableRef = useRef<string | null>(null);
  const lastPanTableRef = useRef<string | null>(null);

  const tableIdsKey = useMemo(
    () => activeModel.tables.map((t) => t.id).join('\0'),
    [activeModel.tables],
  );

  // Posições: remove órfãs e atribui posição default a tabelas novas (criadas no editor).
  useEffect(() => {
    const ids = new Set(activeModel.tables.map((t) => t.id));
    setPositions((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of Object.keys(next)) {
        if (!ids.has(id) && !isExternalStubNodeId(id)) {
          delete next[id];
          changed = true;
        }
      }
      activeModel.tables.forEach((t, i) => {
        if (next[t.id]) return;
        next[t.id] = defaultTablePosition(next, i);
        changed = true;
      });
      return changed ? next : prev;
    });
    setColors((prev) => {
      const stale = Object.keys(prev).filter((id) => !ids.has(id));
      if (!stale.length) return prev;
      const next = { ...prev };
      for (const id of stale) delete next[id];
      return next;
    });
  }, [activeModel.tables]);

  useEffect(() => {
    if (!canvasView.stubs.length) return;
    setPositions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const stub of canvasStubs) {
        if (next[stub.id]) continue;
        next[stub.id] = defaultExternalStubPosition(stub.id, canvasView.crossRefs, next);
        changed = true;
      }
      const stubIds = new Set(canvasStubs.map((s) => s.id));
      for (const id of Object.keys(next)) {
        if (isExternalStubNodeId(id) && !stubIds.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [canvasStubs, canvasView.crossRefs]);

  const mutateDbml = useCallback((fn: (d: string) => string) => {
    setDbml((d) => {
      const next = fn(d);
      prevDbmlRef.current = next;
      return next;
    });
  }, []);

  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  const modelIssues = useMemo(() => {
    const issues = validateModel(activeModel, dbml, dbmlBlocks);
    const parseIssues = parsed.error
      ? [{ severity: 'error' as const, message: parsed.error, line: parsed.errorLine }]
      : [];
    const fromImport = importWarnings.map((message) => ({
      severity: 'error' as const,
      message,
    }));
    return [...parseIssues, ...fromImport, ...issues];
  }, [activeModel, dbml, dbmlBlocks, parsed.error, parsed.errorLine, importWarnings]);

  const pruneCanvasState = useCallback((removedIds: string[]) => {
    const gone = new Set(removedIds);
    setPositions((prev) => {
      const next = { ...prev };
      for (const id of gone) delete next[id];
      return next;
    });
    setColors((prev) => {
      const next = { ...prev };
      for (const id of gone) delete next[id];
      return next;
    });
    const st = useInteraction.getState();
    if (st.selectedTable && gone.has(st.selectedTable)) st.selectTable(null);
    const nextIds = st.selectedTableIds.filter((id) => !gone.has(id));
    if (nextIds.length !== st.selectedTableIds.length) {
      if (nextIds.length) st.setSelectedTableIds(nextIds);
      else st.clearCanvasSelection();
    }
    if (
      st.focusedFieldMapping &&
      (gone.has(st.focusedFieldMapping.sourceTable) || gone.has(st.focusedFieldMapping.targetTable))
    ) {
      st.setFocusedFieldMapping(null);
    }
    if (focusTableId && gone.has(focusTableId)) setFocusTableId(null);
  }, [focusTableId]);

  const migrateTableId = useCallback((oldId: string, newId: string) => {
    setPositions((prev) => {
      if (!prev[oldId]) return prev;
      const next = { ...prev };
      next[newId] = prev[oldId];
      delete next[oldId];
      return next;
    });
    setColors((prev) => {
      if (!prev[oldId]) return prev;
      const next = { ...prev };
      next[newId] = prev[oldId];
      delete next[oldId];
      return next;
    });
    const st = useInteraction.getState();
    if (st.selectedTable === oldId) st.selectTable(newId);
    else if (st.selectedTableIds.includes(oldId)) {
      st.setSelectedTableIds(st.selectedTableIds.map((id) => (id === oldId ? newId : id)));
    }
    if (st.focusedFieldMapping?.sourceTable === oldId || st.focusedFieldMapping?.targetTable === oldId) {
      st.setFocusedFieldMapping(null);
    }
  }, []);

  const handleDbmlChange = useCallback((next: string) => {
    setDbml(next);
  }, []);

  const handleEditorCommit = useCallback((): { openedModal: boolean; reconciledDbml: string | null } => {
    const committed = prevDbmlRef.current;
    const buffer = dbmlRef.current; // ref espelhando dbml
    if (committed === buffer) return { openedModal: false, reconciledDbml: null };
    const impacts = analyzeRenames(committed, buffer);

    const hasRefImpacts = impacts.some((i) => i.affectsRefs);

    if (hasRefImpacts) {
      // Qualquer rename afeta refs: abre o modal sem aplicar nada e sem avançar prevDbmlRef.
      // Assim, se o usuário fechar o modal (onClose), o próximo commit re-detecta e re-prompta.
      setPendingRename({ impacts, buffer, committed });
      return { openedModal: true, reconciledDbml: null };
    }

    // Nenhum rename afeta refs: aplica tudo diretamente
    const { dbml: out, appliedRefCount } = applyRenames(buffer, impacts, migrateTableId);
    prevDbmlRef.current = out;
    if (out !== buffer) {
      setDbml(out);
      pushStatus(`Edição aplicada (${appliedRefCount} refs atualizadas)`);
    } else {
      pushStatus('');
    }
    return { openedModal: false, reconciledDbml: out };
  }, [migrateTableId]);

  // Atalhos capturados ANTES do CodeMirror (cujo history nativo está desativado).
  // Posicionado após handleEditorCommit para evitar referência antes da declaração.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        e.stopPropagation();
        redo();
      } else if (k === 's') {
        e.preventDefault();
        e.stopPropagation();
        // Reconcilia antes de salvar: se houver rename afetando refs, abre o modal e
        // bloqueia o save até o usuário resolver. Caso contrário, salva o texto reconciliado.
        const { openedModal, reconciledDbml } = handleEditorCommit();
        if (openedModal) {
          pushStatus('Confirme a renomeação antes de salvar');
        } else {
          handleSave(reconciledDbml ?? undefined);
        }
      } else if (k === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, redo, handleSave, handleEditorCommit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const el = e.target as HTMLElement;
      if (el.closest?.('.cm-editor, input, textarea, [contenteditable]')) return;
      e.preventDefault();
      setHelpOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const goToLine = useCallback((line: number) => {
    setEditorCollapsed(false);
    requestAnimationFrame(() => editorRef.current?.goToLine(line));
  }, []);

  const goToColumn = useCallback((table: string, column: string) => {
    setEditorCollapsed(false);
    requestAnimationFrame(() => editorRef.current?.goToColumn(table, column));
  }, []);

  const clearFocusTable = useCallback(() => setFocusTableId(null), []);

  const focusTable = useCallback((tableId: string, options?: FocusTableOptions) => {
    setFocusTableId(tableId);
    useInteraction.getState().selectTable(tableId);
    if (shouldPanToTable(lastPanTableRef.current, tableId, options)) {
      lastPanTableRef.current = tableId;
      setFocusNonce((n) => n + 1);
    }
  }, []);

  const focusTableWithPan = useCallback(
    (tableId: string) => focusTable(tableId, { pan: true }),
    [focusTable],
  );

  /** Foca a tabela no canvas E também rola o editor DBML até a linha dela.
   *  Usado pela palette (Cmd+K) para que o editor siga o foco do canvas. */
  const focusTableInEditor = useCallback(
    (tableId: string) => {
      focusTableWithPan(tableId);
      // Garante que o editor abre se estiver colapsado, e rola para a linha da tabela.
      setEditorCollapsed(false);
      const line = lineOfTable(dbml, tableId);
      if (line == null) return;
      let attempt = 0;
      const tryGo = () => {
        if (editorRef.current) {
          editorRef.current.goToLine(line);
          return;
        }
        if (++attempt < 8) requestAnimationFrame(tryGo);
      };
      requestAnimationFrame(tryGo);
    },
    [focusTableWithPan, dbml],
  );

  /** Scrolla o editor para a linha da coluna dentro da tabela. Robusto a
   *  `editorRef` ainda não estar montado (Suspense do Editor): faz retry com
   *  backoff curto até 8 frames (~130ms). */
  const scrollEditorToColumn = useCallback(
    (tableId: string, columnName: string) => {
      setEditorCollapsed(false);
      const line = lineOfColumn(dbml, tableId, columnName);
      if (line == null) return;
      let attempt = 0;
      const tryGo = () => {
        if (editorRef.current) {
          editorRef.current.goToLine(line);
          return;
        }
        if (++attempt < 8) requestAnimationFrame(tryGo);
      };
      requestAnimationFrame(tryGo);
    },
    [dbml],
  );

  const focusColumn = useCallback(
    (tableId: string, columnName: string) => {
      focusTableWithPan(tableId);
      useInteraction.getState().selectColumn({ table: tableId, column: columnName });
      // Garante que o editor DBML também scrolla para a linha da coluna,
      // não só seleciona no canvas. (Fix: Cmd+K no outline não ia para a coluna.)
      scrollEditorToColumn(tableId, columnName);
    },
    [focusTableWithPan, scrollEditorToColumn],
  );

  const syncCanvasToEditorLine = useCallback(
    (line0: number) => {
      if (!shouldSyncCursorLine(line0)) return;
      if (editorCollapsed) return;
      editorCursorLineRef.current = line0;
      const blockName = tableAtLine(dbml, line0);
      if (!blockName) return;
      const tableIds = activeModel.tables.map((t) => t.id);
      const tableId = resolveTableId(blockName, tableIds);
      if (!tableId || !shouldSyncEditorTable(editingTableRef.current, tableId)) return;
      editingTableRef.current = tableId;
      focusTable(tableId);
    },
    [dbml, activeModel.tables, editorCollapsed, focusTable],
  );

  const handleEditorCursorLine = useCallback(
    (line0: number) => syncCanvasToEditorLine(line0),
    [syncCanvasToEditorLine],
  );

  // Nova tabela no parse: foca se o cursor ainda está no bloco dela.
  useEffect(() => {
    syncCanvasToEditorLine(editorCursorLineRef.current);
  }, [tableIdsKey, syncCanvasToEditorLine]);

  const handleAutolayout = useCallback(() => {
    const lineageMode = useInteraction.getState().lineageMode;
    const layoutModel = activePageIds.includes(ALL_PAGE_ID) ? canvasBaseModel : canvasActiveModel;
    const base = lineageMode
      ? autolayoutLineagePositions(layoutModel)
      : autolayoutPositions(layoutModel, false);
    const next = canvasStubs.length ? layoutExternalStubsOnTop(base, canvasStubs) : base;
    setPositions(next);
    setFitViewTrigger((n) => n + 1);
    pushStatus(
      lineageMode
        ? `Canvas reorganizado para linhagem (${layoutModel.tables.length} tabelas)`
        : canvasStubs.length
          ? `Canvas reorganizado (${layoutModel.tables.length} tabelas, ${canvasStubs.length} grupo(s) externo(s) no topo)`
          : `Canvas reorganizado (${layoutModel.tables.length} tabelas)`,
    );
    setSaveState('dirty');
  }, [activePageIds, canvasBaseModel, canvasActiveModel, canvasStubs]);

  // Lineage derivado do DBML (ParsedLineage[] → LineageLink[]).
  const lineage = useMemo<LineageLink[]>(() => {
    const out: LineageLink[] = [];
    for (const entry of activeModel.lineage) {
      for (const s of entry.sources) out.push({ source: s, target: entry.target });
    }
    return out;
  }, [activeModel.lineage]);

  const canvasLineage = useMemo<LineageLink[]>(() => {
    const out: LineageLink[] = [];
    for (const entry of canvasActiveModel.lineage) {
      for (const s of entry.sources) out.push({ source: s, target: entry.target });
    }
    return out;
  }, [canvasActiveModel.lineage]);

  const tableGroupsKey = useMemo(() => {
    const groups = new Set<string>();
    let ungrouped = false;
    for (const t of activeModel.tables) {
      if (t.group) groups.add(t.group);
      else ungrouped = true;
    }
    return `${[...groups].sort().join('\0')}|${ungrouped ? 1 : 0}`;
  }, [activeModel.tables]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const groupPages = pagesFromTableGroups(activeModel);
    if (!groupPages.length) return;
    setCanvasPages((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      let changed = false;
      const next = [...prev];
      if (!ids.has(ALL_PAGE_ID)) {
        next.unshift(allTablesPage());
        changed = true;
      }
      for (const gp of groupPages) {
        if (!ids.has(gp.id)) {
          next.push(gp);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tableGroupsKey, activeModel]);

  // Camadas vêm do DBML (LayerGroup) — fonte de verdade exportável.
  // useStable preserva identidade entre keystrokes (o parse recria os arrays), o que
  // mantém layerOf/actions memoizados e evita re-render de todos os nós.
  const layersArr = useStable(useMemo(() => layersFromGroups(activeModel.layerGroups), [activeModel.layerGroups]));
  const layerMembership = useStable(useMemo(() => tableLayerMap(activeModel.layerGroups), [activeModel.layerGroups]));
  const layerOf = useCallback(
    (id: string) => {
      if (layerMembership[id]) return layerMembership[id];
      const schema = id.includes('.') ? id.split('.')[0] : undefined; // auto-match por schema
      return schema && layersArr.some((l) => l.id === schema) ? schema : undefined;
    },
    [layerMembership, layersArr],
  );

  const handleRemoveTable = useCallback(
    (tableId: string) => {
      mutateDbml((d) => removeTable(d, tableId));
      pruneCanvasState([tableId]);
      pushStatus(`Tabela removida: ${tableId}`);
      setSaveState('dirty');
    },
    [mutateDbml, pruneCanvasState],
  );

  const handleRemoveTables = useCallback(
    (tableIds: string[]) => {
      if (!tableIds.length) return;
      mutateDbml((d) => tableIds.reduce((acc, id) => removeTable(acc, id), d));
      pruneCanvasState(tableIds);
      pushStatus(`${tableIds.length} tabela(s) removida(s)`);
      setSaveState('dirty');
    },
    [mutateDbml, pruneCanvasState],
  );

  // Refs com os dados voláteis (recriados a cada parse). Os callbacks de `actions`
  // leem o valor mais recente via ref, então a identidade de `actions` pode ser
  // estável entre keystrokes — sem isso o contexto muda sempre e re-renderiza todos
  // os nós do React Flow.
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  const modelRef = useRef(activeModel);
  modelRef.current = activeModel;
  const lineageRef = useRef(lineage);
  lineageRef.current = lineage;
  const layersArrRef = useRef(layersArr);
  layersArrRef.current = layersArr;
  const layerMembershipRef = useRef<Record<string, string>>(layerMembership);
  layerMembershipRef.current = layerMembership;

  // Computa, por tabela, a cor de cabeçalho e os metadados (PKs/FKs/linhagem/etc.)
  // em uma única passada. Esses valores vão para o `data` do nó, permitindo memoizar
  // `TableNode` por identidade de `data` em vez de recalcular durante cada render.
  const nodeExtras = useMemo(() => {
    const model = canvasActiveModel;
    const fksBySource = new Map<string, { column: string; ref: string }[]>();
    const refsInByTarget = new Map<string, Set<string>>();
    for (const r of model.refs) {
      let fl = fksBySource.get(r.source);
      if (!fl) fksBySource.set(r.source, (fl = []));
      fl.push({ column: r.fromCol, ref: `${r.target}.${r.toCol}` });
      let rs = refsInByTarget.get(r.target);
      if (!rs) refsInByTarget.set(r.target, (rs = new Set()));
      rs.add(r.source);
    }
    const sourcesByTarget = new Map<string, string[]>();
    for (const l of canvasLineage) {
      let s = sourcesByTarget.get(l.target);
      if (!s) sourcesByTarget.set(l.target, (s = []));
      s.push(l.source);
    }
    const recByKey = new Map<string, (typeof model.records)[number]>();
    for (const rec of model.records) recByKey.set(rec.table, rec);

    const map = new Map<string, { headerColor: string; meta: TableMeta; externalLinks?: ExternalLinkBadge[]; linkedColumns?: string[] }>();
    const linkedByTable = new Map<string, Set<string>>();
    const linkCol = (tableId: string, col: string) => {
      let set = linkedByTable.get(tableId);
      if (!set) linkedByTable.set(tableId, (set = new Set()));
      set.add(col);
    };
    for (const r of model.refs) {
      linkCol(r.source, r.fromCol);
      linkCol(r.target, r.toCol);
    }
    for (const m of model.lineageFields ?? []) {
      linkCol(m.sourceTable, m.sourceColumn);
      linkCol(m.targetTable, m.targetColumn);
    }
    for (const t of model.tables) {
      const sources = sourcesByTarget.get(t.id) ?? [];
      const rec = recByKey.get(t.id) ?? recByKey.get(t.name);
      const sample = rec ? { columns: rec.columns, rows: rec.rows } : null;
      const pks = t.columns.filter((c) => c.pk).map((c) => c.name);
      const fks = fksBySource.get(t.id) ?? [];
      const refsIn = [...(refsInByTarget.get(t.id) ?? [])];
      const columnNotes = t.columns
        .filter((c) => c.note)
        .map((c) => ({ column: c.name, note: c.note as string }));
      const dbtHas = !!(t.resourceType || t.materialization || t.tags?.length);
      const has = !!(
        sources.length ||
        sample ||
        pks.length ||
        fks.length ||
        refsIn.length ||
        t.note ||
        columnNotes.length ||
        dbtHas
      );
      const meta: TableMeta = {
        sources, sample, pks, fks, refsIn, note: t.note, columnNotes,
        resourceType: t.resourceType, materialization: t.materialization, tags: t.tags,
        has,
      };
      const headerColor = model.colors[t.id] ?? colors[t.id] ?? layerColorOf(layersArr, layerOf(t.id)) ?? '#13284b';
      const externalLinks = externalLinksByTable.get(t.id);
      const linked = linkedByTable.get(t.id);
      map.set(t.id, {
        headerColor,
        meta,
        ...(externalLinks?.length ? { externalLinks } : {}),
        ...(linked?.size ? { linkedColumns: [...linked].sort() } : {}),
      });
    }
    return map;
  }, [canvasActiveModel, canvasLineage, colors, layersArr, layerOf, externalLinksByTable]);

  // Ações do canvas (mutações de documento e cores) expostas via contexto.
// Memo estável (deps vazias) — handlers leem estado via refs para evitar
// rebuild em cascata a cada mudança de activeModel/layers/layerOf, que
// antes re-renderizava todos os TableNodes do canvas.
const actions = useMemo<CanvasActions>(
    () => ({
      onSelectColumn: (table, column) => selectColumn({ table, column }),
      onRenameColumn: (table, oldName, newName) => {
        const trimmed = newName.trim();
        const dup = findDuplicateColumnName(
          trimmed,
          modelRef.current.tables.find((t) => t.id === table)?.columns.map((c) => c.name).filter((n) => n !== oldName) ?? [],
        );
        if (dup) {
          pushStatus(`Coluna "${dup}" já existe em "${table}" — escolha outro nome.`);
          return;
        }
        setDbml((d) => {
          const next = renameColumnAllRefs(d, table, oldName, trimmed);
          prevDbmlRef.current = next;
          return next;
        });
        const sel = useInteraction.getState().selectedColumn;
        if (sel?.table === table && sel?.column === oldName) {
          selectColumn({ table, column: trimmed });
        }
      },
      onGoToColumn: goToColumn,
      onRenameTable: (tableId, newName) => {
        const trimmed = newName.trim();
        const dup = findDuplicateTableId(
          trimmed,
          modelRef.current.tables.map((t) => t.id).filter((id) => id !== tableId),
        );
        if (dup) {
          pushStatus(`Tabela "${dup}" já existe — escolha outro nome.`);
          return;
        }
        setDbml((d) => {
          const next = renameTable(d, tableId, trimmed);
          prevDbmlRef.current = next;
          return next;
        });
        migrateTableId(tableId, trimmed);
      },
      onRemoveTable: handleRemoveTable,
      onAddColumn: (table) => setDbml((d) => addColumn(d, table, 'nova_coluna', 'string')),
      colorOf: (id) => colorsRef.current[id],
      onSetColor: (id, color) => setDbml((d) => setTableColor(d, id, color)),
      onSetGroupColor: (group, color) => setDbml((d) => setGroupColor(d, group, color)),
      onResizeTable: (id, width, height) =>
        setSizes((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            width: Math.round(width),
            ...(height != null ? { height: Math.round(height) } : {}),
          },
        })),
      layerOf: (id) => {
        const layerMembership = layerMembershipRef.current;
        if (layerMembership[id]) return layerMembership[id];
        const arr = layersArrRef.current;
        const schema = id.includes('.') ? id.split('.')[0] : undefined;
        return schema && arr.some((l) => l.id === schema) ? schema : undefined;
      },
      layerColorOf: (layerId) => layerColorOf(layersArrRef.current, layerId),
      onSetLayer: (id, layerId) =>
        setDbml((d) => setTableLayer(d, id, layerId, layerColorOf(layersArrRef.current, layerId ?? undefined))),
      layers: layersArr,
      onAddLayer: (name, color) => setDbml((d) => addLayerGroup(d, name, color)),
      onToggleGroup: (name) =>
        setCollapsedGroups((prev) => (prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name])),
      tableMeta: (id) => {
        const model = modelRef.current;
        const t = model.tables.find((x) => x.id === id);
        const sources = lineageRef.current.filter((l) => l.target === id).map((l) => l.source);
        const rec = model.records.find((r) => r.table === id || r.table === t?.name);
        const sample = rec ? { columns: rec.columns, rows: rec.rows } : null;
        const pks = t ? t.columns.filter((c) => c.pk).map((c) => c.name) : [];
        const fks = model.refs
          .filter((r) => r.source === id)
          .map((r) => ({ column: r.fromCol, ref: `${r.target}.${r.toCol}` }));
        const refsIn = [...new Set(model.refs.filter((r) => r.target === id).map((r) => r.source))];
        const columnNotes = t
          ? t.columns.filter((c) => c.note).map((c) => ({ column: c.name, note: c.note as string }))
          : [];
        const dbtHas = !!(t?.resourceType || t?.materialization || t?.tags?.length);
        const has = !!(sources.length || sample || pks.length || fks.length || refsIn.length || t?.note || columnNotes.length || dbtHas);
        return {
          sources, sample, pks, fks, refsIn, note: t?.note, columnNotes,
          resourceType: t?.resourceType, materialization: t?.materialization, tags: t?.tags,
          has,
        };
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intencionalmente vazio: actions é estável; handlers leem refs/setters estáveis
    [],
  );

  const handleCreateLineage = (source: string, target: string) => {
    if (!source || !target || source === target) return;
    mutateDbml((d) => addLineageEntry(d, source, target));
  };
  const handleRemoveLineage = (source: string, target: string) => {
    mutateDbml((d) => removeLineageEntry(d, source, target));
  };
  const handleAddFieldLineage = (
    sourceTable: string, sourceColumn: string, targetColumn: string, note?: string, ref?: string,
  ) => {
    const targetTable = useInteraction.getState().selectedTable;
    if (!targetTable) return;
    mutateDbml((d) =>
      addFieldLineageEntry(d, sourceTable, sourceColumn, targetTable, targetColumn, { note, ref }),
    );
  };
  // Criar mapeamento campo→campo por arraste no canvas (origem e destino explícitos).
  const handleCreateFieldLineage = (
    sourceTable: string, sourceColumn: string, targetTable: string, targetColumn: string,
  ) => {
    mutateDbml((d) => addFieldLineageEntry(d, sourceTable, sourceColumn, targetTable, targetColumn));
  };
  const handleRemoveFieldLineage = (
    sourceTable: string, sourceColumn: string, targetTable: string, targetColumn: string,
  ) => {
    mutateDbml((d) => removeFieldLineageEntry(d, sourceTable, sourceColumn, targetTable, targetColumn));
  };
  const handleUpdateFieldLineage = (
    prev: { sourceTable: string; sourceColumn: string; targetTable: string; targetColumn: string },
    next: { sourceTable: string; sourceColumn: string; targetColumn: string; note?: string; ref?: string },
  ) => {
    const targetTable = useInteraction.getState().selectedTable;
    if (!targetTable) return;
    mutateDbml((d) =>
      updateFieldLineageEntry(d, prev, {
        ...next,
        targetTable,
      }),
    );
  };
  const handleToggleGroup = useCallback(
    (name: string) =>
      setCollapsedGroups((prev) => (prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name])),
    [],
  );

  const handleCreateRef = (fromTbl: string, fromCol: string, toTbl: string, toCol: string) => {
    if (!fromCol || !toCol) return;
    const fromTable = activeModel.tables.find((t) => t.id === fromTbl);
    const toTable = activeModel.tables.find((t) => t.id === toTbl);
    const fromIsPk = !!fromTable?.columns.find((c) => c.name === fromCol)?.pk;
    const toIsPk = !!toTable?.columns.find((c) => c.name === toCol)?.pk;
    if (fromIsPk && !toIsPk) {
      mutateDbml((d) => appendRef(d, toTbl, toCol, fromTbl, fromCol));
      pushStatus(`Relação criada: ${toTbl}.${toCol} → ${fromTbl}.${fromCol}`);
    } else {
      mutateDbml((d) => appendRef(d, fromTbl, fromCol, toTbl, toCol));
      pushStatus(`Relação criada: ${fromTbl}.${fromCol} → ${toTbl}.${toCol}`);
    }
  };

  const handleRemoveRef = (fromTbl: string, fromCol: string, toTbl: string, toCol: string) => {
    mutateDbml((d) => removeRef(d, fromTbl, fromCol, toTbl, toCol));
    pushStatus(`Relação removida: ${fromTbl}.${fromCol} → ${toTbl}.${toCol}`);
  };

  const run = useCallback(async (label: string, fn: () => Promise<string>) => {
    pushStatus(`${label}…`);
    try {
      pushStatus(await fn());
    } catch (e: any) {
      pushStatus(`Erro: ${e?.message ?? e}`);
    }
  }, []);

  const handleChangeActivePages = useCallback(
    (ids: string[]) => {
      setActivePageIds(ids);
      const names = ids.includes(ALL_PAGE_ID)
        ? 'Todas'
        : ids
            .map((id) => canvasPages.find((p) => p.id === id)?.name ?? id)
            .join(', ');
      pushStatus(ids.length ? `Canvas: ${names}` : 'Canvas vazio — marque assuntos no painel Páginas');
      setSaveState('dirty');
    },
    [canvasPages],
  );

  const handleImport = () =>
    run('Importando', async () => {
      const importCall = currentProjectId
        ? api.importFromInputForProject(currentProjectId, dbml)
        : api.importFromInput(dbml);
      const { dbml: merged, imported, warnings, lineageFieldCount } = await importCall;
      const parsedMerged = parseDbml(merged);
      const groupPages = pagesFromTableGroups(parsedMerged.error ? activeModel : parsedMerged);
      const pagesNext =
        groupPages.length ? [allTablesPage(), ...groupPages] : [allTablesPage()];
      const tableCount = parsedMerged.tables.length;
      startTransition(() => {
        setDbml(merged);
        setImportWarnings(warnings ?? []);
        setCanvasPages(pagesNext);
        if (tableCount > PAGE_WIZARD_THRESHOLD) {
          setActivePageIds([]);
          if (groupPages.length > 0) {
            setPageWizardTableCount(tableCount);
            setPageWizardOpen(true);
          }
        } else {
          setActivePageIds([ALL_PAGE_ID]);
        }
      });
      prevDbmlRef.current = merged;
      const warnNote = warnings?.length ? ` — ${warnings.length} aviso(s) no painel Problemas` : '';
      const l2Note =
        lineageFieldCount != null && lineageFieldCount > 0
          ? ` — ${lineageFieldCount} mapeamento(s) L2`
          : '';
      const scaleNote =
        tableCount >= LARGE_DIAGRAM_HINT
          ? ` — ${tableCount} tabelas: use páginas/camadas para navegar`
          : '';
      return imported.length
        ? `Importado: ${imported.join(', ')}${l2Note}${warnNote}${scaleNote}`
        : 'Nenhum .sql em data/input/';
    });

  // --- Gerenciamento de projetos (F2) ---

  // Troca de projeto: salva o atual, carrega o novo, limpa histórico.
  const switchProject = useCallback(
    async (id: string) => {
      if (id === currentProjectId) return;
      // Salva o projeto atual antes de trocar (não perde trabalho)
      if (currentProjectId) {
        try {
          await api.saveProjectById(currentProjectId, dbml, {
            positions,
            colors,
            collapsedGroups,
            pages: canvasPages,
            activePageIds,
          });
        } catch {
          // ignora erros de save ao trocar — não bloqueia a troca
        }
      }
      // Pausa marcação de dirty durante a troca
      loadedRef.current = false;
      try {
        await api.activateProject(id);
        const p = await api.loadProjectById(id);
        const dbml0 = p.dbml || SAMPLE;
        const pos0 = p.canvas?.positions ?? {};
        const col0 = p.canvas?.colors ?? {};
        // Páginas do novo projeto (persistidas ou derivadas dos TableGroups)
        const parsed0 = parseDbml(dbml0);
        const groupPages = pagesFromTableGroups(
          parsed0.error
            ? { tables: [], refs: [], records: [], layerGroups: [], lineage: [], lineageFields: [], rolenames: [], colors: {} }
            : parsed0,
        );
        const pages0 =
          p.canvas?.pages?.length
            ? p.canvas.pages
            : groupPages.length
              ? [allTablesPage(), ...groupPages]
              : [allTablesPage()];
        const active0 = resolveActivePageIds(p.canvas, parsed0.tables.length);
        // Limpa timers pendentes para evitar que commit do histórico anterior dispare
        clearTimeout(commitTimer.current);
        clearTimeout(renameTimer.current);
        // Reseta o histórico — undo/redo não vaza entre projetos
        setPast([]);
        setFuture([]);
        // Carrega o novo estado
        setDbml(dbml0);
        prevDbmlRef.current = dbml0;
        setPositions(pos0);
        setSizes(api.normalizeSizes(p.canvas?.sizes));
        setColors(col0);
        setCollapsedGroups(p.canvas?.collapsedGroups ?? []);
        setCanvasPages(pages0);
        setActivePageIds(active0);
        // Baseline do novo projeto — impede que o load marque dirty
        baselineRef.current = { dbml: dbml0, positions: pos0, colors: col0 };
        setCurrentProjectId(id);
        // 'idle' (não 'saved'): o efeito de dirty roda após o render do switch,
        // quando loadedRef já voltou a true; o guard s==='idle' o mantém limpo.
        setSaveState('idle');
        pushStatus('Projeto carregado');
      } catch (e: unknown) {
        pushStatus(`Erro ao trocar projeto: ${(e as Error)?.message ?? e}`);
      } finally {
        loadedRef.current = true;
      }
    },
    [currentProjectId, dbml, positions, colors, collapsedGroups, canvasPages, activePageIds],
  );

  // Atualiza a lista de projetos do servidor
  const refreshProjects = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects();
      setProjects(list);
    } catch {
      // ignora
    }
  }, []);

  const handleCreateProject = useCallback(
    async (name: string) => {
      try {
        await api.createProject(name);
        if (pinnedProjectId) {
          // Instância fixada: não troca; apenas avisa e atualiza a lista.
          await refreshProjects();
          pushStatus(pinnedCreatedMessage(name));
          return;
        }
        const { activeId, projects: list } = await api.listProjects();
        setProjects(list);
        // Troca automaticamente para o novo projeto
        await switchProject(activeId !== currentProjectId ? activeId : list[list.length - 1]?.id ?? activeId);
      } catch (e: unknown) {
        pushStatus(`Erro ao criar projeto: ${(e as Error)?.message ?? e}`);
      }
    },
    [currentProjectId, switchProject, pinnedProjectId, refreshProjects],
  );

  const handleRenameProject = useCallback(
    async (id: string, name: string) => {
      try {
        await api.renameProject(id, name);
        await refreshProjects();
      } catch (e: unknown) {
        pushStatus(`Erro ao renomear projeto: ${(e as Error)?.message ?? e}`);
      }
    },
    [refreshProjects],
  );

  const handleDuplicateProject = useCallback(
    async (id: string, name?: string) => {
      try {
        const meta = await api.duplicateProject(id, name);
        await refreshProjects();
        await switchProject(meta.id);
      } catch (e: unknown) {
        pushStatus(`Erro ao duplicar projeto: ${(e as Error)?.message ?? e}`);
      }
    },
    [refreshProjects, switchProject],
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      try {
        await api.deleteProject(id);
        const { activeId, projects: list } = await api.listProjects();
        setProjects(list);
        if (id === currentProjectId) {
          await switchProject(activeId);
        }
      } catch (e: unknown) {
        pushStatus(`Erro ao excluir projeto: ${(e as Error)?.message ?? e}`);
      }
    },
    [currentProjectId, switchProject],
  );

  const handleExportOption = (opt: api.ExportOption) => {
    run(`Exportando ${opt.label}`, async () => {
      const result = await api.exportFormat(dbml, opt.format, opt.dialect);
      const files = result.files.join(', ');
      if (opt.format === 'localdrawdb') {
        const l2Warn = exportInputL2Warning(
          activeModel.tables,
          activeModel.lineageFields ?? [],
          activeModel.lineage ?? [],
        );
        return l2Warn ? `${l2Warn} — Gerado: ${files}` : `Gerado: ${files}`;
      }
      return `Gerado: ${files}`;
    });
  };

  const addTable = () => {
    const name = prompt('Nome da nova tabela (schema.tabela):', 'novo_schema.nova_tabela');
    if (!name?.trim()) return;
    const tableId = name.trim();
    const dup = findDuplicateTableId(tableId, activeModel.tables.map((t) => t.id));
    if (dup) {
      pushStatus(`Tabela "${dup}" já existe — escolha outro nome.`);
      return;
    }
    mutateDbml((d) => d + newTableTemplate(tableId));
    setPositions((prev) => ({
      ...prev,
      [tableId]: defaultTablePosition(prev),
    }));
    focusTableWithPan(tableId);
    pushStatus(`Tabela criada: ${tableId}`);
    setSaveState('dirty');
  };

  const addMetadata = () =>
    setDbml(
      (d) =>
        d +
        `\n// metadados padrão (cole dentro de uma Table):\n/*\n${METADATA_SNIPPET}\n*/\n`,
    );

  const handleOrganize = () => {
    setDbml((d) => organize(d));
    pushStatus('Organizado: tabelas → refs → records');
  };

  const saveFromPalette = useCallback(() => {
    const { openedModal, reconciledDbml } = handleEditorCommit();
    if (openedModal) {
      pushStatus('Confirme a renomeação antes de salvar');
      return;
    }
    handleSave(reconciledDbml ?? undefined);
  }, [handleEditorCommit, handleSave, pushStatus]);

  const paletteActions = useMemo<CommandAction[]>(
    () => [
      {
        id: 'action:save',
        label: 'Salvar',
        shortcut: 'Cmd/Ctrl+S',
        keywords: ['salvar projeto', 'save'],
        run: saveFromPalette,
      },
      {
        id: 'action:organize-dbml',
        label: 'Organizar DBML',
        keywords: ['organize', 'refs', 'records'],
        run: handleOrganize,
      },
      {
        id: 'action:organize-canvas',
        label: 'Organizar canvas',
        keywords: ['autolayout', 'layout', 'cluster'],
        run: () => handleAutolayout(),
      },
      ...api.EXPORT_OPTIONS.map((opt) => ({
        id: `action:export:${opt.id}`,
        label: `Exportar ${opt.label}`,
        keywords: ['exportar', opt.format, opt.dialect ?? ''],
        run: () => handleExportOption(opt),
      })),
      {
        id: 'action:import',
        label: 'Importar (input/)',
        keywords: ['importar', 'input'],
        run: handleImport,
      },
      {
        id: 'action:undo',
        label: 'Undo',
        shortcut: 'Cmd/Ctrl+Z',
        keywords: ['desfazer', 'undo'],
        run: undo,
      },
      {
        id: 'action:redo',
        label: 'Redo',
        shortcut: 'Cmd/Ctrl+Shift+Z',
        keywords: ['refazer', 'redo'],
        run: redo,
      },
      {
        id: 'action:toggle-autosave',
        label: autoSave ? 'Desligar Auto-save' : 'Ligar Auto-save',
        keywords: ['autosave', 'auto save'],
        run: () => setAutoSave((value) => !value),
      },
      {
        id: 'action:toggle-lineage-mode',
        label: 'Alternar modo linhagem',
        keywords: ['linhagem', 'lineage mode'],
        run: () => useInteraction.getState().toggleLineageMode(),
      },
      {
        id: 'action:toggle-layers-panel',
        label: layersPanelCollapsed ? 'Abrir painel Camadas' : 'Fechar painel Camadas',
        keywords: ['camadas', 'layers panel'],
        run: () => setLayersPanelCollapsed((value) => !value),
      },
      {
        id: 'action:toggle-records-panel',
        label: recordsPanelOpen ? 'Fechar painel Dados' : 'Abrir painel Dados',
        keywords: ['dados', 'records panel'],
        run: () => setRecordsPanelOpen((value) => !value),
      },
      {
        id: 'action:toggle-problems-panel',
        label: problemsPanelOpen ? 'Fechar painel Problemas' : 'Abrir painel Problemas',
        keywords: ['problemas', 'issues panel'],
        run: () => setProblemsPanelOpen((value) => !value),
      },
    ],
    [
      autoSave,
      handleAutolayout,
      handleExportOption,
      handleImport,
      handleOrganize,
      layersPanelCollapsed,
      problemsPanelOpen,
      recordsPanelOpen,
      redo,
      saveFromPalette,
      undo,
    ],
  );

  const paletteCommands = useMemo(
    () =>
      buildCommands({
        tables: activeModel.tables.map((table) => ({ id: table.id, name: table.name, schema: table.schema })),
        columns: activeModel.tables.flatMap((table) =>
          table.columns.map((field) => ({ tableId: table.id, columnName: field.name })),
        ),
        actions: paletteActions,
        onFocusTable: focusTableInEditor,
        onFocusColumn: focusColumn,
      }),
    [activeModel.tables, focusTableInEditor, focusColumn, paletteActions],
  );

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const helpShortcuts = useMemo(
    () => shortcutsFromCommands(paletteCommands, isMac),
    [paletteCommands, isMac],
  );

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">LocalDrawDB</strong>
        {projects.length > 0 && (
          <ProjectSwitcher
            projects={projects}
            currentProjectId={currentProjectId}
            saveState={saveState}
            onSwitch={switchProject}
            onCreate={handleCreateProject}
            onRename={handleRenameProject}
            onDuplicate={handleDuplicateProject}
            onDelete={handleDeleteProject}
            pinnedLabel={pinnedProjectId ? projects.find((p) => p.id === pinnedProjectId)?.name : undefined}
          />
        )}
        <Tooltip label="Desfazer (Cmd/Ctrl+Z)">
          <button onClick={undo} disabled={!past.length} aria-label="Desfazer">
            <Undo className="icon-inline" />
          </button>
        </Tooltip>
        <Tooltip label="Refazer (Cmd/Ctrl+Shift+Z)">
          <button onClick={redo} disabled={!future.length} aria-label="Refazer">
            <Redo className="icon-inline" />
          </button>
        </Tooltip>
        <Tooltip label="Reordena: tabelas → refs → records">
          <button onClick={handleOrganize}>Organizar DBML</button>
        </Tooltip>
        <button onClick={addTable}>+ Tabela</button>
        <Tooltip label="Insere o bloco de colunas de metadados padrão">
          <button onClick={addMetadata}>+ Metadados</button>
        </Tooltip>
        <span className="sep" />
        <button onClick={handleImport}>Importar (input/)</button>
        <ExportMenu
          options={[...api.EXPORT_OPTIONS]}
          onExport={handleExportOption}
        />
        <Tooltip label="Buscar comandos e tabelas (Cmd/Ctrl+K)">
          <button
            type="button"
            className="toolbar__palette-btn"
            onClick={() => setPaletteOpen(true)}
          >
            <Search className="icon-inline" size={14} /> Buscar
          </button>
        </Tooltip>
        <Tooltip label="Diff entre DBML salvo e em memória">
          <button
            type="button"
            className="toolbar__diff-btn"
            aria-label="Diff DBML"
            onClick={() => setDiffOpen((v) => !v)}
          >
            Diff
          </button>
        </Tooltip>
        <span className="sep" />
        <button
          className={`btn-save btn-save--${saveState}`}
          onClick={() => handleSave()}
          disabled={saveState === 'saving' || saveState === 'saved'}
          title="Salvar (Cmd/Ctrl+S)"
        >
          {saveState === 'saving' ? 'Salvando…'
            : saveState === 'saved' ? 'Salvo'
            : saveState === 'error' ? 'Erro'
            : 'Salvar'}
        </button>
        <span className="toolbar__autosave">
          <span className="toolbar__autosave-label">Auto-salvar</span>
          <Tooltip label={autoSave ? 'Auto-salvar ligado' : 'Auto-salvar desligado'}>
            <button
              type="button"
              role="switch"
              aria-checked={autoSave}
              className={`toggle-switch ${autoSave ? 'is-on' : ''}`}
              onClick={() => setAutoSave((a) => !a)}
            >
              <span className="toggle-switch__knob" />
            </button>
          </Tooltip>
        </span>
        <ProblemsPanel
          issues={modelIssues}
          onFocusTable={focusTableWithPan}
          onGoToLine={goToLine}
          open={problemsPanelOpen}
          onOpenChange={setProblemsPanelOpen}
        />
        <StatusLog status={status} saveState={saveState} logs={logs} />
      </header>

      <main
        ref={panesRef}
        className={`panes ${editorCollapsed ? 'panes--editor-collapsed' : ''}${resizingEditor ? ' panes--resizing' : ''}`}
      >
        <section
          className="pane pane--editor"
          style={editorWidth && !editorCollapsed ? { width: editorWidth } : undefined}
        >
          <button
            type="button"
            className="pane-collapse"
            onClick={() => setEditorCollapsed((c) => !c)}
            title={editorCollapsed ? 'Mostrar editor DBML' : 'Ocultar editor DBML'}
            aria-label={editorCollapsed ? 'Mostrar editor DBML' : 'Ocultar editor DBML'}
            aria-expanded={!editorCollapsed}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              {editorCollapsed ? (
                <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
          <Suspense
            fallback={(
              <div className="editor editor--loading" aria-hidden>
                <div className="editor-skeleton__outline" />
                <div className="editor-skeleton__body">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          >
            <Editor
              ref={editorRef}
              value={dbml}
              onChange={handleDbmlChange}
              onCommit={handleEditorCommit}
              error={parsed.error}
              errorLine={parsed.errorLine}
              onFocusTable={focusTableWithPan}
              onCursorLine={handleEditorCursorLine}
              onGoToError={() => setEditorCollapsed(false)}
            />
          </Suspense>
        </section>
        {!editorCollapsed && (
          <div
            className="pane-resizer"
            onMouseDown={startEditorResize}
            title="Arraste para redimensionar o editor"
            role="separator"
            aria-orientation="vertical"
          />
        )}
        <section className="pane pane--canvas">
          <button
            type="button"
            className="canvas-help-btn"
            title="Atalhos e gestos (?)"
            aria-label="Atalhos e gestos"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
          <CanvasActionsCtx.Provider value={actions}>
            <Canvas
              parsed={canvasActiveModel}
              nodeExtras={nodeExtras}
              positions={positions}
              sizes={sizes}
              onPositionsChange={setPositions}
              onCreateRef={handleCreateRef}
              onRemoveRef={handleRemoveRef}
              onRemoveTable={handleRemoveTable}
              onRemoveTables={handleRemoveTables}
              staleWarning={!!parsed.error || canvasParsePending}
              lineage={canvasLineage}
              lineageFields={canvasActiveModel.lineageFields ?? []}
              onCreateLineage={handleCreateLineage}
              onRemoveLineage={handleRemoveLineage}
              onRemoveFieldLineage={handleRemoveFieldLineage}
              onCreateFieldLineage={handleCreateFieldLineage}
              layerOf={layerOf}
              collapsedGroups={collapsedGroups}
              onToggleGroup={handleToggleGroup}
              focusTableId={focusTableId}
              focusNonce={focusNonce}
              onFocusTableDone={clearFocusTable}
              onTableClick={focusTableInEditor}
              fitViewTrigger={fitViewTrigger}
              externalStubs={canvasStubs}
              crossRefs={canvasView.crossRefs}
            />
            <CanvasLeftDock>
              <ColumnPanel
                dbml={dbml}
                tables={activeModel.tables}
                onApply={(next) => {
                  prevDbmlRef.current = next;
                  setDbml(next);
                }}
                onRenameColumn={(table, oldName, newName) => {
                  setDbml((d) => {
                    const next = renameColumnAllRefs(d, table, oldName, newName);
                    prevDbmlRef.current = next;
                    return next;
                  });
                  selectColumn({ table, column: newName });
                }}
                onGoToColumn={goToColumn}
                mappings={activeModel.lineageFields ?? []}
                onAddMapping={handleAddFieldLineage}
                onUpdateMapping={handleUpdateFieldLineage}
                onRemoveMapping={(st, sc, tc) => {
                  const tt = useInteraction.getState().selectedTable;
                  if (tt) handleRemoveFieldLineage(st, sc, tt, tc);
                }}
              />
            </CanvasLeftDock>
            <PageImportWizard
              open={pageWizardOpen}
              tableCount={pageWizardTableCount}
              pages={canvasPages}
              onConfirm={(pageIds) => {
                setActivePageIds(pageIds);
                setPageWizardOpen(false);
                const names = pageIds.includes(ALL_PAGE_ID)
                  ? 'todas'
                  : pageIds
                      .map((id) => canvasPages.find((p) => p.id === id)?.name ?? id)
                      .join(', ');
                pushStatus(`${pageWizardTableCount} tabelas — canvas: ${names}`);
              }}
              onDismiss={() => {
                setActivePageIds([]);
                setPageWizardOpen(false);
              }}
            />
            <LayersPanel
              layers={layersArr}
              tables={activeModel.tables.map((t) => ({ id: t.id }))}
              onAddLayer={actions.onAddLayer}
              onFocusTable={focusTableWithPan}
              onAutolayout={handleAutolayout}
              pages={canvasPages}
              activePageIds={activePageIds}
              onChangeActivePages={handleChangeActivePages}
              collapsed={layersPanelCollapsed}
              onCollapsedChange={setLayersPanelCollapsed}
            />
          </CanvasActionsCtx.Provider>
          <RecordsPanel
            records={activeModel.records}
            tables={activeModel.tables}
            refs={activeModel.refs}
            dbml={dbml}
            onApply={(next) => {
              prevDbmlRef.current = next;
              setDbml(next);
              setSaveState('dirty');
            }}
            open={recordsPanelOpen}
            onOpenChange={setRecordsPanelOpen}
          />
        </section>
      </main>
      <CommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
      />
      <DbmlDiff
        open={diffOpen}
        saved={baselineRef.current?.dbml ?? ''}
        working={dbml}
        onClose={() => setDiffOpen(false)}
      />
      <ShortcutsOverlay
        open={helpOpen}
        shortcuts={helpShortcuts}
        gestures={CANVAS_GESTURES}
        onClose={() => setHelpOpen(false)}
      />
      {pendingRename && (
        <RenameConfirmModal
          impacts={pendingRename.impacts}
          onApply={() => {
            const { dbml: out, appliedRefCount } = applyRenames(
              pendingRename.buffer,
              pendingRename.impacts,
              migrateTableId,
            );
            prevDbmlRef.current = out;
            setDbml(out);
            pushStatus(`Edição aplicada (${appliedRefCount} refs atualizadas)`);
            setPendingRename(null);
          }}
          onKeepSeparate={() => {
            // Mantém filhas herdadas com o nome atual, registrando-as como rolenames.
            // Reutiliza applyRenames com keepSeparateKeyRename para colunas-chave.
            const { dbml: out } = applyRenames(pendingRename.buffer, pendingRename.impacts, migrateTableId, keepSeparateKeyRename);
            prevDbmlRef.current = out;
            setDbml(out);
            pushStatus('Rolenames registrados — filhas mantêm nome próprio');
            setPendingRename(null);
          }}
          onClose={() => setPendingRename(null)}
        />
      )}
    </div>
  );
}
