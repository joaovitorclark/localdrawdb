import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-domains-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  delete process.env.LOCALDRAWDB_DOMAIN;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('createLocalDomain / listDomains', () => {
  it('cria domínio local (sem git) com slug único', async () => {
    const { createLocalDomain, listDomains } = await import('../domains.ts');
    const d1 = await createLocalDomain('Vendas');
    expect(d1.slug).toBe('vendas');
    expect(d1.hasGit).toBe(false);
    expect(d1.remoteUrl).toBeNull();

    const dirExists = await fs.stat(d1.dir).then((s) => s.isDirectory()).catch(() => false);
    expect(dirExists).toBe(true);

    const all = await listDomains();
    expect(all.map((d) => d.id)).toContain(d1.id);
  });

  it('gera slug sem conflito com sufixo numérico', async () => {
    const { createLocalDomain } = await import('../domains.ts');
    const a = await createLocalDomain('Time A');
    const b = await createLocalDomain('Time A');
    expect(a.slug).toBe('time-a');
    expect(b.slug).toBe('time-a-2');
  });
});

describe('attachGitToDomain', () => {
  it('promove domínio local a git (init) sem remote', async () => {
    const { createLocalDomain, attachGitToDomain } = await import('../domains.ts');
    const d = await createLocalDomain('Local Puro');
    const updated = await attachGitToDomain(d.id);
    expect(updated.hasGit).toBe(true);
    expect(updated.remoteUrl).toBeNull();
  });

  it('grava commit inicial em main para o HEAD unborn não sumir ao criar outra branch', async () => {
    const { createLocalDomain, attachGitToDomain } = await import('../domains.ts');
    const { currentBranch, getStatus, switchBranch } = await import('../git.ts');
    const d = await createLocalDomain('Com Commit Inicial');
    await attachGitToDomain(d.id);
    expect(await currentBranch(d.dir)).toBe('main');
    const before = await getStatus(d.dir);
    expect(before.branches).toContain('main');

    await switchBranch(d.dir, 'feat-x', true);
    const after = await getStatus(d.dir);
    expect(after.branch).toBe('feat-x');
    expect(after.branches).toEqual(expect.arrayContaining(['main', 'feat-x']));
  });
});

describe('cloneDomain vazio + activateDomain', () => {
  it('ao abrir, grava README e first commit e envia para o origin mesmo sem edição', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const bare = path.join(tmpDir, 'testea.git');
    await exec('git', ['init', '--bare', '--initial-branch=main', bare]);

    const { cloneDomain, activateDomain } = await import('../domains.ts');
    const d = await cloneDomain(bare, 'testea');
    await activateDomain(d.id);

    expect(await fs.readFile(path.join(d.dir, 'README.md'), 'utf8')).toBe('# testea\n');
    const log = await exec('git', ['-C', d.dir, 'log', '-1', '--pretty=%s']);
    expect(log.stdout.trim()).toBe('first commit');
    const dirty = await exec('git', ['-C', d.dir, 'status', '--porcelain']);
    expect(dirty.stdout.trim()).toBe('');
    await exec('git', ['-C', bare, 'rev-parse', 'refs/heads/main']);
  });
});

describe('deleteDomain', () => {
  it('tira da lista e apaga a pasta local', async () => {
    const { createLocalDomain, deleteDomain, listDomains } = await import('../domains.ts');
    const keep = await createLocalDomain('Fica');
    const gone = await createLocalDomain('Sai');
    await deleteDomain(gone.id);

    const all = await listDomains();
    expect(all.map((d) => d.id)).toEqual([keep.id]);
    await expect(fs.stat(gone.dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lança para id inexistente', async () => {
    const { deleteDomain } = await import('../domains.ts');
    await expect(deleteDomain('nao-existe')).rejects.toThrow(/não encontrado/i);
  });

  it('se o fs.rm falhar, não tira o domínio do registry (nada de pasta órfã)', async () => {
    const { createLocalDomain, deleteDomain, listDomains } = await import('../domains.ts');
    const d = await createLocalDomain('Presa');
    await fs.writeFile(path.join(d.dir, 'projects.json'), '{"projects":[]}'); // "parece domínio"

    const rmSpy = vi.spyOn(fs, 'rm').mockRejectedValueOnce(
      Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }),
    );
    try {
      await expect(deleteDomain(d.id)).rejects.toThrow(/não foi possível apagar/i);
    } finally {
      rmSpy.mockRestore();
    }

    expect((await listDomains()).map((x) => x.id)).toContain(d.id);
    expect(await fs.stat(d.dir).then((s) => s.isDirectory())).toBe(true);
  });
});

describe('syncDomainsRegistryWithDisk / listDomains (auto-adoção)', () => {
  it('adota pasta órfã com .git', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const { listDomains } = await import('../domains.ts');

    const orphan = path.join(tmpDir, 'domains', 'lakehouse-data-modeler');
    await fs.mkdir(orphan, { recursive: true });
    await exec('git', ['init', '-b', 'main', orphan]);

    const domains = await listDomains();
    expect(domains.map((d) => d.slug)).toContain('lakehouse-data-modeler');
    expect(domains.find((d) => d.slug === 'lakehouse-data-modeler')?.hasGit).toBe(true);
  });

  it('adota pasta órfã com projects.json e ignora pasta de lixo', async () => {
    const { listDomains, syncDomainsRegistryWithDisk } = await import('../domains.ts');

    await fs.mkdir(path.join(tmpDir, 'domains', 'vendas'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'domains', 'vendas', 'projects.json'), '{"projects":[]}');
    await fs.mkdir(path.join(tmpDir, 'domains', 'autorizacao_git'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'domains', 'autorizacao_git', 'dump.sql'), 'select 1;');

    const added = await syncDomainsRegistryWithDisk();
    expect(added).toEqual(['vendas']);

    const slugs = (await listDomains()).map((d) => d.slug);
    expect(slugs).toContain('vendas');
    expect(slugs).not.toContain('autorizacao_git');
  });

  it('é idempotente: segunda chamada não adiciona de novo', async () => {
    const { syncDomainsRegistryWithDisk } = await import('../domains.ts');
    await fs.mkdir(path.join(tmpDir, 'domains', 'x'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'domains', 'x', 'projects.json'), '{"projects":[]}');
    expect(await syncDomainsRegistryWithDisk()).toEqual(['x']);
    expect(await syncDomainsRegistryWithDisk()).toEqual([]);
  });
});

describe('cloneDomain com pasta já existente', () => {
  it('não colide: clona para slug-2 quando a pasta do slug já existe no disco', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const bare = path.join(tmpDir, 'src.git');
    await exec('git', ['init', '--bare', '--initial-branch=main', bare]);

    // pasta de lixo ocupando o slug alvo (não parece domínio → não é adotada)
    await fs.mkdir(path.join(tmpDir, 'domains', 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'domains', 'src', 'algo.txt'), 'ocupado');

    const { cloneDomain } = await import('../domains.ts');
    const d = await cloneDomain(bare, 'src');
    expect(d.slug).toBe('src-2');
    expect(await fs.stat(d.dir).then((s) => s.isDirectory())).toBe(true);
  });
});

describe('activateDomain', () => {
  // Duas regressões distintas são cobertas aqui:
  // - ORDEM: o slug precisa estar ativo no instante em que `ensureRegistry()`
  //   é chamado (spy captura `getActiveDomainSlug()` na chamada).
  // - PATH: o `projects.json` precisa nascer fisicamente dentro de `d.dir`
  //   (asserção fim-a-fim). Isso só passa desde a Task 5, que religou
  //   `files.ts:getDataDir()` para resolver pelo domínio ativo — antes dela o
  //   registry ia para o layout plano (`<base>/projects.json`).
  it('ativa o domínio e garante o registry de projetos dele', async () => {
    const filesActual = await vi.importActual<typeof import('../files.ts')>('../files.ts');
    const { getActiveDomainSlug } = await import('../domainContext.ts');

    let slugAtEnsureRegistry: string | null | undefined;
    let ensureRegistryCalls = 0;
    const ensureRegistrySpy = vi.fn(async () => {
      ensureRegistryCalls += 1;
      slugAtEnsureRegistry = getActiveDomainSlug();
      return filesActual.ensureRegistry();
    });
    vi.doMock('../files.ts', () => ({ ...filesActual, ensureRegistry: ensureRegistrySpy }));

    try {
      const { createLocalDomain, activateDomain, getDomain } = await import('../domains.ts');
      const d = await createLocalDomain('Alpha');
      await activateDomain(d.id);

      expect(getActiveDomainSlug()).toBe('alpha');

      // O registry precisa ser garantido JÁ com o domínio ativo — se
      // `ensureRegistry()` rodar antes de `setActiveDomainSlug()`, o arquivo
      // nasceria no domínio errado.
      expect(ensureRegistryCalls).toBe(1);
      expect(slugAtEnsureRegistry).toBe(d.slug);

      // Fim-a-fim: o registry precisa existir DENTRO do diretório do domínio.
      const registryExists = await fs
        .stat(path.join(d.dir, 'projects.json'))
        .then(() => true)
        .catch(() => false);
      expect(registryExists).toBe(true);

      const meta = await getDomain(d.id);
      expect(meta.id).toBe(d.id);
    } finally {
      vi.doUnmock('../files.ts');
    }
  });
});

describe('getDomain', () => {
  it('lança erro para id inexistente', async () => {
    const { getDomain } = await import('../domains.ts');
    await expect(getDomain('nao-existe')).rejects.toThrow(/não encontrado/i);
  });
});

describe('migrateLegacyDomains', () => {
  it('move data/projects/ + data/projects.json legados para data/domains/local/', async () => {
    await fs.mkdir(path.join(tmpDir, 'projects', 'default'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'projects', 'default', 'project.dbml'), 'Table t { id int }', 'utf8');
    await fs.writeFile(
      path.join(tmpDir, 'projects.json'),
      JSON.stringify({ activeId: 'x', projects: [{ id: 'x', name: 'default', slug: 'default', createdAt: '', updatedAt: '' }] }),
      'utf8',
    );

    const { migrateLegacyDomains, listDomains } = await import('../domains.ts');
    await migrateLegacyDomains();

    const domains = await listDomains();
    expect(domains).toHaveLength(1);
    expect(domains[0].slug).toBe('local');

    const movedDbml = await fs.readFile(
      path.join(tmpDir, 'domains', 'local', 'projects', 'default', 'project.dbml'),
      'utf8',
    );
    expect(movedDbml).toBe('Table t { id int }');

    const oldProjectsExists = await fs.stat(path.join(tmpDir, 'projects')).then(() => true).catch(() => false);
    expect(oldProjectsExists).toBe(false);
  });

  it('instalação limpa (nada em disco): ainda cria o domínio local vazio', async () => {
    const { migrateLegacyDomains, listDomains } = await import('../domains.ts');
    await migrateLegacyDomains();

    const domains = await listDomains();
    expect(domains).toHaveLength(1);
    expect(domains[0].slug).toBe('local');
    expect(domains[0].hasGit).toBe(false);
  });

  it('é idempotente: segunda chamada não duplica domínios', async () => {
    const { migrateLegacyDomains, listDomains } = await import('../domains.ts');
    await migrateLegacyDomains();
    await migrateLegacyDomains();

    const domains = await listDomains();
    expect(domains).toHaveLength(1);
  });

  it('colisão com destino já existente: preserva o legado em .legacy-* em vez de falhar', async () => {
    // Migração parcial anterior: data/domains/local/ já tem projects/ + projects.json,
    // mas os legados na raiz de data/ ainda existem. `fs.rename` direto daria
    // ENOTEMPTY/EEXIST e derrubaria o boot.
    const localDir = path.join(tmpDir, 'domains', 'local');
    await fs.mkdir(path.join(localDir, 'projects', 'default'), { recursive: true });
    await fs.writeFile(path.join(localDir, 'projects', 'default', 'project.dbml'), 'novo', 'utf8');
    await fs.writeFile(path.join(localDir, 'projects.json'), '{"activeId":"n","projects":[]}', 'utf8');

    await fs.mkdir(path.join(tmpDir, 'projects', 'default'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'projects', 'default', 'project.dbml'), 'legado', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'projects.json'), '{"activeId":"l","projects":[]}', 'utf8');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { migrateLegacyDomains, listDomains } = await import('../domains.ts');
      await expect(migrateLegacyDomains()).resolves.toBeUndefined();
      expect((await listDomains()).map((d) => d.slug)).toEqual(['local']);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }

    // Destino intacto (não sobrescrito pelo legado).
    expect(
      await fs.readFile(path.join(localDir, 'projects', 'default', 'project.dbml'), 'utf8'),
    ).toBe('novo');
    expect(await fs.readFile(path.join(localDir, 'projects.json'), 'utf8')).toContain('"n"');

    // Legado preservado em .legacy-*, não perdido nem deixado no caminho original.
    const entries = await fs.readdir(tmpDir);
    expect(entries).not.toContain('projects');
    expect(entries).not.toContain('projects.json');
    const backups = entries.filter((e) => e.includes('.legacy-'));
    expect(backups.some((e) => e.startsWith('projects.json.legacy-'))).toBe(true);
    const dirBackup = backups.find((e) => e.startsWith('projects.legacy-'));
    expect(dirBackup).toBeDefined();
    expect(
      await fs.readFile(path.join(tmpDir, dirBackup!, 'default', 'project.dbml'), 'utf8'),
    ).toBe('legado');
  });

  it('não sobrescreve domínios já registrados manualmente', async () => {
    const { migrateLegacyDomains, createLocalDomain, listDomains } = await import('../domains.ts');
    await createLocalDomain('Já Existia');
    await migrateLegacyDomains();

    const domains = await listDomains();
    expect(domains.map((d) => d.name)).toEqual(['Já Existia']);
  });
});
