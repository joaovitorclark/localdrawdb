// Cliente da API /api (mesma origem em prod; proxy do Vite em dev).

/**
 * Normaliza fins de linha do DBML para `\n` ao carregar (choke point único).
 * No Windows o arquivo pode vir com CRLF; manter LF em memória evita bugs de rename
 * (regexes de campo/diff assumem `\n`). O primeiro save reescreve o arquivo em LF.
 */
const normalizeDbmlEol = (dbml: string): string => dbml.replace(/\r\n?/g, '\n');

export type Project = { dbml: string; canvas: CanvasState };
export type Layer = { id: string; name: string; color: string };
export type LineageLink = { source: string; target: string };

/** Dimensões por tabela quando redimensionada (px). Ambas opcionais. */
export type TableSize = { width?: number; height?: number };

/**
 * Migra o formato legado de `sizes` (número = só largura) para `{ width, height }`.
 * Choke point único no load; evita repetir a migração em cada `setSizes`.
 */
export function normalizeSizes(
  raw: Record<string, number | TableSize> | undefined,
): Record<string, TableSize> {
  const out: Record<string, TableSize> = {};
  if (!raw) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v === 'number') out[id] = { width: v };
    else if (v && typeof v === 'object') {
      const s: TableSize = {};
      if (typeof v.width === 'number') s.width = v.width;
      if (typeof v.height === 'number') s.height = v.height;
      out[id] = s;
    }
  }
  return out;
}

export type CanvasPage = {
  id: string;
  name: string;
  /** TableGroup names; ALL_PAGE_ID = todas; UNGROUPED_PAGE_ID = sem grupo. */
  tableGroups: string[];
};

export type CanvasState = {
  positions?: Record<string, { x: number; y: number }>;
  /** Dimensões por tabela quando redimensionada (px). Aceita número legado (só largura). */
  sizes?: Record<string, number | TableSize>;
  colors?: Record<string, string>;
  layers?: Record<string, string>; // tableId -> layerId
  customLayers?: Layer[];
  lineage?: LineageLink[];
  collapsedGroups?: string[];
  pages?: CanvasPage[];
  /** Páginas visíveis no canvas (ids de CanvasPage). ALL_PAGE_ID = todas. */
  activePageIds?: string[];
  /** @deprecated use activePageIds */
  activePageId?: string | null;
};

export type ProjectMeta = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export type Meta = {
  root: string;
  dataDir: string;
  inputDir: string;
  port: number;
  pinnedProject: string | null;
  pinnedProjectId: string | null;
};

export type ExportFormat =
  | 'localdrawdb'
  | 'spark-ddl'
  | 'oracle-ddl'
  | 'postgres-ddl'
  | 'erwin'
  | 'dbt'
  | 'mermaid';

export type InputDialect = 'spark' | 'oracle' | 'auto';

export type ExportOption = {
  id: string;
  label: string;
  format: ExportFormat;
  dialect?: 'spark' | 'oracle';
};

export const EXPORT_OPTIONS: ExportOption[] = [
  { id: 'localdrawdb-spark', label: 'LocalDrawDB (Spark)', format: 'localdrawdb', dialect: 'spark' },
  { id: 'localdrawdb-oracle', label: 'LocalDrawDB (Oracle)', format: 'localdrawdb', dialect: 'oracle' },
  { id: 'spark-ddl', label: 'Spark DDL', format: 'spark-ddl' },
  { id: 'oracle-ddl', label: 'Oracle DDL', format: 'oracle-ddl' },
  { id: 'postgres-ddl', label: 'PostgreSQL DDL', format: 'postgres-ddl' },
  { id: 'erwin', label: 'erwin (ANSI)', format: 'erwin' },
  { id: 'dbt', label: 'dbt', format: 'dbt' },
  { id: 'mermaid', label: 'Mermaid', format: 'mermaid' },
];

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${url} -> ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) detail += `: ${j.error}`;
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `${url} -> ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) detail += `: ${j.error}`;
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${url} -> ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) detail += `: ${j.error}`;
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${url} -> ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) detail += `: ${j.error}`;
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    let detail = `${url} -> ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) detail += `: ${j.error}`;
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function loadProject(): Promise<Project> {
  const res = await fetch('/api/project');
  const j = (await res.json()) as { dbml: string; canvas: CanvasState };
  const canvas = j.canvas ?? {};
  return { dbml: normalizeDbmlEol(j.dbml ?? ''), canvas: { ...canvas, sizes: normalizeSizes(canvas.sizes) } };
}

export async function saveProject(dbml: string, canvas: CanvasState): Promise<void> {
  const res = await fetch('/api/project', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dbml, canvas }),
  });
  if (!res.ok) throw new Error(`save -> ${res.status}`);
}

// --- API multi-projetos (F2) ---

export const getMeta = (): Promise<Meta> => get('/api/meta');

export const listProjects = (): Promise<{ activeId: string; projects: ProjectMeta[] }> =>
  get('/api/projects');

export const createProject = (name: string): Promise<ProjectMeta> =>
  post('/api/projects', { name });

export const renameProject = (id: string, name: string): Promise<void> =>
  patch<{ ok: boolean }>(`/api/projects/${id}`, { name }).then(() => {});

export const deleteProject = (id: string): Promise<void> =>
  del<{ ok: boolean }>(`/api/projects/${id}`).then(() => {});

export const duplicateProject = (id: string, name?: string): Promise<ProjectMeta> =>
  post(`/api/projects/${id}/duplicate`, { name });

export const activateProject = (id: string): Promise<void> =>
  post<{ ok: boolean; activeId: string }>(`/api/projects/${id}/activate`, {}).then(() => {});

export async function loadProjectById(id: string): Promise<Project> {
  const j = await get<{ dbml: string; canvas: CanvasState }>(`/api/projects/${id}`);
  const canvas = j.canvas ?? {};
  return { dbml: normalizeDbmlEol(j.dbml ?? ''), canvas: { ...canvas, sizes: normalizeSizes(canvas.sizes) } };
}

export const saveProjectById = (id: string, dbml: string, canvas: CanvasState): Promise<void> =>
  put<{ ok: boolean }>(`/api/projects/${id}`, { dbml, canvas }).then(() => {});

export const importFromInputForProject = (id: string, dbml: string) =>
  post<{ dbml: string; imported: string[]; lineageFieldCount?: number; warnings?: string[] }>(
    `/api/projects/${id}/import`,
    { dbml },
  );

export const importFromInput = (dbml: string) =>
  post<{ dbml: string; imported: string[]; lineageFieldCount?: number; warnings?: string[] }>(
    '/api/import',
    { dbml },
  );

export function exportFormat(
  dbml: string,
  format: ExportFormat,
  dialect?: 'spark' | 'oracle',
) {
  return post<{ files: string[] }>('/api/export', { dbml, format, dialect });
}

export const exportDdl = (dbml: string) => exportFormat(dbml, 'spark-ddl');
export const exportDbt = (dbml: string) => exportFormat(dbml, 'dbt');
export const exportErwin = (dbml: string) => exportFormat(dbml, 'erwin');
export const exportMermaid = (dbml: string) => exportFormat(dbml, 'mermaid');
export const exportPng = (pngBase64: string) =>
  post<{ file: string }>('/api/export/png', { pngBase64 });

export const exportInput = (dbml: string, dialect: InputDialect = 'spark') =>
  exportFormat(dbml, 'localdrawdb', dialect === 'oracle' ? 'oracle' : 'spark');

export const exportLocalDrawDB = exportInput;
