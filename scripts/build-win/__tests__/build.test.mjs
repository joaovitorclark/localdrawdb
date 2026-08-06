import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWindowsPackage } from '../build.mjs';

let outDir;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-build-win-'));
});

afterEach(async () => {
  await fs.rm(outDir, { recursive: true, force: true });
});

describe('buildWindowsPackage', () => {
  it('monta a estrutura completa e zipa, chamando cada etapa uma vez', async () => {
    const calls = [];
    const fakeEnsureNodePortable = vi.fn().mockImplementation(async ({ cacheDir }) => {
      calls.push('ensureNodePortable');
      const nodeDir = path.join(cacheDir, 'fake-node');
      await fs.mkdir(nodeDir, { recursive: true });
      await fs.writeFile(path.join(nodeDir, 'node.exe'), 'fake-node-binary');
      return nodeDir;
    });
    const fakeBundleServer = vi.fn().mockImplementation(async ({ outDir: dest }) => {
      calls.push('bundleServer');
      await fs.mkdir(path.join(dest, 'app'), { recursive: true });
      await fs.writeFile(path.join(dest, 'app', 'server.bundle.mjs'), '// fake');
      await fs.mkdir(path.join(dest, 'app', 'node_modules'), { recursive: true });
      await fs.mkdir(path.join(dest, 'dist'), { recursive: true });
      await fs.writeFile(path.join(dest, 'dist', 'index.html'), '<html></html>');
    });
    const fakeBuildExeLauncher = vi.fn().mockImplementation(async ({ outDir: dest }) => {
      calls.push('buildExeLauncher');
      const exePath = path.join(dest, 'LocalDrawDB.exe');
      await fs.writeFile(exePath, 'fake-exe');
      return exePath;
    });

    const zipPath = await buildWindowsPackage({
      workDir: outDir,
      cacheDir: path.join(outDir, '.cache'),
      ensureNodePortableImpl: fakeEnsureNodePortable,
      bundleServerImpl: fakeBundleServer,
      buildExeLauncherImpl: fakeBuildExeLauncher,
    });

    expect(calls).toEqual(['ensureNodePortable', 'bundleServer', 'buildExeLauncher']);
    expect(fakeEnsureNodePortable).toHaveBeenCalledTimes(1);
    expect(fakeBundleServer).toHaveBeenCalledTimes(1);
    expect(fakeBuildExeLauncher).toHaveBeenCalledTimes(1);

    const zipExists = await fs.stat(zipPath).then((s) => s.isFile()).catch(() => false);
    expect(zipExists).toBe(true);
    expect(zipPath.endsWith('LocalDrawDB-win.zip')).toBe(true);

    const packageDir = path.join(outDir, 'LocalDrawDB-win');
    const dataDir = path.join(packageDir, 'data');
    const dataDirExists = await fs.stat(dataDir).then((s) => s.isDirectory()).catch(() => false);
    expect(dataDirExists).toBe(true);
    // data/ precisa nascer vazia — o app cria domains.json/domains/ sozinho no primeiro boot.
    const dataDirContents = await fs.readdir(dataDir);
    expect(dataDirContents).toEqual([]);

    const nodeExeInPackage = await fs
      .stat(path.join(packageDir, 'node', 'node.exe'))
      .then(() => true)
      .catch(() => false);
    expect(nodeExeInPackage).toBe(true);

    // O .exe é gerado dentro do pacote e o launcher recebe o node.exe já copiado.
    expect(fakeBuildExeLauncher).toHaveBeenCalledWith(
      expect.objectContaining({
        outDir: packageDir,
        nodeExePath: path.join(packageDir, 'node', 'node.exe'),
      }),
    );
  }, 30_000);

  it('limpa o packageDir antes de bundlar (bundleServer exige app/node_modules inexistente)', async () => {
    const packageDir = path.join(outDir, 'LocalDrawDB-win');
    // Simula um build anterior deixando app/node_modules pra trás.
    await fs.mkdir(path.join(packageDir, 'app', 'node_modules', 'leftover'), { recursive: true });
    await fs.mkdir(path.join(packageDir, 'data', 'stale'), { recursive: true });

    let nodeModulesExistedAoBundlar = null;
    const fakeEnsureNodePortable = vi.fn().mockImplementation(async ({ cacheDir }) => {
      const nodeDir = path.join(cacheDir, 'fake-node');
      await fs.mkdir(nodeDir, { recursive: true });
      await fs.writeFile(path.join(nodeDir, 'node.exe'), 'fake-node-binary');
      return nodeDir;
    });
    const fakeBundleServer = vi.fn().mockImplementation(async ({ outDir: dest }) => {
      nodeModulesExistedAoBundlar = await fs
        .stat(path.join(dest, 'app', 'node_modules'))
        .then(() => true)
        .catch(() => false);
      await fs.mkdir(path.join(dest, 'app', 'node_modules'), { recursive: true });
    });
    const fakeBuildExeLauncher = vi.fn().mockImplementation(async ({ outDir: dest }) => {
      const exePath = path.join(dest, 'LocalDrawDB.exe');
      await fs.writeFile(exePath, 'fake-exe');
      return exePath;
    });

    await buildWindowsPackage({
      workDir: outDir,
      cacheDir: path.join(outDir, '.cache'),
      ensureNodePortableImpl: fakeEnsureNodePortable,
      bundleServerImpl: fakeBundleServer,
      buildExeLauncherImpl: fakeBuildExeLauncher,
    });

    expect(nodeModulesExistedAoBundlar).toBe(false);
    // Resíduo do build anterior não sobrevive.
    expect(await fs.readdir(path.join(packageDir, 'data'))).toEqual([]);
  }, 30_000);
});
