import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundleServer } from '../bundleServer.mjs';

let outDir;

beforeEach(async () => {
  // realpath: no macOS os.tmpdir() é /var/folders/... (symlink para
  // /private/var/folders/...) e o Node resolve o symlink do entrypoint ESM,
  // então o ROOT que o bundle enxerga vem já resolvido. Sem isso, comparar
  // caminhos com o que o servidor devolve falha por causa do symlink.
  outDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-bundleserver-')));
});

afterEach(async () => {
  await fs.rm(outDir, { recursive: true, force: true });
});

// Este teste roda o esbuild/vite/npm de VERDADE (sem mock) — é o que garante,
// de fato, que o bundle funciona (é exatamente o que pegou os dois bugs reais
// documentados em "Descobertas técnicas" no início do plano). Mais lento
// (~10-20s), mas é a única forma de saber se o bundle sobe.
describe('bundleServer', () => {
  it('gera server.bundle.mjs válido, node_modules de produção e dist/, e o bundle sobe e responde', async () => {
    await bundleServer({ outDir });

    const bundlePath = path.join(outDir, 'app', 'server.bundle.mjs');
    const bundleExists = await fs.stat(bundlePath).then((s) => s.isFile()).catch(() => false);
    expect(bundleExists).toBe(true);

    const nodeModulesFastify = path.join(outDir, 'app', 'node_modules', 'fastify');
    const fastifyExists = await fs.stat(nodeModulesFastify).then((s) => s.isDirectory()).catch(() => false);
    expect(fastifyExists).toBe(true);

    // devDependencies NÃO devem estar presentes (só "dependencies")
    const viteInNodeModules = await fs
      .stat(path.join(outDir, 'app', 'node_modules', 'vite'))
      .then(() => true)
      .catch(() => false);
    expect(viteInNodeModules).toBe(false);

    const distIndexPath = path.join(outDir, 'dist', 'index.html');
    const distExists = await fs.stat(distIndexPath).then((s) => s.isFile()).catch(() => false);
    expect(distExists).toBe(true);

    // Cadeia public/favicon.ico -> Vite -> dist/ -> pacote -> IconLocation do
    // atalho (edgeAppMode.mjs aponta pra outDir/dist/favicon.ico): nada mais
    // neste repo cobre isso automaticamente, e um vite.config que pare de
    // copiar public/ silenciosamente quebraria só o ícone, sem quebrar o app.
    const distFaviconPath = path.join(outDir, 'dist', 'favicon.ico');
    const faviconExists = await fs.stat(distFaviconPath).then((s) => s.isFile()).catch(() => false);
    expect(faviconExists).toBe(true);

    // Smoke test real: sobe o bundle com o Node local e confere que responde.
    // ROOT resolve para `outDir` (um nível acima de app/server.bundle.mjs) —
    // por isso dist/ tem que estar em outDir/dist, não outDir/app/dist.
    const { spawn } = await import('node:child_process');
    const testDataDir = path.join(outDir, 'testdata');
    await fs.mkdir(testDataDir, { recursive: true });
    const port = 58999 + Math.floor(Math.random() * 500);

    const child = spawn(process.execPath, [bundlePath], {
      cwd: outDir,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        LOCALDRAWDB_DATA_DIR: testDataDir,
      },
      stdio: 'pipe',
    });

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout esperando o servidor subir')), 15_000);
        const tryConnect = async () => {
          try {
            const res = await fetch(`http://127.0.0.1:${port}/api/meta`);
            if (res.ok) {
              clearTimeout(timer);
              resolve(await res.json());
            } else {
              setTimeout(tryConnect, 300);
            }
          } catch {
            setTimeout(tryConnect, 300);
          }
        };
        tryConnect();
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/meta`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toHaveProperty('gitAvailable');
      // O que realmente importa aqui: o ROOT que o bundle calcula
      // (server/paths.ts, via import.meta.url) tem que resolver para `outDir`,
      // um nível acima de app/server.bundle.mjs — é isso que faz o dist/ ser
      // achado em outDir/dist e não em outDir/app/dist.
      expect(body.root).toBe(outDir);
      // dataDir é ROOT/data por construção (server/paths.ts), constante: /api/meta
      // devolve DATA_DIR, que NÃO olha LOCALDRAWDB_DATA_DIR (só baseDataDir(),
      // usado pelas rotas de dados, olha). Então o esperado aqui é outDir/data.
      expect(body.dataDir).toBe(path.join(outDir, 'data'));
    } finally {
      child.kill();
    }
  }, 60_000);
});
