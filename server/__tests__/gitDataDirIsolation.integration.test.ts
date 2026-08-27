// Regressão (git REAL, sem mock): quem baixa o LocalDrawDB pega um clone com
// `.git` + `origin`. Os dados vivem em `data/`, que está no `.gitignore` do
// projeto. Se um helper de "primeiro commit" roda numa pasta de domínio SEM
// `.git` próprio, o git subia a árvore, achava o `.git` do LocalDrawDB e:
//   git add -A            -> nada (data/ ignorado)
//   git commit --allow-empty -> commit vazio no branch atual do LocalDrawDB
//   git branch -M main    -> renomeia o branch do LocalDrawDB
//   git push -u origin main -> push pro origin do LocalDrawDB
// Este teste monta exatamente esse cenário e exige que os helpers RECUSEM.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);

let parentRepo: string; // faz o papel do clone do LocalDrawDB
let dataDir: string; // <parentRepo>/data  (ignorado pelo .gitignore do pai)

async function git(cwd: string, ...args: string[]) {
  return exec('git', args, { cwd });
}

beforeEach(async () => {
  parentRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'lddb-isolation-'));
  await git(parentRepo, 'init', '-b', 'work');
  await fs.writeFile(path.join(parentRepo, '.gitignore'), '/data/\nnode_modules/\n');
  await git(parentRepo, 'add', '-A');
  await git(parentRepo, '-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-m', 'chore: init');

  dataDir = path.join(parentRepo, 'data');
  await fs.mkdir(path.join(dataDir, 'domains'), { recursive: true });
  // baseDataDir() respeita esse env — o ceiling do git deve ser montado a partir dele.
  process.env.LOCALDRAWDB_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  await fs.rm(parentRepo, { recursive: true, force: true });
});

async function parentState() {
  const branch = (await git(parentRepo, 'branch', '--show-current')).stdout.trim();
  const log = (await git(parentRepo, 'log', '--oneline')).stdout.trim();
  const branches = (await git(parentRepo, 'branch', '--format=%(refname:short)')).stdout.trim();
  return { branch, log, branches };
}

describe('git em data/ isolado do repo do LocalDrawDB', () => {
  it('bootstrapEmptyRepo recusa numa pasta de domínio sem .git próprio e não toca no repo pai', async () => {
    const { bootstrapEmptyRepo } = await import('../git.ts');
    const before = await parentState();
    const domainDir = path.join(dataDir, 'domains', 'acme');
    await fs.mkdir(domainDir, { recursive: true });

    await expect(bootstrapEmptyRepo(domainDir)).rejects.toThrow();

    expect(await parentState()).toEqual(before); // branch, log e lista de branches intactos
  });

  it('gitCommitFirst (via switchBranch create) recusa sem .git próprio', async () => {
    const { switchBranch } = await import('../git.ts');
    const before = await parentState();
    const domainDir = path.join(dataDir, 'domains', 'beta');
    await fs.mkdir(domainDir, { recursive: true });

    await expect(switchBranch(domainDir, 'feature/x', true)).rejects.toThrow();

    expect(await parentState()).toEqual(before);
  });

  it('initRepo cria um repo próprio isolado (origin != LocalDrawDB) e não altera o pai', async () => {
    const { initRepo, remoteUrl } = await import('../git.ts');
    const before = await parentState();
    const domainDir = path.join(dataDir, 'domains', 'gamma');
    await fs.mkdir(domainDir, { recursive: true });

    await initRepo(domainDir, 'https://example.com/acme/their-repo.git');

    const top = (await git(domainDir, 'rev-parse', '--show-toplevel')).stdout.trim();
    expect(await fs.realpath(top)).toBe(await fs.realpath(domainDir));
    expect(await remoteUrl(domainDir)).toBe('https://example.com/acme/their-repo.git');
    expect(await parentState()).toEqual(before);
  });

  it('bootstrapEmptyRepo roda normalmente quando o domínio TEM .git próprio', async () => {
    const { bootstrapEmptyRepo } = await import('../git.ts');
    const domainDir = path.join(dataDir, 'domains', 'delta');
    await fs.mkdir(domainDir, { recursive: true });
    await git(domainDir, 'init', '-b', 'main');

    await expect(bootstrapEmptyRepo(domainDir)).resolves.toBeUndefined();

    const log = (await git(domainDir, 'log', '--oneline')).stdout.trim();
    expect(log).toMatch(/first commit/);
  });
});
