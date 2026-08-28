// Spawna e derruba um par server+vite (uma "instância") pinado por
// domínio/projeto via env var. Compartilhado por scripts/dev.mjs (modos
// all/shared/project/preview) e pelo controlboard (server/controlboard.ts),
// que spawna instâncias sob demanda a partir de cliques na UI.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForPort } from './devPorts.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
export const VITE_CLI = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/**
 * Monta o env de uma instância. `domainSlug`+`projectSlug` juntos pinam o
 * domínio/projeto (a instância abre direto, sem tela de escolha); omitidos,
 * a instância sobe "solta" (é a tela de escolha quem decide o domínio).
 * @param {{ domainSlug?: string|null, projectSlug?: string|null, apiPort: number, webPort: number }} opts
 * @param {NodeJS.ProcessEnv} [baseEnv]
 */
export function buildInstanceEnv({ domainSlug, projectSlug, apiPort, webPort }, baseEnv = process.env) {
  return {
    ...baseEnv,
    PORT: String(apiPort),
    API_PORT: String(apiPort),
    VITE_PORT: String(webPort),
    ...(domainSlug && projectSlug ? { LOCALDRAWDB_DOMAIN: domainSlug, LOCALDRAWDB_PROJECT: projectSlug } : {}),
  };
}

/**
 * Sobe um par server+vite. Espera a API responder antes de subir o vite
 * (o front depende da API já estar de pé).
 * @param {{ domainSlug?: string|null, projectSlug?: string|null, apiPort: number, webPort: number }} opts
 * @returns {Promise<{ server: import('node:child_process').ChildProcess, web: import('node:child_process').ChildProcess }>}
 */
export async function startInstance(opts) {
  const { apiPort, webPort } = opts;
  const env = buildInstanceEnv(opts);

  const server = spawn(process.execPath, [TSX_CLI, 'watch', 'server/index.ts'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  await waitForPort(apiPort);

  const web = spawn(process.execPath, [VITE_CLI, '--port', String(webPort), '--strictPort'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  try {
    // Sem isto o orquestrador segue para o próximo projeto enquanto o Vite
    // ainda pode morrer com EADDRINUSE — e as APIs órfãs continuam no ar.
    await new Promise((resolve, reject) => {
      const onExit = (code) => {
        reject(
          new Error(
            `Vite não subiu na porta ${webPort} (código ${code ?? 'null'}). ` +
              `Quase sempre é outro npm run dev ainda rodando.\n` +
              `  lsof -nP -iTCP:${webPort} -sTCP:LISTEN\n` +
              `  kill <PID>`,
          ),
        );
      };
      web.once('exit', onExit);
      waitForPort(webPort, '127.0.0.1', 30_000)
        .then(() => {
          web.off('exit', onExit);
          resolve();
        })
        .catch(reject);
    });
  } catch (err) {
    server.kill('SIGTERM');
    throw err;
  }

  return { server, web };
}

/**
 * Sobe uma instância de preview (produção estática) — sem vite.
 * @param {{ domainSlug?: string|null, projectSlug?: string|null, port: number }} opts
 * @returns {{ server: import('node:child_process').ChildProcess, web: null }}
 */
export function startPreviewInstance({ domainSlug, projectSlug, port }) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    ...(domainSlug && projectSlug ? { LOCALDRAWDB_DOMAIN: domainSlug, LOCALDRAWDB_PROJECT: projectSlug } : {}),
  };
  const server = spawn(process.execPath, [TSX_CLI, 'server/index.ts'], { cwd: ROOT, env, stdio: 'inherit' });
  return { server, web: null };
}

/**
 * Derruba uma instância (SIGTERM nos dois processos; `web` pode ser null em preview).
 * @param {{ server: import('node:child_process').ChildProcess, web: import('node:child_process').ChildProcess|null }} handle
 */
export function stopInstance({ server, web }) {
  server.kill('SIGTERM');
  web?.kill('SIGTERM');
}
