import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-filesctx-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  delete process.env.LOCALDRAWDB_DOMAIN;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('files.ts — resolução por domínio ativo', () => {
  it('sem domínio ativo e sem LOCALDRAWDB_DATA_DIR: lança erro claro', async () => {
    delete process.env.LOCALDRAWDB_DATA_DIR;
    const { listProjects } = await import('../files.ts');
    await expect(listProjects()).rejects.toThrow(/domínio ativo/i);
  });

  it('com domínio ativo (setActiveDomainSlug), opera dentro de <base>/domains/<slug>/', async () => {
    const { setActiveDomainSlug } = await import('../domainContext.ts');
    const filesMod = await import('../files.ts');
    setActiveDomainSlug('acme');

    const meta = await filesMod.createProject('Projeto Acme');
    const expectedDir = path.join(tmpDir, 'domains', 'acme', 'projects', meta.slug);
    const exists = await fs.stat(expectedDir).then((s) => s.isDirectory()).catch(() => false);
    expect(exists).toBe(true);
  });

  it('LOCALDRAWDB_DOMAIN funciona como pin de processo (sem chamada explícita)', async () => {
    process.env.LOCALDRAWDB_DOMAIN = 'beta';
    const filesMod = await import('../files.ts');
    await filesMod.createProject('Projeto Beta');
    const registryExists = await fs
      .stat(path.join(tmpDir, 'domains', 'beta', 'projects.json'))
      .then(() => true)
      .catch(() => false);
    expect(registryExists).toBe(true);
  });

  it('domínio ativo tem prioridade sobre LOCALDRAWDB_DATA_DIR quando ambos setados', async () => {
    const { setActiveDomainSlug } = await import('../domainContext.ts');
    const filesMod = await import('../files.ts');
    setActiveDomainSlug('gama');

    await filesMod.createProject('Projeto Gama');
    const registryExists = await fs
      .stat(path.join(tmpDir, 'domains', 'gama', 'projects.json'))
      .then(() => true)
      .catch(() => false);
    expect(registryExists).toBe(true);

    // Não deve ter criado projects.json direto em tmpDir (comportamento legado)
    const flatExists = await fs.stat(path.join(tmpDir, 'projects.json')).then(() => true).catch(() => false);
    expect(flatExists).toBe(false);
  });

  it('sem domínio ativo, LOCALDRAWDB_DATA_DIR continua funcionando (compat com testes existentes)', async () => {
    const { listProjects, migrateLegacy } = await import('../files.ts');
    await migrateLegacy();
    const projects = await listProjects();
    expect(projects[0].slug).toBe('default');
    const exists = await fs.stat(path.join(tmpDir, 'projects.json')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
