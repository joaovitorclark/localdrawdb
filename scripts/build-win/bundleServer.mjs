// Bundla server/index.ts com esbuild (código próprio bundlado, dependências
// de terceiro mantidas externas — ver "Descobertas técnicas" no plano: bundlar
// tudo quebra em runtime, tanto em ESM quanto em CJS) e builda o frontend com
// Vite. Produz a estrutura app/ + dist/ que o pacote Windows final usa.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';

const execFileRaw = promisify(execFileCb);
// maxBuffer generoso: `npm install` e `vite build` podem imprimir bastante
// (lista de chunks, warnings) e o default de 1 MB estouraria com ENOBUFS,
// escondendo o erro real.
const execFile = (cmd, args, opts) => execFileRaw(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });

// No Windows, `npm`/`npx` são scripts .cmd; `execFile` sem shell não resolve via
// PATHEXT e, desde o CVE-2024-27980, o Node se recusa a executar .cmd sem shell
// explícito. Resolver o nome completo do binário mantém o script funcional num
// host de desenvolvimento Windows sem precisar de `shell: true`.
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function pathExists(p) {
  return fs.stat(p).then(() => true).catch(() => false);
}

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

export async function bundleServer({ outDir, execImpl = execFile } = {}) {
  if (!outDir) throw new Error('bundleServer: outDir é obrigatório');

  const appDir = path.join(outDir, 'app');
  await fs.mkdir(appDir, { recursive: true });

  // 1) Bundle do servidor — só código próprio, deps de terceiro externas.
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'server', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: path.join(appDir, 'server.bundle.mjs'),
    logLevel: 'warning',
  });

  // 2) node_modules de produção (só "dependencies", sem devDependencies).
  //    Copia package.json + package-lock.json pra um dir isolado e roda
  //    `npm install --omit=dev` lá, depois move o node_modules resultante.
  const stageDir = path.join(outDir, '.npm-stage');
  await fs.mkdir(stageDir, { recursive: true });
  const pkgRaw = await fs.readFile(path.join(ROOT, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const prodPkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: pkg.type,
    dependencies: pkg.dependencies,
  };
  await fs.writeFile(path.join(stageDir, 'package.json'), JSON.stringify(prodPkg, null, 2));
  await fs.copyFile(path.join(ROOT, 'package-lock.json'), path.join(stageDir, 'package-lock.json'));
  await execImpl(NPM_BIN, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stageDir });
  await fs.rename(path.join(stageDir, 'node_modules'), path.join(appDir, 'node_modules'));
  await fs.rm(stageDir, { recursive: true, force: true });

  // 3) Build do Vite (dist/) — reusa o build normal do projeto, depois copia
  //    pra fora de app/ (ROOT do bundle resolve um nível acima de app/, ver
  //    "Descobertas técnicas" no topo do plano).
  await execImpl(NPX_BIN, ['vite', 'build'], { cwd: ROOT });
  const builtDist = path.join(ROOT, 'dist');
  if (!(await pathExists(builtDist))) {
    throw new Error(`vite build não produziu ${builtDist}`);
  }
  await copyDir(builtDist, path.join(outDir, 'dist'));
}
