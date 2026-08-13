// Abertura da UI em janela de aplicativo (Edge `--app=`) e atalho de Desktop.
// Só é usado pelo pacote Windows (launcherSrc.mjs) — `npm run dev`, `./ldb` e
// `npm start` não passam por aqui.
//
// Todo acesso a plataforma (filesystem, registro, spawn) entra por injeção de
// dependência, como em bundleServer({ execImpl }): é o que permite testar a
// lógica em macOS/Linux, onde não há Edge nem `reg`.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exec, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const EDGE_SUFFIX = path.join('Microsoft', 'Edge', 'Application', 'msedge.exe');
const REGISTRY_KEY =
  'HKLM\\SOFTWARE\\Clients\\StartMenuInternet\\Microsoft Edge\\shell\\open\\command';

async function defaultFileExists(p) {
  return fs
    .stat(p)
    .then((s) => s.isFile())
    .catch(() => false);
}

function defaultQueryRegistry() {
  return new Promise((resolve) => {
    // Nunca rejeita: chave ausente, `reg` fora do PATH ou política restritiva
    // são todos "não achei", não erro fatal — quem chama só quer um caminho
    // ou null.
    execFile('reg', ['query', REGISTRY_KEY, '/ve'], { timeout: 5_000 }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

/**
 * Extrai o executável da saída do `reg query`. A linha de valor vem como
 * `    (Default)    REG_SZ    "C:\...\msedge.exe" --single-argument %1`.
 */
export function parseRegistryCommand(output) {
  if (!output) return null;
  const match = output.match(/REG_SZ\s+(.+)/);
  if (!match) return null;
  const raw = match[1].trim();
  // O caminho vem entre aspas justamente porque contém espaços
  // ("Program Files"); só quando não vier é que dá pra cortar nos argumentos.
  const quoted = raw.match(/^"([^"]+)"/);
  const exe = quoted ? quoted[1] : raw.split(/\s+--/)[0].trim();
  return exe || null;
}

/** Caminho absoluto do msedge.exe, ou null se não houver Edge utilizável. */
export async function findEdgePath({
  env = process.env,
  fileExists = defaultFileExists,
  queryRegistry = defaultQueryRegistry,
} = {}) {
  // (x86) primeiro: o Edge stable instala em "Program Files (x86)" mesmo em
  // Windows 64-bit. LOCALAPPDATA cobre a instalação por usuário (sem admin).
  const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  for (const base of bases) {
    const candidate = path.join(base, EDGE_SUFFIX);
    if (await fileExists(candidate)) return candidate;
  }

  const fromRegistry = parseRegistryCommand(await queryRegistry());
  if (fromRegistry && (await fileExists(fromRegistry))) return fromRegistry;

  return null;
}

function defaultFallbackOpen(url) {
  // Mesmo comando que o launcher usava antes do modo app. As aspas vazias são
  // o *título* que o `start` do cmd.exe exige antes de um alvo entre aspas.
  exec(`start "" "${url}"`);
}

/**
 * Argumentos da janela de aplicativo: sem barra de endereço nem abas, com
 * perfil próprio dentro da pasta portátil (não toca no Edge do usuário) e sem
 * as telas de boas-vindas/navegador padrão, que apareceriam em todo primeiro
 * uso por causa justamente do perfil novo.
 */
export function buildAppModeArgs({ url, profileDir }) {
  return [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

/**
 * Abre a UI em janela de aplicativo do Edge; sem Edge utilizável, abre o
 * navegador padrão (comportamento anterior). Nunca lança: perder o modo app é
 * degradação de experiência, não motivo pra derrubar o launcher.
 */
export async function openApp({
  url,
  launcherDir,
  findEdgePathImpl = findEdgePath,
  spawnImpl = spawn,
  fallbackOpen = defaultFallbackOpen,
  logger = console,
} = {}) {
  const edgePath = await findEdgePathImpl();

  if (!edgePath) {
    logger.warn(
      '[LocalDrawDB] Microsoft Edge não encontrado — abrindo no navegador padrão (sem janela de aplicativo).',
    );
    fallbackOpen(url);
    return { mode: 'default-browser', edgePath: null };
  }

  const profileDir = path.join(launcherDir, 'data', 'edge-profile');
  const child = spawnImpl(edgePath, buildAppModeArgs({ url, profileDir }), {
    detached: true,
    stdio: 'ignore',
  });

  // O Edge pode existir e ainda assim não subir (bloqueio de política, binário
  // corrompido). spawn reporta isso por evento assíncrono — sem este handler
  // seria uncaught exception, e o usuário ficaria sem janela nenhuma.
  child.on?.('error', (err) => {
    logger.warn(
      `[LocalDrawDB] Falha ao abrir o Edge (${err.message}) — abrindo no navegador padrão.`,
    );
    fallbackOpen(url);
  });
  child.unref?.();

  return { mode: 'edge-app', edgePath };
}

const defaultExecFile = promisify(execFile);

// Criar .lnk exige o COM WScript.Shell — não há API de Node pra isso, e o
// PowerShell já vem em todo Windows (nada a instalar).
//
// Os caminhos chegam por variável de ambiente (`$env:LDB_*`) em vez de
// interpolados no script: caminho de usuário pode conter aspas, espaço ou `$`,
// que quebrariam (ou permitiriam injetar) um script montado por concatenação.
const SHORTCUT_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  // GetFolderPath respeita Área de Trabalho redirecionada (OneDrive, política
  // de grupo); montar o caminho na mão a partir de %USERPROFILE% não respeita.
  '$desktop = [Environment]::GetFolderPath("Desktop")',
  'if (-not $desktop) { throw "Area de Trabalho nao resolvida" }',
  '$lnk = Join-Path $desktop "LocalDrawDB.lnk"',
  '$shell = New-Object -ComObject WScript.Shell',
  '$s = $shell.CreateShortcut($lnk)',
  '$s.TargetPath = $env:LDB_TARGET',
  '$s.WorkingDirectory = $env:LDB_WORKDIR',
  '$s.IconLocation = $env:LDB_ICON',
  '$s.Description = "LocalDrawDB"',
  '$s.Save()',
].join('; ');

/**
 * Garante o atalho na Área de Trabalho, uma única vez por instalação.
 *
 * O marcador é `.desktop-shortcut-attempted` (tentativa), não a existência do
 * .lnk: se olhássemos o .lnk, apagar o atalho de propósito faria ele
 * reaparecer na execução seguinte. Depois da primeira tentativa, quem manda é
 * o usuário.
 */
export async function ensureDesktopShortcut({
  launcherDir,
  // Num binário SEA, process.execPath é o próprio LocalDrawDB.exe — que é
  // exatamente o alvo que o atalho deve apontar.
  exePath = process.execPath,
  execImpl = defaultExecFile,
  logger = console,
} = {}) {
  const dataDir = path.join(launcherDir, 'data');
  const marker = path.join(dataDir, '.desktop-shortcut-attempted');

  const alreadyAttempted = await fs
    .stat(marker)
    .then(() => true)
    .catch(() => false);
  if (alreadyAttempted) return { created: false, reason: 'already-attempted' };

  let result;
  try {
    await execImpl(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHORTCUT_SCRIPT],
      {
        timeout: 20_000,
        env: {
          ...process.env,
          LDB_TARGET: exePath,
          LDB_WORKDIR: launcherDir,
          LDB_ICON: path.join(launcherDir, 'dist', 'favicon.ico'),
        },
      },
    );
    result = { created: true };
  } catch (err) {
    logger.warn(
      `[LocalDrawDB] Não foi possível criar o atalho na Área de Trabalho: ${err.message}. ` +
        'O aplicativo funciona normalmente — se quiser, crie o atalho manualmente a partir de LocalDrawDB.exe.',
    );
    result = { created: false, reason: 'error' };
  }

  // Grava o marcador nos dois desfechos — ver comentário no doc-block.
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(marker, new Date().toISOString(), 'utf8');
  } catch {
    // Nem o marcador conseguiu ser gravado: pasta somente-leitura. Não há o
    // que fazer, e isto não pode virar erro de boot.
  }

  return result;
}
