// Helper de leitura do registry de projetos para o launcher.
//
// O CLI opera sempre dentro do domínio "local": o registry vive em
// data/domains/local/projects.json (criado pela migração automática).
// O registry só é criado por migrateLegacy(), que roda no
// startup do servidor. Como o launcher precisa ler o registry ANTES de subir
// qualquer servidor (para decidir quais projetos lançar), numa instalação limpa
// o arquivo ainda não existe. Em vez de falhar, fazemos o bootstrap reusando a
// migração canônica de server/files.ts (via tsx), garantindo a mesma lógica
// (incluindo migração de instalações legadas) e então lemos o arquivo.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const ENSURE_REGISTRY = path.join(ROOT, 'scripts', 'ensureRegistry.ts');
const CREATE_PROJECT = path.join(ROOT, 'scripts', 'createProject.ts');

/**
 * Lê o registry de projetos do domínio "local" em `dataDir`, criando-o se ausente.
 * @param {string} dataDir Diretório de dados base (contém domains/local/projects.json).
 * @param {{ tsxCli?: string, ensureScript?: string }} [opts]
 * @returns {{ activeId: string, projects: Array<{ id: string, name: string, slug: string, createdAt: string, updatedAt: string }> }}
 */
export function loadRegistry(dataDir, opts = {}) {
  const tsxCli = opts.tsxCli ?? TSX_CLI;
  const ensureScript = opts.ensureScript ?? ENSURE_REGISTRY;
  const registryPath = path.join(dataDir, 'domains', 'local', 'projects.json');

  // Sempre executa ensureRegistry para sincronizar pastas criadas manualmente.
  // A função é idempotente: só grava quando há mudanças (e.g. nova pasta em projects/).
  const res = spawnSync(process.execPath, [tsxCli, ensureScript], {
    cwd: ROOT,
    env: { ...process.env, LOCALDRAWDB_DATA_DIR: dataDir },
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(
      `Falha ao inicializar o registry de projetos em ${registryPath}` +
        (res.error ? `\n${res.error.message}` : ''),
    );
  }

  return JSON.parse(readFileSync(registryPath, 'utf8'));
}

/**
 * Cria um projeto via CLI, reusando createProject() de files.ts (tsx).
 * @param {string} name
 * @param {string} [dataDir] Diretório de dados (default: env ou data/).
 * @param {{ tsxCli?: string, createScript?: string }} [opts]
 */
export function createProjectCli(name, dataDir = process.env.LOCALDRAWDB_DATA_DIR, opts = {}) {
  const tsxCli = opts.tsxCli ?? TSX_CLI;
  const script = opts.createScript ?? CREATE_PROJECT;
  const env = { ...process.env };
  if (dataDir) env.LOCALDRAWDB_DATA_DIR = dataDir;
  const res = spawnSync(process.execPath, [tsxCli, script, name], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(
      `Falha ao criar projeto "${name}"` + (res.error ? `\n${res.error.message}` : ''),
    );
  }
}
