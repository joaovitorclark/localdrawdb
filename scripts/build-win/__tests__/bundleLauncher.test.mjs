import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundleLauncher } from '../bundleLauncher.mjs';

let outDir;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-bundlelauncher-'));
});

afterEach(async () => {
  await fs.rm(outDir, { recursive: true, force: true });
});

describe('bundleLauncher', () => {
  it('gera um único arquivo .cjs válido e carregável (require)', async () => {
    const cjsPath = await bundleLauncher({ outDir });

    const exists = await fs.stat(cjsPath).then((s) => s.isFile()).catch(() => false);
    expect(exists).toBe(true);
    expect(cjsPath.endsWith('.cjs')).toBe(true);

    const content = await fs.readFile(cjsPath, 'utf8');
    // Confirma que não sobrou nenhum "import"/"export" de nível de módulo —
    // bundle CJS de verdade, sem depender de node_modules externo (SEA não
    // tem acesso a filesystem pra resolver require de terceiros).
    expect(content).not.toMatch(/^import /m);
    expect(content).not.toMatch(/^export /m);

    // Carregável como CJS puro, sem erro de sintaxe/resolução.
    delete require.cache[require.resolve(cjsPath)];
    expect(() => require(cjsPath)).not.toThrow();
  });
});
