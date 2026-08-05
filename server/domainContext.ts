// Resolve qual domínio (data/domains/<slug>/) está ativo no processo, para
// que server/files.ts saiba onde ler/gravar projects.json + projects/.
import path from 'node:path';
import { DATA_DIR } from './paths.ts';

export const DOMAINS_DIR_NAME = 'domains';
export const DOMAINS_REGISTRY_FILE = 'domains.json';

/** Diretório base de dados: LOCALDRAWDB_DATA_DIR (testes) ou ROOT/data (produção). */
export function baseDataDir(): string {
  return process.env.LOCALDRAWDB_DATA_DIR ?? DATA_DIR;
}

export function domainsRootDir(): string {
  return path.join(baseDataDir(), DOMAINS_DIR_NAME);
}

export function domainsRegistryPath(): string {
  return path.join(baseDataDir(), DOMAINS_REGISTRY_FILE);
}

export function domainDirFor(slug: string): string {
  return path.join(domainsRootDir(), slug);
}

let activeDomainSlug: string | null = null;

/** Define o domínio ativo do processo (contexto em memória — não persiste em disco). */
export function setActiveDomainSlug(slug: string | null): void {
  activeDomainSlug = slug;
}

/** Domínio ativo: memória (setActiveDomainSlug) > LOCALDRAWDB_DOMAIN (pin de processo) > null. */
export function getActiveDomainSlug(): string | null {
  return activeDomainSlug ?? process.env.LOCALDRAWDB_DOMAIN?.trim() ?? null;
}

/** Diretório do domínio ativo. Lança erro se nenhum domínio estiver ativo. */
export function activeDomainDir(): string {
  const slug = getActiveDomainSlug();
  if (!slug) {
    throw new Error('Nenhum domínio ativo — selecione um projeto na tela de escolha.');
  }
  return domainDirFor(slug);
}
