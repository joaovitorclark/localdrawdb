// Lógica pura de resolução de paths do launcher — separada do launcherSrc.mjs
// justamente pra ser testável fora do Windows (o resto do launcher spawna um
// binário PE, que só roda no Windows).
import path from 'node:path';

export function resolveLauncherPaths(launcherDir) {
  return {
    nodeExe: path.join(launcherDir, 'node', 'node.exe'),
    serverScript: path.join(launcherDir, 'app', 'server.bundle.mjs'),
    dataDir: path.join(launcherDir, 'data'),
  };
}
