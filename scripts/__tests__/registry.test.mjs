// Testes do helper de registry do launcher (scripts/registry.mjs).
// O CLI (./ldb) opera sempre dentro do domínio "local": o registry e as pastas
// de projeto vivem em <dataDir>/domains/local/. Estes testes garantem tanto o
// bootstrap numa instalação limpa quanto a migração de um layout legado
// (projects.json + projects/ direto no dataDir).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRegistry, createProjectCli } from '../registry.mjs';

let tmpDir;

/** Caminho dentro do domínio "local" do dataDir de teste. */
const localPath = (...parts) => path.join(tmpDir, 'domains', 'local', ...parts);

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-reg-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadRegistry — layout de domínios', () => {
  it('cria o domínio local e retorna o registry de dentro de domains/local/', async () => {
    const reg = loadRegistry(tmpDir);
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0].slug).toBe('default');
    expect(reg.activeId).toBeTruthy();

    const registryOnDisk = JSON.parse(await fs.readFile(localPath('projects.json'), 'utf8'));
    expect(registryOnDisk.projects).toHaveLength(1);

    // O domínio "local" foi registrado em data/domains.json.
    const domains = JSON.parse(await fs.readFile(path.join(tmpDir, 'domains.json'), 'utf8'));
    expect(domains.domains.map((d) => d.slug)).toContain('local');
  });
});

describe('loadRegistry — instalação legada (projects/ direto no dataDir)', () => {
  it('migra as pastas legadas para domains/local/ e reconstrói o registry', async () => {
    // Cenário do usuário pré-domínios: projects.json apagado, mas projects/ tem projetos.
    await fs.mkdir(path.join(tmpDir, 'projects', 'vendas'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'projects', 'rh'), { recursive: true });

    const registry = loadRegistry(tmpDir);

    expect(registry.projects.map((p) => p.slug).sort()).toEqual(['rh', 'vendas']);
    const onDisk = JSON.parse(await fs.readFile(localPath('projects.json'), 'utf8'));
    expect(onDisk.projects).toHaveLength(2);

    // As pastas legadas saíram da raiz do dataDir.
    const legacyStillThere = await fs
      .stat(path.join(tmpDir, 'projects'))
      .then(() => true)
      .catch(() => false);
    expect(legacyStillThere).toBe(false);
  });
});

describe('loadRegistry — mapeia pasta criada manualmente', () => {
  it('inclui no registry pasta criada à mão dentro do domínio local', async () => {
    // Bootstrap do registry (cria projeto "default").
    loadRegistry(tmpDir);

    // Cria pasta manualmente, sem passar pelo createProject.
    await fs.mkdir(localPath('projects', 'manual-dir'), { recursive: true });

    // Segunda chamada deve sincronizar e mapear a nova pasta (idempotência + sync).
    const registry = loadRegistry(tmpDir);

    expect(registry.projects.map((p) => p.slug)).toContain('manual-dir');
  });
});

describe('loadRegistry — registry legado existente', () => {
  it('migra o projects.json legado para o domínio local sem alterá-lo', async () => {
    const existing = {
      activeId: 'abc123',
      projects: [{ id: 'abc123', name: 'X', slug: 'x', createdAt: 'now', updatedAt: 'now' }],
    };
    await fs.writeFile(path.join(tmpDir, 'projects.json'), JSON.stringify(existing), 'utf8');

    const registry = loadRegistry(tmpDir);
    expect(registry).toEqual(existing);

    const onDisk = JSON.parse(await fs.readFile(localPath('projects.json'), 'utf8'));
    expect(onDisk).toEqual(existing);
  });
});

describe('createProjectCli — layout de domínios', () => {
  it('cria o projeto dentro de domains/local/projects/', async () => {
    createProjectCli('Novo Projeto CLI', tmpDir);
    const dirExists = await fs
      .stat(localPath('projects', 'novo-projeto-cli'))
      .then((s) => s.isDirectory())
      .catch(() => false);
    expect(dirExists).toBe(true);

    const reg = JSON.parse(await fs.readFile(localPath('projects.json'), 'utf8'));
    expect(reg.projects.some((p) => p.slug === 'novo-projeto-cli')).toBe(true);
  });
});
