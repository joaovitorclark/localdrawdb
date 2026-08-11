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

  // 3) Gera o blob. O blob do SEA é acoplado à versão exata do Node que o
  //    gera — injetá-lo num node.exe de outra versão crasha ao abrir com
  //    STATUS_ACCESS_VIOLATION (0xC0000005) e nenhuma saída em stdout/stderr
  //    (visto rodando de verdade em windows-latest via CI: o builder tinha
  //    Node 22.23.2 do setup-node, mas nodeExePath é o portátil pinado em
  //    22.11.0 — versões diferentes). Em host Windows, gerar o blob com o
  //    PRÓPRIO nodeExePath (a versão que vai receber a injeção) elimina esse
  //    descompasso. Em host macOS/Linux (cross-build do pacote Windows) isso
  //    não é possível — nodeExePath é um binário win32 que não roda ali —
  //    então cai para process.execPath, aceitando o mesmo risco de
  //    descompasso de versão nesse caminho (documentado no README).
  const seaGeneratorNode = process.platform === 'win32' ? nodeExePath : process.execPath;
  await execImpl(seaGeneratorNode, ['--experimental-sea-config', seaConfigPath]);

  // 4) Copia o node.exe base pro nome final.
  const exePath = path.join(outDir, 'LocalDrawDB.exe');
  await fs.copyFile(nodeExePath, exePath);

  // 5) Injeta o blob com postject. Aponta direto pro cli.js e roda com o Node
  //    atual (process.execPath) em vez de usar node_modules/.bin/postject: em
  //    host Windows esse caminho é um shim .cmd/.ps1, que execFile sem shell
  //    não executa — mesma classe de problema que NPM_BIN/NPX_BIN resolveram em
  //    bundleServer.mjs. Assim não depende de shim em SO nenhum.
  const postjectCli = path.join(HERE, '..', '..', 'node_modules', 'postject', 'dist', 'cli.js');
  await execImpl(process.execPath, [
    postjectCli,
    exePath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    SEA_FUSE,
  ]);

  await fs.rm(buildDir, { recursive: true, force: true });
  return exePath;
}
