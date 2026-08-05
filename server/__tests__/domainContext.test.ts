import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-domainctx-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  delete process.env.LOCALDRAWDB_DOMAIN;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('domainContext', () => {
  it('domainsRootDir/domainDirFor resolvem sob LOCALDRAWDB_DATA_DIR', async () => {
    const { domainsRootDir, domainDirFor } = await import('../domainContext.ts');
    expect(domainsRootDir()).toBe(path.join(tmpDir, 'domains'));
    expect(domainDirFor('acme')).toBe(path.join(tmpDir, 'domains', 'acme'));
  });

  it('getActiveDomainSlug começa null sem env nem chamada explícita', async () => {
    const { getActiveDomainSlug } = await import('../domainContext.ts');
    expect(getActiveDomainSlug()).toBeNull();
  });

  it('setActiveDomainSlug muda o valor em memória', async () => {
    const { setActiveDomainSlug, getActiveDomainSlug } = await import('../domainContext.ts');
    setActiveDomainSlug('acme');
    expect(getActiveDomainSlug()).toBe('acme');
    setActiveDomainSlug(null);
    expect(getActiveDomainSlug()).toBeNull();
  });

  it('LOCALDRAWDB_DOMAIN funciona como pin quando nada foi setado em memória', async () => {
    process.env.LOCALDRAWDB_DOMAIN = 'beta';
    const { getActiveDomainSlug } = await import('../domainContext.ts');
    expect(getActiveDomainSlug()).toBe('beta');
  });

  it('setActiveDomainSlug em memória tem prioridade sobre LOCALDRAWDB_DOMAIN', async () => {
    process.env.LOCALDRAWDB_DOMAIN = 'beta';
    const { setActiveDomainSlug, getActiveDomainSlug } = await import('../domainContext.ts');
    setActiveDomainSlug('acme');
    expect(getActiveDomainSlug()).toBe('acme');
  });

  it('activeDomainDir lança erro claro quando nenhum domínio está ativo', async () => {
    const { activeDomainDir } = await import('../domainContext.ts');
    expect(() => activeDomainDir()).toThrow(/domínio ativo/i);
  });

  it('activeDomainDir resolve para domainDirFor(slug) quando há domínio ativo', async () => {
    const { setActiveDomainSlug, activeDomainDir, domainDirFor } = await import('../domainContext.ts');
    setActiveDomainSlug('acme');
    expect(activeDomainDir()).toBe(domainDirFor('acme'));
  });
});
