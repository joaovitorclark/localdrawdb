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

  // Sem tratar 'error', uma falha de spawn (node.exe ausente/corrompido no zip
  // extraído) vira 'error' sem listener — uncaught exception com stack trace na
  // cara do usuário. Aqui vira promise pra também *interromper* as esperas
  // abaixo, em vez de só registrar a falha e deixar o launcher seguir esperando.
  let spawnFailed = false;
  const childFailed = new Promise((_resolve, reject) => {
    child.on('error', (err) => {
      spawnFailed = true;
      err.launcherMessage = `Não foi possível iniciar o servidor (${nodeExe}): ${err.message}`;
      reject(err);
    });
  });
  // Os race abaixo só consomem a rejeição se ela chegar primeiro; sem este
  // catch, um 'error' tardio viraria unhandled rejection.
  childFailed.catch(() => {});
  const childSpawned = new Promise((resolve) => child.once('spawn', resolve));

  child.on('exit', (code) => {
    if (!shuttingDown && !spawnFailed) process.exitCode = code ?? 0;
  });

  try {
    // Só começa a esperar a porta depois do spawn confirmar. Não é detalhe: o
    // waitForPort segura o event loop com os próprios timers de retry, então
    // largá-lo num Promise.race não encurta nada — o processo ficaria os 30s
    // inteiros vivo mesmo já sabendo da falha (e com SIGINT/SIGTERM inúteis
    // nesse meio tempo). Falhando antes de entrar nele, o launcher sai na hora.
    await Promise.race([childSpawned, childFailed]);
    await Promise.race([waitForPort(port, '127.0.0.1', 30_000), childFailed]);
  } catch (err) {
    console.error(err.launcherMessage ?? `LocalDrawDB não respondeu a tempo: ${err.message}`);
    child.kill();
    process.exitCode = 1;
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
