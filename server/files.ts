// Acesso ao diretório data/ (input, output, persistência). NUNCA versionado.
// F0: camada multi-projeto — data/projects/<slug>/
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// ──────────────────────────────────────────────────────────────
// Raiz do repositório (sempre baseada no local do arquivo, não
// sobrescrita pelo env — serve de âncora para ROOT).
// ──────────────────────────────────────────────────────────────
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// DATA_DIR público: pode ser sobrescrito via LOCALDRAWDB_DATA_DIR (usado em testes).
// Em runtime o valor padrão é ROOT/data.
export const DATA_DIR = path.join(ROOT, 'data');

/**
 * Retorna o diretório de dados efetivo.
 * Em testes, LOCALDRAWDB_DATA_DIR aponta para um tmpdir isolado.
 */
function getDataDir(): string {
  return process.env.LOCALDRAWDB_DATA_DIR ?? DATA_DIR;
}

// ──────────────────────────────────────────────────────────────
// Constantes derivadas do DATA_DIR (compat legado para routes.ts)
// INPUT_DIR / OUTPUT_DIR eram globais; agora são do projeto ativo.
// Mantidos como getters dinâmicos para não quebrar importações estáticas.
// ──────────────────────────────────────────────────────────────
export const PROJECTS_DIR_NAME = 'projects';
export const REGISTRY_FILE = 'projects.json';

/** @deprecated Usar projectInputDir(slug) do projeto ativo */
export const INPUT_DIR = path.join(DATA_DIR, 'input');
/** @deprecated Usar projectOutputDir(slug) do projeto ativo */
export const OUTPUT_DIR = path.join(DATA_DIR, 'output');
/** @deprecated */
export const PROJECT_DBML = path.join(DATA_DIR, 'project.dbml');
/** @deprecated */
export const CANVAS_JSON = path.join(DATA_DIR, 'canvas.json');

// ──────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────
export interface ProjectMeta {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

interface Registry {
  activeId: string;
  projects: ProjectMeta[];
}

// ──────────────────────────────────────────────────────────────
// Utilitários internos
// ──────────────────────────────────────────────────────────────
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Converte nome para slug kebab-case simples. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'projeto';
}

/** Gera slug único (adiciona -2, -3… se já existir). */
function uniqueSlug(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Gera ID curto (8 hex chars). */
function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

// ──────────────────────────────────────────────────────────────
// Paths helpers (dependem de getDataDir() — resolvidos em runtime)
// ──────────────────────────────────────────────────────────────
function projectsDir(): string {
  return path.join(getDataDir(), PROJECTS_DIR_NAME);
}

function registryPath(): string {
  return path.join(getDataDir(), REGISTRY_FILE);
}

export function projectDir(slug: string): string {
  return path.join(projectsDir(), slug);
}

export function projectDbmlPath(slug: string): string {
  return path.join(projectDir(slug), 'project.dbml');
}

export function projectCanvasPath(slug: string): string {
  return path.join(projectDir(slug), 'canvas.json');
}

export function projectInputDir(slug: string): string {
  return path.join(projectDir(slug), 'input');
}

export function projectOutputDir(slug: string): string {
  return path.join(projectDir(slug), 'output');
}

// ──────────────────────────────────────────────────────────────
// Registry helpers
// ──────────────────────────────────────────────────────────────
export async function readRegistry(): Promise<Registry> {
  try {
    const raw = await fs.readFile(registryPath(), 'utf8');
    const reg = JSON.parse(raw) as Registry;
    if (reg.projects?.length) return reg;
  } catch {
    // arquivo ausente ou inválido — será recriado
  }
  // Registry vazio ou ausente: retorna estrutura default vazia
  return { activeId: '', projects: [] };
}

export async function writeRegistry(reg: Registry): Promise<void> {
  await ensureDir(getDataDir());
  await fs.writeFile(registryPath(), JSON.stringify(reg, null, 2), 'utf8');
}

// ──────────────────────────────────────────────────────────────
// Garantia de registry (idempotente)
// ──────────────────────────────────────────────────────────────
/** Lista os slugs (subdiretórios) presentes em data/projects/. */
async function projectSlugsOnDisk(): Promise<string[]> {
  const entries = await fs.readdir(projectsDir(), { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * ensureRegistry(): garante que data/projects.json exista.
 * - Registry presente: nada a fazer.
 * - Registry ausente mas projects/<slug>/ existem no disco: reconstrói o
 *   registry a partir das pastas (caso o arquivo tenha sido apagado).
 * - Registry ausente e sem projetos: delega a migrateLegacy() (instalação
 *   limpa ou legada).
 */
export async function ensureRegistry(): Promise<void> {
  const regExists = await fs.stat(registryPath()).then(() => true).catch(() => false);
  if (regExists) {
    await syncRegistryWithDisk();
    return;
  }

  const slugs = await projectSlugsOnDisk();
  if (slugs.length === 0) {
    // Sem projetos no disco: instalação limpa ou legada.
    await migrateLegacy();
    return;
  }

  // Registry perdido, mas há projetos no disco → reconstrói a partir das pastas.
  // Nomes/ids originais não são recuperáveis; usamos o slug como nome.
  const now = new Date().toISOString();
  const projects: ProjectMeta[] = slugs.map((slug) => ({
    id: newId(),
    name: slug,
    slug,
    createdAt: now,
    updatedAt: now,
  }));
  await writeRegistry({ activeId: projects[0].id, projects });
}

/**
 * syncRegistryWithDisk(): add-only. Adiciona ao registry toda pasta de
 * projects/ sem entrada correspondente. Nunca remove. Retorna os slugs
 * adicionados.
 */
export async function syncRegistryWithDisk(): Promise<string[]> {
  const reg = await readRegistry();
  const known = new Set(reg.projects.map((p) => p.slug));
  const slugs = await projectSlugsOnDisk();
  const added: string[] = [];
  const now = new Date().toISOString();
  for (const slug of slugs) {
    if (known.has(slug)) continue;
    reg.projects.push({ id: newId(), name: slug, slug, createdAt: now, updatedAt: now });
    added.push(slug);
  }
  if (added.length) {
    if (!reg.activeId) reg.activeId = reg.projects[0].id;
    await writeRegistry(reg);
  }
  return added;
}

// ──────────────────────────────────────────────────────────────
// Migração legada (idempotente)
// ──────────────────────────────────────────────────────────────
/**
 * migrateLegacy(): idempotente.
 * - Se data/projects/ NÃO existe: migra instalação legada (ou cria default vazio).
 * - Se data/projects/ já existe: não faz nada.
 */
export async function migrateLegacy(): Promise<void> {
  const pDir = projectsDir();
  const dataDir = getDataDir();

  // Idempotência: se projects/ já existe, encerra.
  const alreadyMigrated = await fs.stat(pDir).then(() => true).catch(() => false);
  if (alreadyMigrated) return;

  const slug = 'default';
  const destDir = path.join(pDir, slug);
  await ensureDir(destDir);

  // ── DBML ──────────────────────────────────────────────────
  const legacyDbml = path.join(dataDir, 'project.dbml');
  const legacyCanvas = path.join(dataDir, 'canvas.json');
  const legacyInput = path.join(dataDir, 'input');
  const legacyOutput = path.join(dataDir, 'output');

  const dbmlExists = await fs.stat(legacyDbml).then(() => true).catch(() => false);
  const canvasExists = await fs.stat(legacyCanvas).then(() => true).catch(() => false);
  const inputExists = await fs.stat(legacyInput).then((s) => s.isDirectory()).catch(() => false);

  if (dbmlExists) {
    await fs.rename(legacyDbml, path.join(destDir, 'project.dbml'));
  } else {
    await fs.writeFile(path.join(destDir, 'project.dbml'), '', 'utf8');
  }

  if (canvasExists) {
    await fs.rename(legacyCanvas, path.join(destDir, 'canvas.json'));
  } else {
    await fs.writeFile(path.join(destDir, 'canvas.json'), '{}', 'utf8');
  }

  if (inputExists) {
    await fs.rename(legacyInput, path.join(destDir, 'input'));
  } else {
    await ensureDir(path.join(destDir, 'input'));
  }

  // Migra output se existir
  const outputExists = await fs.stat(legacyOutput).then((s) => s.isDirectory()).catch(() => false);
  if (outputExists) {
    await fs.rename(legacyOutput, path.join(destDir, 'output'));
  } else {
    await ensureDir(path.join(destDir, 'output'));
  }

  // Registra projeto default
  const now = new Date().toISOString();
  const meta: ProjectMeta = {
    id: newId(),
    name: 'default',
    slug,
    createdAt: now,
    updatedAt: now,
  };
  const reg: Registry = { activeId: meta.id, projects: [meta] };
  await writeRegistry(reg);
}

// ──────────────────────────────────────────────────────────────
// CRUD de projetos
// ──────────────────────────────────────────────────────────────
export async function listProjects(): Promise<ProjectMeta[]> {
  const reg = await readRegistry();
  return reg.projects;
}

export async function createProject(name: string): Promise<ProjectMeta> {
  const reg = await readRegistry();
  const existingSlugs = reg.projects.map((p) => p.slug);
  const slug = uniqueSlug(toSlug(name), existingSlugs);

  const dest = projectDir(slug);
  await ensureDir(dest);
  await fs.writeFile(projectDbmlPath(slug), '', 'utf8');
  await fs.writeFile(projectCanvasPath(slug), '{}', 'utf8');
  await ensureDir(projectInputDir(slug));
  await ensureDir(projectOutputDir(slug));

  const now = new Date().toISOString();
  const meta: ProjectMeta = { id: newId(), name, slug, createdAt: now, updatedAt: now };

  const isFirst = reg.projects.length === 0;
  reg.projects.push(meta);
  if (isFirst) reg.activeId = meta.id;
  await writeRegistry(reg);
  return meta;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const reg = await readRegistry();
  const proj = reg.projects.find((p) => p.id === id);
  if (!proj) throw new Error(`Projeto não encontrado: ${id}`);
  proj.name = name;
  proj.updatedAt = new Date().toISOString();
  await writeRegistry(reg);
}

export async function deleteProject(id: string): Promise<void> {
  const reg = await readRegistry();
  if (reg.projects.length <= 1) throw new Error('Não é possível deletar o único projeto.');
  const idx = reg.projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Projeto não encontrado: ${id}`);
  const [removed] = reg.projects.splice(idx, 1);

  // Remove diretório
  const dir = projectDir(removed.slug);
  await fs.rm(dir, { recursive: true, force: true });

  // Reatribui activeId se necessário
  if (reg.activeId === id) {
    reg.activeId = reg.projects[0].id;
  }
  await writeRegistry(reg);
}

export async function duplicateProject(id: string, newName?: string): Promise<ProjectMeta> {
  const reg = await readRegistry();
  const source = reg.projects.find((p) => p.id === id);
  if (!source) throw new Error(`Projeto não encontrado: ${id}`);

  const baseName = newName ?? `${source.name} (cópia)`;
  const existingSlugs = reg.projects.map((p) => p.slug);
  const slug = uniqueSlug(toSlug(baseName), existingSlugs);

  const dest = projectDir(slug);
  await ensureDir(dest);

  // Copia dbml + canvas
  const srcDbml = projectDbmlPath(source.slug);
  const srcCanvas = projectCanvasPath(source.slug);
  const dbmlContent = await fs.readFile(srcDbml, 'utf8').catch(() => '');
  const canvasContent = await fs.readFile(srcCanvas, 'utf8').catch(() => '{}');
  await fs.writeFile(projectDbmlPath(slug), dbmlContent, 'utf8');
  await fs.writeFile(projectCanvasPath(slug), canvasContent, 'utf8');

  // Copia input/
  const srcInput = projectInputDir(source.slug);
  const dstInput = projectInputDir(slug);
  await ensureDir(dstInput);
  const inputExists = await fs.stat(srcInput).then((s) => s.isDirectory()).catch(() => false);
  if (inputExists) {
    const entries = await fs.readdir(srcInput);
    await Promise.all(
      entries.map((f) => fs.copyFile(path.join(srcInput, f), path.join(dstInput, f))),
    );
  }

  // Cria output/
  await ensureDir(projectOutputDir(slug));

  const now = new Date().toISOString();
  const meta: ProjectMeta = { id: newId(), name: baseName, slug, createdAt: now, updatedAt: now };
  reg.projects.push(meta);
  await writeRegistry(reg);
  return meta;
}

export async function setActiveProject(id: string): Promise<void> {
  if (await pinnedSlug()) return; // instância fixada não persiste activeId compartilhado
  const reg = await readRegistry();
  if (!reg.projects.find((p) => p.id === id)) {
    throw new Error(`Projeto não encontrado: ${id}`);
  }
  reg.activeId = id;
  await writeRegistry(reg);
}

/** Slug fixado por processo (LOCALDRAWDB_PROJECT), validado, ou null. */
export async function pinnedSlug(): Promise<string | null> {
  const slug = process.env.LOCALDRAWDB_PROJECT?.trim();
  if (!slug) return null;
  const reg = await readRegistry();
  if (!reg.projects.some((p) => p.slug === slug)) {
    throw new Error(`LOCALDRAWDB_PROJECT="${slug}" não existe no registry`);
  }
  return slug;
}

export async function getActiveId(): Promise<string> {
  const pin = await pinnedSlug();
  const reg = await readRegistry();
  if (pin) {
    const proj = reg.projects.find((p) => p.slug === pin);
    if (proj) return proj.id;
  }
  return reg.activeId;
}

/** Retorna o ProjectMeta de um projeto pelo id. Lança erro se não encontrado. */
export async function getProject(id: string): Promise<ProjectMeta> {
  const reg = await readRegistry();
  const proj = reg.projects.find((p) => p.id === id);
  if (!proj) throw new Error(`Projeto não encontrado: ${id}`);
  return proj;
}

// ──────────────────────────────────────────────────────────────
// Helpers internos: resolve slug do projeto ativo
// ──────────────────────────────────────────────────────────────
export async function getActiveSlug(): Promise<string> {
  const pin = await pinnedSlug();
  if (pin) return pin;
  const reg = await readRegistry();
  const proj = reg.projects.find((p) => p.id === reg.activeId);
  if (!proj) {
    if (reg.projects.length > 0) return reg.projects[0].slug;
    throw new Error('Nenhum projeto ativo. Execute migrateLegacy() primeiro.');
  }
  return proj.slug;
}

/** Retorna o inputDir do projeto ativo (para /api/meta). */
export async function getActiveInputDir(): Promise<string> {
  const slug = await getActiveSlug();
  return projectInputDir(slug);
}

// ──────────────────────────────────────────────────────────────
// I/O por slug
// ──────────────────────────────────────────────────────────────
export async function loadProjectBySlug(slug: string): Promise<{ dbml: string; canvas: unknown }> {
  const dbmlRaw = await fs.readFile(projectDbmlPath(slug), 'utf8').catch(() => '');
  const canvasRaw = await fs.readFile(projectCanvasPath(slug), 'utf8').catch(() => '{}');
  let canvas: unknown = {};
  try { canvas = JSON.parse(canvasRaw); } catch { canvas = {}; }
  // CRLF-safe (defensivo): normaliza EOL para LF. No Windows o arquivo pode vir com CRLF
  // (git core.autocrlf); manter LF evita bugs de rename nos regexes do cliente.
  const dbml = dbmlRaw.replace(/\r\n?/g, '\n');
  return { dbml, canvas };
}

export async function saveProjectBySlug(slug: string, dbml: string, canvas: unknown): Promise<void> {
  const dir = projectDir(slug);
  await ensureDir(dir);
  await fs.writeFile(projectDbmlPath(slug), dbml, 'utf8');
  await fs.writeFile(projectCanvasPath(slug), JSON.stringify(canvas ?? {}, null, 2), 'utf8');
}

export async function readInputSqlForSlug(slug: string): Promise<{ file: string; content: string }[]> {
  const inputDir = projectInputDir(slug);
  await ensureDir(inputDir);
  const entries = await fs.readdir(inputDir);
  const sqlFiles = entries.filter((f) => f.toLowerCase().endsWith('.sql'));
  return Promise.all(
    sqlFiles.map(async (file) => ({
      file,
      content: await fs.readFile(path.join(inputDir, file), 'utf8'),
    })),
  );
}

/** Extensões consideradas no import (SQL DDL + artefatos dbt + DBML nativo). */
export const IMPORT_EXTS = ['.sql', '.yml', '.yaml', '.json', '.dbml'];

/**
 * Lê recursivamente o input dir do projeto, retornando todos os arquivos de
 * import (.sql/.yml/.yaml/.json) com caminho relativo ao input dir. Necessário
 * para projetos dbt em pasta (models/**\/schema.yml + *.sql).
 */
export async function readImportInputsForSlug(
  slug: string,
): Promise<{ file: string; content: string }[]> {
  const inputDir = projectInputDir(slug);
  await ensureDir(inputDir);
  const out: { file: string; content: string }[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (IMPORT_EXTS.includes(path.extname(e.name).toLowerCase())) {
        out.push({ file: path.relative(inputDir, full), content: await fs.readFile(full, 'utf8') });
      }
    }
  };
  await walk(inputDir);
  return out;
}

export async function writeOutputForSlug(
  slug: string,
  relPath: string,
  content: string | Uint8Array,
): Promise<string> {
  const outputDir = projectOutputDir(slug);
  const full = path.join(outputDir, relPath);
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, content);
  // Retorna caminho relativo a ROOT (ou ao DATA_DIR pai) para compatibilidade
  return path.relative(ROOT, full);
}

// ──────────────────────────────────────────────────────────────
// Wrappers de compatibilidade (mantêm assinatura usada por routes.ts)
// ──────────────────────────────────────────────────────────────

/** Lê todos os .sql do projeto ativo. */
export async function readInputSql(): Promise<{ file: string; content: string }[]> {
  const slug = await getActiveSlug();
  return readInputSqlForSlug(slug);
}

/** Escreve arquivo no output do projeto ativo. Retorna caminho relativo. */
export async function writeOutput(relPath: string, content: string | Uint8Array): Promise<string> {
  const slug = await getActiveSlug();
  return writeOutputForSlug(slug, relPath, content);
}

/** Carrega DBML + canvas do projeto ativo. */
export async function loadProject(): Promise<{ dbml: string; canvas: unknown }> {
  const slug = await getActiveSlug();
  return loadProjectBySlug(slug);
}

/** Salva DBML + canvas no projeto ativo. */
export async function saveProject(dbml: string, canvas: unknown): Promise<void> {
  const slug = await getActiveSlug();
  return saveProjectBySlug(slug, dbml, canvas);
}
