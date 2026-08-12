// Teste de integração contra o `git` REAL (sem mock de child_process): o bug que
// ele cobre é exatamente uma diferença de comportamento entre
// `rev-parse --is-inside-work-tree` (true em qualquer subpasta de um repo
// ancestral) e `rev-parse --show-toplevel` (raiz efetiva). Com `execFile`
// mockado o teste não provaria nada.
//
// Regressão: `data/domains/<slug>/` vive dentro do clone do próprio LocalDrawDB,
// então `isGitRepo()` respondia true para todo domínio local — que passava a
// expor o remote do projeto e aceitava push/switch-branch no repo real.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isGitRepo } from '../git.ts';

const exec = promisify(execFile);

let repoRoot: string;
let subDir: string;
let plainDir: string;

beforeAll(async () => {
  // Repo temporário fora do worktree do LocalDrawDB — não podemos sujar o repo real.
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-isgitrepo-'));
  await exec('git', ['init'], { cwd: repoRoot });

  // Subpasta sem `.git` próprio, mas dentro do work tree acima.
  subDir = path.join(repoRoot, 'data', 'domains', 'local');
  await fs.mkdir(subDir, { recursive: true });

  // Diretório fora de qualquer work tree (controle).
  plainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-plain-'));
});

afterAll(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
  await fs.rm(plainDir, { recursive: true, force: true });
});

describe('isGitRepo (git real)', () => {
  it('false para subdiretório dentro de um work tree ancestral (sem .git próprio)', async () => {
    // Sanidade: o git de fato considera esse diretório "dentro de um work tree",
    // que é justamente o falso-positivo que a função precisa ignorar.
    const { stdout } = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: subDir });
    expect(stdout.trim()).toBe('true');

    expect(await isGitRepo(subDir)).toBe(false);
  });

  it('true para a raiz do repositório', async () => {
    expect(await isGitRepo(repoRoot)).toBe(true);
  });

  it('false para diretório fora de qualquer repositório', async () => {
    expect(await isGitRepo(plainDir)).toBe(false);
  });
});
