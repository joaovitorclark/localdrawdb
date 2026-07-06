// Store de estado efêmero/visual do canvas (padrão Structura).
// O documento (DBML em texto) NÃO mora aqui — só o que é interação/apresentação.
import { create } from 'zustand';

export type SelectedColumn = { table: string; column: string } | null;

export type FieldMappingFocus = {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
};

type InteractionState = {
  hoveredTableId: string | null;
  setHovered: (id: string | null) => void;
  selectedColumn: SelectedColumn;
  selectColumn: (sel: SelectedColumn) => void;
  selectedTable: string | null;
  selectedTableIds: string[];
  selectTable: (id: string | null) => void;
  setSelectedTableIds: (ids: string[]) => void;
  selectedGroup: string | null;
  selectGroup: (id: string | null) => void;
  clearCanvasSelection: () => void;

  // Layers (v4): camadas ESCONDIDAS (default vazio = todas visíveis) + modo.
  hiddenLayers: Set<string>;
  toggleLayer: (id: string) => void;
  layerDimMode: boolean;
  toggleDimMode: () => void;

  // Linhagem: visualizar arestas vs editar (portas nas bordas).
  lineageVisible: boolean;
  toggleLineageVisible: () => void;
  lineageMode: boolean;
  toggleLineageMode: () => void;

  // FK/Ref (constraints) no canvas — independente de linhagem L1.
  relationsVisible: boolean;
  toggleRelationsVisible: () => void;

  // Linhagem campo-a-campo (v9): arestas visuais opcionais.
  fieldLineageVisible: boolean;
  toggleFieldLineageVisible: () => void;
  focusedFieldMapping: FieldMappingFocus | null;
  setFocusedFieldMapping: (m: InteractionState['focusedFieldMapping']) => void;
  /** Incrementa ao focar mapeamento no painel (pan no canvas). */
  fieldMappingFocusNonce: number;
  focusFieldMapping: (m: FieldMappingFocus) => void;
  /** Clique numa aresta L2 no canvas (modo linhagem): foca, seleciona tabela destino e abre painel. */
  selectFieldLineageMapping: (m: FieldMappingFocus) => void;
  mappingPanelOpen: boolean;
  toggleMappingPanel: () => void;
};

export const useInteraction = create<InteractionState>((set) => ({
  hoveredTableId: null,
  setHovered: (id) => set({ hoveredTableId: id }),
  selectedColumn: null,
  selectColumn: (sel) =>
    set({
      selectedColumn: sel,
      // Selecionar uma coluna também seleciona a tabela dela (#7b): borda verde + dados.
      ...(sel ? { selectedTable: sel.table, selectedTableIds: [sel.table], selectedGroup: null } : {}),
    }),
  selectedTable: null,
  selectedTableIds: [],
  selectTable: (id) =>
    set({
      selectedTable: id,
      selectedTableIds: id ? [id] : [],
      selectedGroup: null,
      selectedColumn: null,
    }),
  setSelectedTableIds: (ids) =>
    set({
      selectedTableIds: ids,
      selectedTable: ids[0] ?? null,
      selectedGroup: null,
    }),
  selectedGroup: null,
  selectGroup: (id) =>
    set({ selectedGroup: id, selectedTable: null, selectedTableIds: [], selectedColumn: null }),
  clearCanvasSelection: () =>
    set({ selectedTable: null, selectedTableIds: [], selectedGroup: null, focusedFieldMapping: null }),

  hiddenLayers: new Set<string>(),
  toggleLayer: (id) =>
    set((s) => {
      const next = new Set(s.hiddenLayers);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { hiddenLayers: next };
    }),
  layerDimMode: true,
  toggleDimMode: () => set((s) => ({ layerDimMode: !s.layerDimMode })),

  lineageVisible: false,
  toggleLineageVisible: () => set((s) => ({ lineageVisible: !s.lineageVisible })),
  lineageMode: false,
  toggleLineageMode: () =>
    set((s) => {
      const next = !s.lineageMode;
      return {
        lineageMode: next,
        relationsVisible: next ? false : s.relationsVisible,
      };
    }),

  relationsVisible: true,
  toggleRelationsVisible: () => set((s) => ({ relationsVisible: !s.relationsVisible })),

  fieldLineageVisible: false,
  toggleFieldLineageVisible: () => set((s) => ({ fieldLineageVisible: !s.fieldLineageVisible })),
  focusedFieldMapping: null,
  setFocusedFieldMapping: (m) => set({ focusedFieldMapping: m }),
  fieldMappingFocusNonce: 0,
  focusFieldMapping: (m) =>
    set((s) => ({
      focusedFieldMapping: m,
      fieldLineageVisible: true,
      fieldMappingFocusNonce: s.fieldMappingFocusNonce + 1,
    })),
  selectFieldLineageMapping: (m) =>
    set((s) => ({
      selectedTable: m.targetTable,
      selectedTableIds: [m.targetTable],
      // Abre o ColumnPanel no campo destino (mapeamento unificado no menu do campo).
      selectedColumn: { table: m.targetTable, column: m.targetColumn },
      selectedGroup: null,
      focusedFieldMapping: m,
      fieldLineageVisible: true,
      fieldMappingFocusNonce: s.fieldMappingFocusNonce + 1,
      mappingPanelOpen: true,
    })),
  mappingPanelOpen: false,
  toggleMappingPanel: () => set((s) => ({ mappingPanelOpen: !s.mappingPanelOpen })),
}));
