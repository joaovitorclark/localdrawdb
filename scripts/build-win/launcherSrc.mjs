// Fonte do launcher — bundlado (bundleLauncher.mjs) e depois transformado num
// .exe Windows via Node SEA (Task 4). Sobe o servidor local, espera responder,
// e abre a UI numa janela de aplicativo do Edge (fallback: navegador padrão).
// Fechar o processo encerra o servidor filho.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveLauncherPaths } from './launcherPaths.mjs';
import { findFreePort, waitForPort } from '../devPorts.mjs';
import { ensureDesktopShortcut, openApp } from './edgeAppMode.mjs';

async function main() {
  // process.execPath é o caminho real do .exe em execução — não __dirname
  // (que, num binário SEA, reflete o momento do build, não onde o usuário
  // extraiu o zip).
  const launcherDir = process.env.LOCALDRAWDB_LAUNCHER_DIR
    ?? path.dirname(process.execPath);
  const { nodeExe, serverScript } = resolveLauncherPaths(launcherDir);

  const port = await findFreePort(5174, '127.0.0.1');

  // Sem LOCALDRAWDB_DATA_DIR aqui de propósito: o servidor deriva DATA_DIR do
  // ROOT (calculado do import.meta.url do próprio bundle), que aponta pro mesmo
  // diretório — a env var seria redundante. E é mais que redundante: em
  // server/files.ts ela é um override de teste/legado que desliga a checagem de
  // domínio ativo, então setá-la em produção faria as rotas responderem 200 sem
  // domínio escolhido e gravarem dados órfãos fora de data/domains/<slug>/.
  const child = spawn(nodeExe, [serverScript], {
    cwd: launcherDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
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
  let serverReady = false;
  const childFailed = new Promise((_resolve, reject) => {
    child.on('error', (err) => {
      spawnFailed = true;
      err.launcherMessage = `Não foi possível iniciar o servidor (${nodeExe}): ${err.message}`;
      reject(err);
    });
    // O caso mais provável na prática não é falha de spawn: é o node.exe subir
    // e o server.bundle.mjs *morrer no boot* antes de abrir a porta (ex.:
    // migrateLegacyDomains() falhando num data/ meio extraído). Esta saída
    // precoce também precisa cortar a espera — do contrário o launcher fica os
    // 30s inteiros do waitForPort e ainda imprime "não respondeu a tempo" por
    // cima do erro real que o servidor já mostrou via stdio: 'inherit'.
    child.on('exit', (code) => {
      if (shuttingDown || spawnFailed) return;
      if (serverReady) {
        // Já tinha respondido: o launcher só espelha o código de saída do
        // servidor (é ele quem segura o processo vivo depois de main()).
        process.exitCode = code ?? 0;
        return;
      }
      const err = new Error(`servidor encerrou com código ${code ?? 0}`);
      err.launcherMessage = `O servidor encerrou antes de responder (código ${code ?? 0}). Veja a mensagem acima.`;
      reject(err);
    });
  });
  // Os race abaixo só consomem a rejeição se ela chegar primeiro; sem este
  // catch, uma falha tardia viraria unhandled rejection.
  childFailed.catch(() => {});
  const childSpawned = new Promise((resolve) => child.once('spawn', resolve));

  try {
    // Só começa a esperar a porta depois do spawn confirmar. Não é detalhe: o
    // waitForPort segura o event loop com os próprios timers de retry, então
    // largá-lo num Promise.race não encurta nada — o processo ficaria os 30s
    // inteiros vivo mesmo já sabendo da falha (e com SIGINT/SIGTERM inúteis
    // nesse meio tempo). Falhando antes de entrar nele, o launcher sai na hora.
    await Promise.race([childSpawned, childFailed]);
    await Promise.race([waitForPort(port, '127.0.0.1', 30_000), childFailed]);
    serverReady = true;
  } catch (err) {
    console.error(err.launcherMessage ?? `LocalDrawDB não respondeu a tempo: ${err.message}`);
    child.kill();
    process.exitCode = 1;
    return;
  }

  const url = `http://127.0.0.1:${port}`;
  // Janela de aplicativo primeiro: é o que o usuário está esperando ver.
  await openApp({ url, launcherDir });
  // Atalho depois, e só na primeira execução — a janela já está abrindo, então
  // o meio segundo do PowerShell não atrasa nada que o usuário perceba.
  await ensureDesktopShortcut({ launcherDir });
}

// exitCode (e não process.exit) para não derrubar o processo à força a partir do
// topo do módulo: se algo já falhou aqui, não há nada pendente segurando o loop,
// então o processo encerra sozinho com código 1 — e o bundle continua sendo um
// módulo carregável (é o que bundleLauncher.test.mjs verifica).
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
