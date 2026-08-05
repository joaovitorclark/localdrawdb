import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLauncherPaths } from '../launcherPaths.mjs';

describe('resolveLauncherPaths', () => {
  it('resolve node.exe, server.bundle.mjs e data/ relativos à pasta do launcher', () => {
    const launcherDir = path.join('C:', 'Users', 'ana', 'Downloads', 'LocalDrawDB-win');
    const paths = resolveLauncherPaths(launcherDir);
    expect(paths.nodeExe).toBe(path.join(launcherDir, 'node', 'node.exe'));
    expect(paths.serverScript).toBe(path.join(launcherDir, 'app', 'server.bundle.mjs'));
    expect(paths.dataDir).toBe(path.join(launcherDir, 'data'));
  });

  it('funciona com launcherDir contendo espaços (caminho comum no Windows: Downloads, Desktop)', () => {
    const launcherDir = path.join('C:', 'Users', 'Ana Clara', 'Desktop', 'LocalDrawDB-win');
    const paths = resolveLauncherPaths(launcherDir);
    expect(paths.nodeExe).toContain('Ana Clara');
    expect(paths.dataDir).toBe(path.join(launcherDir, 'data'));
  });
});
