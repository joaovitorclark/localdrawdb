// Baixa e cacheia o Node.js portátil win-x64 — o runtime embutido no pacote
// Windows. Cache local (gitignored) evita rebaixar em cada `npm run build:win`.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import extractZipDefault from 'extract-zip';

export const NODE_VERSION = '22.11.0';

export function nodeDownloadUrl(version = NODE_VERSION) {
  return `https://nodejs.org/dist/v${version}/node-v${version}-win-x64.zip`;
}

async function pathExists(p) {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false);
}

/**
 * Garante que o Node.js portátil win-x64 esteja extraído em cacheDir.
 * Retorna o caminho da pasta que contém node.exe.
 */
export async function ensureNodePortable({
  version = NODE_VERSION,
  cacheDir,
  fetchImpl = fetch,
  extractImpl = extractZipDefault,
} = {}) {
  if (!cacheDir) throw new Error('ensureNodePortable: cacheDir é obrigatório');

  // extract-zip exige dir absoluto ("Target directory is expected to be
  // absolute"); normalizar aqui blinda qualquer chamador.
  const absCacheDir = path.resolve(cacheDir);

  const nodeDirName = `node-v${version}-win-x64`;
  const nodeDir = path.join(absCacheDir, nodeDirName);
  const nodeExe = path.join(nodeDir, 'node.exe');

  if (await pathExists(nodeExe)) {
    return nodeDir;
  }

  await fs.mkdir(absCacheDir, { recursive: true });

  const url = nodeDownloadUrl(version);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Falha ao baixar Node portátil (${res.status}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  const zipPath = path.join(absCacheDir, `${nodeDirName}.zip`);
  await fs.writeFile(zipPath, buf);

  await extractImpl(zipPath, { dir: absCacheDir });
  await fs.rm(zipPath, { force: true });

  if (!(await pathExists(nodeExe))) {
    throw new Error(`Extração não produziu node.exe em ${nodeExe}`);
  }
  return nodeDir;
}
