// Renderiza o diagrama (tabelas + colunas + FKs) como SVG puro.
// Usado pelo export PNG (Canvas API rasteriza) e pode ser exportado
// diretamente como .svg.

import type { ParseResult, TableView, ColumnView, RefView } from '../dsl/parse';

export type ExportScope = 'full' | 'selection';

export type ExportInput = {
  parsed: ParseResult;
  positions: Record<string, { x: number; y: number }>;
  /** Cores do cabeçalho por tabela (id → hex). */
  colors?: Record<string, string>;
  /** IDs selecionados (só usado quando scope === 'selection'). */
  selectedIds?: Set<string>;
  scope: ExportScope;
};

export type SvgExport = { svg: string; width: number; height: number };

const HEADER_H = 26;
const ROW_H = 20;
const TABLE_PAD_X = 10;
const COL_GAP_X = 14;
const FONT_FAMILY = 'monospace, "Courier New", monospace';
const FONT_SIZE = 11;
const DEFAULT_HEADER_COLOR = '#13284b';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Largura estimada de uma tabela baseada no nome + tipos das colunas. */
function estimateTableWidth(table: TableView): number {
  let max = (table.schema ? table.schema.length + 1 : 0) + table.name.length;
  for (const c of table.columns) {
    const len = c.name.length + c.type.length + 4;
    if (len > max) max = len;
  }
  // 1 char monospace ~ 7px a 11px.
  const charW = 7;
  return Math.max(180, Math.min(360, max * charW + TABLE_PAD_X * 2 + 24));
}

/** Altura estimada de uma tabela. */
function estimateTableHeight(table: TableView): number {
  return HEADER_H + table.columns.length * ROW_H + 4;
}

function renderHeader(table: TableView, x: number, y: number, w: number, color: string): string {
  const title = table.schema ? `${table.schema}.${table.name}` : table.name;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${HEADER_H}" fill="${color}" />
    <text x="${x + TABLE_PAD_X}" y="${y + HEADER_H / 2 + 4}" fill="#fff" font-family='${FONT_FAMILY}' font-size="${FONT_SIZE}" font-weight="700">${escapeXml(title)}</text>
  `;
}

function renderColumn(
  col: ColumnView,
  tableId: string,
  x: number,
  y: number,
  w: number,
  rowIdx: number,
): string {
  const bg = rowIdx % 2 === 1 ? '#f8fafc' : '#ffffff';
  const typeColor = '#475569';
  const badges: string[] = [];
  if (col.pk) badges.push('PK');
  if (col.notNull) badges.push('NN');
  const badgeStr = badges.length ? ` [${badges.join(', ')}]` : '';
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="${bg}" />
    <text x="${x + TABLE_PAD_X}" y="${y + ROW_H / 2 + 4}" fill="${col.color || '#0f172a'}" font-family='${FONT_FAMILY}' font-size="${FONT_SIZE}">${escapeXml(col.name)}${escapeXml(badgeStr)}</text>
    <text x="${x + w - TABLE_PAD_X}" y="${y + ROW_H / 2 + 4}" fill="${typeColor}" font-family='${FONT_FAMILY}' font-size="${FONT_SIZE}" text-anchor="end">${escapeXml(col.type)}</text>
  `;
}

function renderTable(table: TableView, x: number, y: number, w: number, color: string): string {
  const h = estimateTableHeight(table);
  let cols = '';
  cols += renderHeader(table, x, y, w, color);
  cols += `<rect x="${x}" y="${y + HEADER_H}" width="${w}" height="${h - HEADER_H}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1" />`;
  table.columns.forEach((c, i) => {
    cols += renderColumn(c, table.id, x, y + HEADER_H + i * ROW_H, w, i);
  });
  // Bordas verticais entre PK e type (opcional, aqui só linha esquerda)
  cols += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#475569" stroke-width="1" rx="4" ry="4" />`;
  return cols;
}

function renderRef(
  ref: RefView,
  sourceTable: TableView,
  targetTable: TableView,
  positions: Record<string, { x: number; y: number }>,
  widths: Record<string, number>,
): string | null {
  const sp = positions[sourceTable.id];
  const tp = positions[targetTable.id];
  if (!sp || !tp) return null;
  const sw = widths[sourceTable.id] ?? 200;
  // Calcula Y da coluna source e target dentro da tabela.
  const sourceIdx = sourceTable.columns.findIndex((c) => c.name === ref.fromCol);
  const targetIdx = targetTable.columns.findIndex((c) => c.name === ref.toCol);
  const sourceRow = sourceIdx >= 0 ? sourceIdx : 0;
  const targetRow = targetIdx >= 0 ? targetIdx : 0;
  const ySource = sp.y + HEADER_H + sourceRow * ROW_H + ROW_H / 2;
  const yTarget = tp.y + HEADER_H + targetRow * ROW_H + ROW_H / 2;
  // Origem: borda direita da tabela source, na linha da coluna source.
  const x1 = sp.x + sw;
  const y1 = ySource;
  // Destino: borda esquerda da tabela target, na linha da coluna target.
  const x2 = tp.x;
  const y2 = yTarget;
  // Curva suave tipo cubic-bezier (igual ao React Flow).
  const dx = Math.max(40, (x2 - x1) / 2);
  return `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" stroke="#64748b" stroke-width="1.2" fill="none" marker-end="url(#arrow)" />`;
}

export function renderDiagramSvg(input: ExportInput): SvgExport {
  const { parsed, positions, colors = {}, selectedIds, scope } = input;

  // Filtra tabelas pelo scope.
  const tables = parsed.tables.filter((t) =>
    scope === 'full' ? true : selectedIds?.has(t.id) ?? false,
  );
  if (!tables.length) {
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>', width: 200, height: 100 };
  }

  // Calcula dimensões de cada tabela para layout (largura/altura).
  const widths: Record<string, number> = {};
  const heights: Record<string, number> = {};
  for (const t of tables) {
    widths[t.id] = estimateTableWidth(t);
    heights[t.id] = estimateTableHeight(t);
  }

  // Bounds considerando posição + tamanho.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const t of tables) {
    const p = positions[t.id] ?? { x: 0, y: 0 };
    const w = widths[t.id];
    const h = heights[t.id];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + w > maxX) maxX = p.x + w;
    if (p.y + h > maxY) maxY = p.y + h;
  }
  const padding = 24;
  const offsetX = -minX + padding;
  const offsetY = -minY + padding;
  const width = Math.ceil(maxX - minX + padding * 2);
  const height = Math.ceil(maxY - minY + padding * 2);

  // Renderiza refs (apenas entre tabelas do scope).
  const tableMap = new Map(tables.map((t) => [t.id, t]));
  const refsSvg = parsed.refs
    .filter((r) => tableMap.has(r.source) && tableMap.has(r.target))
    .map((r) => renderRef(r, tableMap.get(r.source)!, tableMap.get(r.target)!, positions, widths))
    .filter((s): s is string => s !== null)
    .join('');

  // Renderiza tabelas.
  const tablesSvg = tables
    .map((t) => {
      const p = positions[t.id] ?? { x: 0, y: 0 };
      const w = widths[t.id];
      const h = heights[t.id];
      const color = colors[t.id] ?? DEFAULT_HEADER_COLOR;
      const tx = p.x + offsetX;
      const ty = p.y + offsetY;
      return `<g transform="translate(${tx}, ${ty})">${renderTable(t, 0, 0, w, color)}</g>`;
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
      </marker>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
    ${refsSvg}
    ${tablesSvg}
  </svg>`;
  return { svg, width, height };
}

/** Converte SVG para PNG via Canvas API. */
export async function svgToPngDataUrl(
  svg: string,
  width: number,
  height: number,
  pixelRatio = 2,
): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D não disponível');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}