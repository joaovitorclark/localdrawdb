// Abertura da UI em janela de aplicativo (Edge `--app=`) e atalho de Desktop.
// Só é usado pelo pacote Windows (launcherSrc.mjs) — `npm run dev`, `./ldb` e
// `npm start` não passam por aqui.
//
// Todo acesso a plataforma (filesystem, registro, spawn) entra por injeção de
// dependência, como em bundleServer({ execImpl }): é o que permite testar a
// lógica em macOS/Linux, onde não há Edge nem `reg`.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

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
