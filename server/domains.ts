// Registro de domínios (data/domains.json) e pastas data/domains/<slug>/.
// Cada domínio, internamente, usa o mesmo layout que files.ts já entende
// (projects.json + projects/) — só muda o que "diretório de dados" significa.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  baseDataDir,
  domainsRootDir,
  domainsRegistryPath,
  domainDirFor,
  setActiveDomainSlug,
} from './domainContext.ts';
import { isGitRepo, remoteUrl as gitRemoteUrl, cloneRepo, initRepo } from './git.ts';
import { ensureRegistry } from './files.ts';

export interface DomainRecord {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainMeta extends DomainRecord {
  dir: string;
  hasGit: boolean;
  remoteUrl: string | null;
}

interface DomainsRegistryFile {
  domains: DomainRecord[];
}

/** Converte nome para slug kebab-case simples (mesma regra de files.ts). */
function toSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'dominio'
  );
}

/** Gera slug único (adiciona -2, -3… se já existir). */
function uniqueSlug(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readDomainsRegistry(): Promise<DomainsRegistryFile> {
  try {
    const raw = await fs.readFile(domainsRegistryPath(), 'utf8');
    const reg = JSON.parse(raw) as DomainsRegistryFile;
    if (Array.isArray(reg.domains)) return reg;
  } catch {
    // ausente ou inválido — tratado como vazio
  }
  return { domains: [] };
}

export async function writeDomainsRegistry(reg: DomainsRegistryFile): Promise<void> {
  await ensureDir(baseDataDir());
  await fs.writeFile(domainsRegistryPath(), JSON.stringify(reg, null, 2), 'utf8');
}

async function toDomainMeta(record: DomainRecord): Promise<DomainMeta> {
  const dir = domainDirFor(record.slug);
  const hasGit = await isGitRepo(dir);
  const remote = hasGit ? await gitRemoteUrl(dir) : null;
  return { ...record, dir, hasGit, remoteUrl: remote };
}

async function registerDomain(name: string, slug: string): Promise<DomainRecord> {
  const reg = await readDomainsRegistry();
  const now = new Date().toISOString();
  const record: DomainRecord = { id: newId(), slug, name, createdAt: now, updatedAt: now };
  reg.domains.push(record);
  await writeDomainsRegistry(reg);
  return record;
}

export async function listDomains(): Promise<DomainMeta[]> {
  const reg = await readDomainsRegistry();
  return Promise.all(reg.domains.map(toDomainMeta));
}

export async function getDomain(id: string): Promise<DomainMeta> {
  const reg = await readDomainsRegistry();
  const record = reg.domains.find((d) => d.id === id);
  if (!record) throw new Error(`Domínio não encontrado: ${id}`);
  return toDomainMeta(record);
}

export async function createLocalDomain(name: string): Promise<DomainMeta> {
  const reg = await readDomainsRegistry();
  const slug = uniqueSlug(
    toSlug(name),
    reg.domains.map((d) => d.slug),
  );
  await ensureDir(domainDirFor(slug));
  const record = await registerDomain(name, slug);
  return toDomainMeta(record);
}

export async function cloneDomain(url: string, name?: string): Promise<DomainMeta> {
  const reg = await readDomainsRegistry();
  const fallbackName = url.replace(/\.git$/, '').split(/[/\\]/).filter(Boolean).pop() ?? 'dominio';
  const baseName = name?.trim() || fallbackName;
  const slug = uniqueSlug(
    toSlug(baseName),
    reg.domains.map((d) => d.slug),
  );
  await ensureDir(domainsRootDir());
  await cloneRepo(url, domainDirFor(slug));
  const record = await registerDomain(baseName, slug);
  return toDomainMeta(record);
}

export async function attachGitToDomain(id: string, remoteUrl?: string): Promise<DomainMeta> {
  const reg = await readDomainsRegistry();
  const record = reg.domains.find((d) => d.id === id);
  if (!record) throw new Error(`Domínio não encontrado: ${id}`);
  const dir = domainDirFor(record.slug);
  await ensureDir(dir);
  await initRepo(dir, remoteUrl);
  record.updatedAt = new Date().toISOString();
  await writeDomainsRegistry(reg);
  return toDomainMeta(record);
}

/** Ativa o domínio (contexto em memória) e garante o registry de projetos dele. */
export async function activateDomain(id: string): Promise<DomainMeta> {
  const meta = await getDomain(id);
  setActiveDomainSlug(meta.slug);
  await ensureRegistry();
  return meta;
}

/**
 * Migra o layout legado (data/projects/ + data/projects.json direto em
 * data/) para data/domains/local/. Idempotente: se data/domains.json já
 * existe, não faz nada. Numa instalação limpa (nada em disco), ainda cria
 * o domínio "local" vazio para a tela de escolha nunca ficar sem opções.
 */
export async function migrateLegacyDomains(): Promise<void> {
  const alreadyMigrated = await fs
    .stat(domainsRegistryPath())
    .then(() => true)
    .catch(() => false);
  if (alreadyMigrated) return;

  await ensureDir(domainsRootDir());
  const localDir = domainDirFor('local');
  await ensureDir(localDir);

  const legacyProjectsDir = path.join(baseDataDir(), 'projects');
  const legacyRegistryPath = path.join(baseDataDir(), 'projects.json');

  const legacyProjectsExist = await fs
    .stat(legacyProjectsDir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (legacyProjectsExist) {
    await fs.rename(legacyProjectsDir, path.join(localDir, 'projects'));
  }

  const legacyRegistryExists = await fs
    .stat(legacyRegistryPath)
    .then(() => true)
    .catch(() => false);
  if (legacyRegistryExists) {
    await fs.rename(legacyRegistryPath, path.join(localDir, 'projects.json'));
  }

  await registerDomain('Local', 'local');
}
