// Bundla launcherSrc.mjs num único .cjs — Node SEA (Task 4) exige um arquivo
// só, sem acesso a filesystem pra resolver imports/requires de terceiros em
// runtime. launcherSrc.mjs só usa módulos built-in do Node (child_process,
// path) + devPorts.mjs (também sem deps de terceiro), então bundlar pra CJS
// não hita o problema de "Dynamic require" documentado em bundleServer.mjs
// (esse problema vinha de fastify/avvio, que não entram aqui).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function bundleLauncher({ outDir } = {}) {
  if (!outDir) throw new Error('bundleLauncher: outDir é obrigatório');

  const outfile = path.join(outDir, 'launcher.cjs');
  await esbuild.build({
    entryPoints: [path.join(HERE, 'launcherSrc.mjs')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'warning',
  });
  return outfile;
}
