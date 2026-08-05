// Fonte do launcher — bundlado (bundleLauncher.mjs) e depois transformado num
// .exe Windows via Node SEA (Task 4). Sobe o servidor local, espera responder, e
// abre o navegador padrão. Fechar o processo encerra o servidor filho.
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { resolveLauncherPaths } from './launcherPaths.mjs';
import { findFreePort, waitForPort } from '../devPorts.mjs';

async function main() {
  // process.execPath é o caminho real do .exe em execução — não __dirname
  // (que, num binário SEA, reflete o momento do build, não onde o usuário
  // extraiu o zip).
  const launcherDir = process.env.LOCALDRAWDB_LAUNCHER_DIR
    ?? path.dirname(process.execPath);
  const { nodeExe, serverScript, dataDir } = resolveLauncherPaths(launcherDir);

  const port = await findFreePort(5174, '127.0.0.1');

  const child = spawn(nodeExe, [serverScript], {
    cwd: launcherDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      LOCALDRAWDB_DATA_DIR: dataDir,
    },
    stdio: 'inherit',
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Sem este handler, uma falha de spawn (node.exe ausente/corrompido no zip
  // extraído) vira 'error' sem listener — uncaught exception com stack trace na
  // cara do usuário. Aqui vira mensagem legível + exit code 1.
  child.on('error', (err) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`Não foi possível iniciar o servidor (${nodeExe}):`, err.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    if (!shuttingDown) process.exit(code ?? 0);
  });

  try {
    await waitForPort(port, '127.0.0.1', 30_000);
  } catch (err) {
    console.error('LocalDrawDB não respondeu a tempo:', err.message);
    shutdown();
    return;
  }

  exec(`start "" "http://127.0.0.1:${port}"`);
}

// exitCode (e não process.exit) para não derrubar o processo à força a partir do
// topo do módulo: se algo já falhou aqui, não há nada pendente segurando o loop,
// então o processo encerra sozinho com código 1 — e o bundle continua sendo um
// módulo carregável (é o que bundleLauncher.test.mjs verifica).
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
