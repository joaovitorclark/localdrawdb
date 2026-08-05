// Dev orchestrator: aloca portas livres por clone e liga Vite -> API do mesmo projeto.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allocateDevPorts, findFreePort, waitForPort } from './devPorts.mjs';
import { parseDevArgs, resolveSlugs } from './devArgs.mjs';
import { loadRegistry, createProjectCli } from './registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_META = path.join(ROOT, '.localdrawdb-dev.json');
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const VITE_CLI = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

function requireDeps() {
  if (!existsSync(TSX_CLI) || !existsSync(VITE_CLI)) {
    console.error('\nDependencias ausentes. Rode primeiro:\n  npm install\n');
    process.exit(1);
  }
}

requireDeps();

// Subcomando `new <nome>`: cria projeto e sai (não sobe servidor).
if (process.argv[2] === 'new') {
  const name = process.argv.slice(3).join(' ').trim();
  if (!name) {
    console.error('Uso: ./ldb new <nome>');
    process.exit(1);
  }
  const dataDir = process.env.LOCALDRAWDB_DATA_DIR ?? path.join(ROOT, 'data');
  try {
    createProjectCli(name, dataDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  process.exit(0);
}

// Parse args — exits fast on error
let parsed;
try {
  parsed = parseDevArgs(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// --list: imprime os projetos disponíveis e sai (estilo `uv run main.py --list`).
if (parsed.mode === 'list') {
  const dataDir = process.env.LOCALDRAWDB_DATA_DIR ?? path.join(ROOT, 'data');
  let registry;
  try {
    registry = loadRegistry(dataDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const projs = registry.projects ?? [];
  if (projs.length === 0) {
    console.log('Nenhum projeto.');
    process.exit(0);
  }
  const w = Math.max(...projs.map((p) => p.slug.length), 'slug'.length);
  console.log(`\nProjetos (${projs.length}):`);
  console.log(`  ${'slug'.padEnd(w)}  nome`);
  console.log(`  ${'─'.repeat(w)}  ${'─'.repeat(20)}`);
  for (const p of projs) console.log(`  ${p.slug.padEnd(w)}  ${p.name ?? ''}`);
  console.log();
  process.exit(0);
}

// Collect all child handles for supervision
/** @type {Array<{ server: import('node:child_process').ChildProcess, web: import('node:child_process').ChildProcess|null }>} */
const instances = [];

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const { server, web } of instances) {
    server.kill('SIGTERM');
    web?.kill('SIGTERM');
  }
  try {
    unlinkSync(DEV_META);
  } catch {
    /* ok */
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function supervise(handle) {
  handle.server.on('exit', (code) => {
    if (code && code !== 0) shutdown(code);
  });
  if (handle.web) handle.web.on('exit', (code) => { if (code && code !== 0) shutdown(code); });
}

/**
 * Start one server+vite pair.
 * @param {{ slug: string|null, apiPort: number, webPort: number }} opts
 * @returns {Promise<{ server: import('node:child_process').ChildProcess, web: import('node:child_process').ChildProcess }>}
 */
async function startInstance({ slug, apiPort, webPort }) {
  const env = {
    ...process.env,
    PORT: String(apiPort),
    API_PORT: String(apiPort),
    VITE_PORT: String(webPort),
    // Pin de projeto (./ldb <slug>) só faz sentido dentro do domínio local, então
    // os dois andam juntos. Sem slug, NÃO pina domínio: é a tela de escolha
    // (AppGate/DomainPicker) que decide o domínio ativo.
    ...(slug ? { LOCALDRAWDB_DOMAIN: 'local', LOCALDRAWDB_PROJECT: slug } : {}),
  };

  const nodeArgs = (script, ...args) => [script, ...args];

  const server = spawn(process.execPath, nodeArgs(TSX_CLI, 'watch', 'server/index.ts'), {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  await waitForPort(apiPort);

  const web = spawn(process.execPath, nodeArgs(VITE_CLI, '--port', String(webPort), '--strictPort'), {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  return { server, web };
}

/**
 * Start one preview (production static) instance — no Vite.
 * @param {{ slug: string|null, port: number }} opts
 * @returns {{ server: import('node:child_process').ChildProcess, web: null }}
 */
function startPreviewInstance({ slug, port }) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    // Mesmo critério de startInstance: pin de domínio só acompanha pin de projeto.
    ...(slug ? { LOCALDRAWDB_DOMAIN: 'local', LOCALDRAWDB_PROJECT: slug } : {}),
  };
  const server = spawn(process.execPath, [TSX_CLI, 'server/index.ts'], {
    cwd: ROOT, env, stdio: 'inherit',
  });
  return { server, web: null };
}

if (parsed.preview) {
  // --- Preview mode: serve built dist/ via Fastify static, no Vite ---

  // Step 1: Resolve targets BEFORE building (fail fast on bad slugs)
  let previewSlugs; // string[]|[null] — [null] = shared, string[] = multi
  if (parsed.mode === 'shared') {
    previewSlugs = [null];
  } else {
    const dataDir = process.env.LOCALDRAWDB_DATA_DIR ?? path.join(ROOT, 'data');
    let registry;
    try {
      registry = loadRegistry(dataDir);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    try {
      previewSlugs = resolveSlugs(parsed, registry);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  // Step 2: Build once if dist/index.html doesn't exist
  const distIndex = path.join(ROOT, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    console.log('Buildando dist/ ...');
    await new Promise((resolve, reject) => {
      const build = spawn(process.execPath, [VITE_CLI, 'build'], {
        cwd: ROOT,
        stdio: 'inherit',
      });
      build.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`vite build falhou com código ${code}`));
      });
    }).catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
  } else {
    console.log('(reusando dist/ existente)');
  }

  // Step 3: Allocate one port per instance
  const used = new Set();
  /** @type {Array<{ slug: string|null, port: number }>} */
  const previewMeta = [];
  for (const slug of previewSlugs) {
    const port = await findFreePort(Number(process.env.PORT) || 5174, '127.0.0.1', used);
    used.add(port);
    previewMeta.push({ slug, port });
  }

  // Step 4: Write meta
  writeFileSync(
    DEV_META,
    JSON.stringify(
      {
        instances: previewMeta.map(({ slug, port }) => ({
          slug,
          apiPort: port,
          webPort: port,
          preview: true,
        })),
        root: ROOT,
      },
      null,
      2,
    ),
  );

  // Step 5: Print table
  const slugLabels = previewMeta.map(({ slug }) => slug ?? '(shared)');
  const colW = Math.max(...slugLabels.map((s) => s.length), 'projeto'.length);
  console.log(`\nlocaldrawdb preview`);
  console.log(`  ${'projeto'.padEnd(colW)}  url`);
  console.log(`  ${'─'.repeat(colW)}  ${'─'.repeat(30)}`);
  for (let i = 0; i < previewMeta.length; i++) {
    console.log(`  ${slugLabels[i].padEnd(colW)}  http://127.0.0.1:${previewMeta[i].port}`);
  }
  console.log();

  // Step 6: Spawn and supervise (process stays alive via child supervision / signal handlers)
  for (const { slug, port } of previewMeta) {
    const handle = startPreviewInstance({ slug, port });
    instances.push(handle);
    supervise(handle);
  }
} else {
  // --- Dev mode (non-preview) — unchanged from F2 ---

  // Resolve slugs for multi mode
  let slugs; // null = shared mode, string[] = multi mode
  if (parsed.mode === 'shared') {
    slugs = null;
  } else {
    // multi or all — need to read registry
    const dataDir = process.env.LOCALDRAWDB_DATA_DIR ?? path.join(ROOT, 'data');
    let registry;
    try {
      registry = loadRegistry(dataDir);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    try {
      slugs = resolveSlugs(parsed, registry);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  if (slugs === null) {
    // Shared mode — identical to today's behavior
    const { apiPort, webPort } = await allocateDevPorts();

    writeFileSync(DEV_META, JSON.stringify({ instances: [{ slug: null, apiPort, webPort }], root: ROOT }, null, 2));

    console.log(`\nlocaldrawdb dev`);
    console.log(`  projeto: ${ROOT}`);
    console.log(`  web:     http://127.0.0.1:${webPort}`);
    console.log(`  api:     http://127.0.0.1:${apiPort}\n`);

    let handle;
    try {
      handle = await startInstance({ slug: null, apiPort, webPort });
    } catch (err) {
      console.error(String(err));
      try { unlinkSync(DEV_META); } catch { /* ok */ }
      process.exit(1);
    }

    instances.push(handle);
    supervise(handle);
  } else {
    // Multi mode — one instance per slug
    /** @type {Array<{ slug: string, apiPort: number, webPort: number }>} */
    const instanceMeta = [];

    const usedPorts = new Set();
    for (const slug of slugs) {
      const { apiPort, webPort } = await allocateDevPorts(process.env, usedPorts);
      usedPorts.add(apiPort);
      usedPorts.add(webPort);
      instanceMeta.push({ slug, apiPort, webPort });
    }

    // Write meta before spawning (supervisor may read it)
    writeFileSync(DEV_META, JSON.stringify({ instances: instanceMeta.map(m => ({ slug: m.slug, apiPort: m.apiPort, webPort: m.webPort })), root: ROOT }, null, 2));

    // Print table
    const colW = Math.max(...slugs.map(s => s.length), 'projeto'.length);
    console.log(`\nlocaldrawdb dev — modo multi`);
    console.log(`  ${'projeto'.padEnd(colW)}  web    api`);
    console.log(`  ${'─'.repeat(colW)}  ─────  ─────`);
    for (const { slug, apiPort, webPort } of instanceMeta) {
      console.log(`  ${slug.padEnd(colW)}  ${webPort}  ${apiPort}`);
    }
    console.log();

    // Spawn all instances sequentially (each waits for its API port before continuing)
    for (const { slug, apiPort, webPort } of instanceMeta) {
      let handle;
      try {
        handle = await startInstance({ slug, apiPort, webPort });
      } catch (err) {
        console.error(`Erro ao iniciar instância '${slug}': ${err}`);
        shutdown(1);
        break;
      }
      instances.push(handle);
      supervise(handle);
    }
  }
}
