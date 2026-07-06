// Contexto com as ações que mutam o documento/cores/layers, consumidas por nós
// profundos (TableNode/GroupNode) sem prop-drilling pelo React Flow.
import { createContext, useContext } from 'react';
import type { Layer } from '../api';
import type { TableView } from '../dsl/parse';

export type TableMeta = {
  sources: string[]; // linhagem: tabelas de origem
  sample: { columns: string[]; rows: string[][] } | null;
  pks: string[];
  fks: { column: string; ref: string }[];
  refsIn: string[]; // referenciada por
  note?: string;
  columnNotes: { column: string; note: string }[];
  // ---- Metadados dbt ----
  resourceType?: 'model' | 'source' | 'seed' | 'snapshot';
  materialization?: 'table' | 'view' | 'incremental' | 'ephemeral';
  tags?: string[];
  has: boolean; // tem algum metadado?
};

export type CanvasActions = {
  onSelectColumn: (table: string, column: string) => void;
  onRenameColumn: (table: string, oldName: string, newName: string) => void;
  onGoToColumn?: (table: string, column: string) => void;
  onRenameTable: (tableId: string, newName: string) => void;
  onRemoveTable: (tableId: string) => void;
  onAddColumn: (table: string) => void;
  colorOf: (tableId: string) => string | undefined;
  onSetColor: (tableId: string, color: string | null) => void;
  /** Cor da caixa de um TableGroup. */
  onSetGroupColor: (group: string, color: string | null) => void;
  /** Dimensões ao redimensionar a tabela (arrastar o canto inferior-direito). */
  onResizeTable: (tableId: string, width: number, height?: number) => void;
  // layers
  layerOf: (tableId: string) => string | undefined;
  layerColorOf: (layerId?: string) => string | undefined;
  onSetLayer: (tableId: string, layerId: string | null) => void;
  layers: Layer[];
  onAddLayer: (name: string, color: string) => void;
  // grupos
  onToggleGroup: (name: string) => void;
  // metadados
  tableMeta: (tableId: string) => TableMeta;
};

/**
 * Dados de render do nó de tabela: o `TableView` + cor de cabeçalho e metadados já
 * resolvidos. Pré-computar no App (em vez de chamar `actions.*` durante o render)
 * permite memoizar `TableNode` por identidade de `data`, evitando re-render de todas
 * as tabelas a cada keystroke.
 */
export type ExternalLinkBadge = {
  stubId: string;
  label: string;
  count: number;
  direction: 'out' | 'in';
};

export type TableNodeData = TableView & {
  headerColor: string;
  meta: TableMeta;
  /** Ligações resumidas para grupos fora da página (chips no topo). */
  externalLinks?: ExternalLinkBadge[];
  /** Colunas com aresta FK/L2 (scroll automático no cartão). */
  linkedColumns?: string[];
};

export const CanvasActionsCtx = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions {
  const ctx = useContext(CanvasActionsCtx);
  if (!ctx) throw new Error('CanvasActionsCtx ausente');
  return ctx;
}

/** Paleta de cores para o cabeçalho das tabelas (Unimed + neutros). */
export const TABLE_COLORS = [
  '#13284b', '#1c3a6b', '#0e7490', '#00995d', '#15803d', '#a16207',
  '#b5651d', '#b08d57', '#b91c1c', '#be185d', '#6b21a8', '#475569',
];
