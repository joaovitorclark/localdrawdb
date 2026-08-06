// Gera LocalDrawDB.exe via Node Single Executable Applications (SEA): gera um
// blob a partir do launcher bundlado (Task 3), copia o node.exe Windows
// baixado (Task 1) pro nome final, e injeta o blob com postject. Funciona
// rodando em macOS/Linux — postject só manipula o formato binário PE, não
// precisa executar o .exe (ver "Descobertas técnicas" no topo do plano).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { bundleLauncher } from './bundleLauncher.mjs';

const execFile = promisify(execFileCb);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

export async function buildExeLauncher({ outDir, nodeExePath, execImpl = execFile } = {}) {
  if (!outDir) throw new Error('buildExeLauncher: outDir é obrigatório');
  if (!nodeExePath) throw new Error('buildExeLauncher: nodeExePath é obrigatório');

  const buildDir = path.join(outDir, '.sea-build');
  await fs.mkdir(buildDir, { recursive: true });

  // 1) Bundle do launcher (Task 3).
  const launcherCjs = await bundleLauncher({ outDir: buildDir });

  // 2) Config do SEA. useCodeCache/useSnapshot=false: obrigatório para build
  //    cross-platform (ver "Descobertas técnicas").
  const blobPath = path.join(buildDir, 'sea-prep.blob');
  const seaConfigPath = path.join(buildDir, 'sea-config.json');
  await fs.writeFile(
    seaConfigPath,
    JSON.stringify(
      {
        main: launcherCjs,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    ),
  );

  // 3) Gera o blob.
  await execImpl(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  // 4) Copia o node.exe base pro nome final.
  const exePath = path.join(outDir, 'LocalDrawDB.exe');
  await fs.copyFile(nodeExePath, exePath);

  // 5) Injeta o blob com postject.
  const postjectBin = path.join(HERE, '..', '..', 'node_modules', '.bin', 'postject');
  await execImpl(postjectBin, [
    exePath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    SEA_FUSE,
  ]);

  await fs.rm(buildDir, { recursive: true, force: true });
  return exePath;
}
