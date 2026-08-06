// Orquestrador: baixa o Node portátil, bundla servidor+frontend, gera o
// launcher .exe, monta dist-win/LocalDrawDB-win/ e zipa em
// dist-win/LocalDrawDB-win.zip.
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// archiver >= 8 é ESM nativo e não exporta mais a factory default `archiver()`:
// o formato vira uma classe (`ZipArchive`), com o mesmo `pipe`/`directory`/`finalize`.
import { ZipArchive } from 'archiver';
import { ensureNodePortable } from './fetchNode.mjs';
import { bundleServer } from './bundleServer.mjs';
import { buildExeLauncher } from './buildLauncher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

function zipDir(sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, path.basename(sourceDir));
    archive.finalize();
  });
}

export async function buildWindowsPackage({
  workDir = path.join(ROOT, 'dist-win'),
  // Cache fora de workDir por padrão: sobrevive entre builds. Parametrizado
  // pra que o teste não escreva no cache real do repositório.
  cacheDir = path.join(ROOT, '.cache', 'build-win'),
  ensureNodePortableImpl = ensureNodePortable,
  bundleServerImpl = bundleServer,
  buildExeLauncherImpl = buildExeLauncher,
} = {}) {
  const packageDir = path.join(workDir, 'LocalDrawDB-win');
  // Limpeza ANTES de qualquer etapa: bundleServer() faz `fs.rename` do stage
  // temporário pra app/node_modules e falha com ENOTEMPTY se o diretório de
  // um build anterior ainda existir.
  await fs.rm(packageDir, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });

  // 1) Node portátil.
  const nodeDir = await ensureNodePortableImpl({ cacheDir });
  await copyDir(nodeDir, path.join(packageDir, 'node'));

  // 2) Servidor bundlado + node_modules de produção + dist/ do Vite.
  await bundleServerImpl({ outDir: packageDir });

  // 3) Launcher .exe (SEA), usando o node.exe recém-copiado como base.
  await buildExeLauncherImpl({
    outDir: packageDir,
    nodeExePath: path.join(packageDir, 'node', 'node.exe'),
  });

  // 4) data/ vazia — o app cria domains.json/domains/ sozinho no primeiro boot.
  await fs.mkdir(path.join(packageDir, 'data'), { recursive: true });

  // 5) Zip final.
  const zipPath = path.join(workDir, 'LocalDrawDB-win.zip');
  await fs.rm(zipPath, { force: true });
  await zipDir(packageDir, zipPath);

  return zipPath;
}

// Permite `node scripts/build-win/build.mjs` direto, além de `npm run build:win`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const startedAt = Date.now();
  buildWindowsPackage()
    .then(async (zipPath) => {
      const { size } = await fs.stat(zipPath);
      const mb = (size / 1024 / 1024).toFixed(1);
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`Pacote gerado: ${zipPath} (${mb} MB em ${secs}s)`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
