// Wrapper fino sobre o `git` do sistema (child_process). Sem lib de git em
// JS — decisão da Spec A (robustez de auth/SSH/LFS de graça).
import { execFile } from 'node:child_process';
import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { baseDataDir } from './domainContext.ts';

export class GitError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'GitError';
    this.stderr = stderr;
  }
}

// URLs de remote podem carregar credenciais embutidas
// (`https://user:token@host/repo.git`). Elas aparecem tanto nos args do comando
// quanto no stderr do git ("fatal: unable to access 'https://user:token@...'"),
// e a mensagem do GitError é o campo mais provável de acabar em log ou resposta
// HTTP — então redigimos antes de construir o erro.
function redactCredentials(text: string): string {
  return text.replace(/(https?:\/\/)[^\s/@]+@/g, '$1***@');
}

// Diretórios-teto para a descoberta de repositório do git: sem isso, um comando
// rodado em `data/domains/<slug>/` que ainda não tem `.git` próprio sobe a
// árvore e encontra o `.git` do PRÓPRIO LocalDrawDB — e como `data/` está no
// `.gitignore` dele, um `commit --allow-empty` + `branch -M main` + `push`
// acabam operando no repositório do LocalDrawDB. Com `GIT_CEILING_DIRECTORIES`
// apontando para `data/`, o git para de subir ali e falha limpo ("not a git
// repository") em vez de vazar. Um `.git` legítimo DENTRO de `data/domains/...`
// continua sendo achado (o teto só impede subir ACIMA de `data/`).
// Inclui o `realpath` porque `os.tmpdir()` no macOS é symlink e o git compara
// contra o caminho já resolvido.
function gitCeilingDirs(): string {
  const raw = baseDataDir();
  const dirs = new Set([raw]);
  try {
    dirs.add(realpathSync(raw));
  } catch {
    // `data/` pode ainda não existir; o caminho cru já cobre o caso comum
  }
  return [...dirs].join(path.delimiter);
}

// Opções comuns a todo spawn de `git`:
// - `GIT_TERMINAL_PROMPT=0`: sem isso, um `pull`/`clone` contra repo privado sem
//   credencial configurada fica pendurado pedindo login no terminal — segurando
//   a requisição HTTP indefinidamente.
// - `GIT_CEILING_DIRECTORIES`: isola a descoberta de repo de `data/` (ver acima).
// - `timeout`: rede lenta/remote inacessível não pode virar request eterno.
// - `maxBuffer`: saídas grandes (clone verboso, status enorme) não podem matar
//   o comando com ENOBUFS no default de 1MB.
function spawnOptions(cwd: string, timeout = 30_000) {
  return {
    cwd,
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CEILING_DIRECTORIES: gitCeilingDirs(),
    },
  };
}

/**
 * Recusa operar quando `dir` não é a raiz de um repositório git próprio —
 * defesa em profundidade sobre `GIT_CEILING_DIRECTORIES`: mesmo que o teto
 * falhe num SO exótico, `commit` / `branch -M` / `push` não rodam num repo
 * ancestral (o do LocalDrawDB).
 *
 * `git rev-parse --git-dir` devolve `.git` (relativo) quando o cwd é a raiz do
 * repo, e um caminho absoluto quando o cwd é um subdiretório de um repo
 * ancestral — é exatamente essa distinção que separa "repo do domínio" de
 * "herdou o repo do LocalDrawDB". Sem tocar no `fs` (a comparação é feita
 * resolvendo o caminho relativo a `dir`).
 */
async function assertOwnRepo(dir: string): Promise<void> {
  try {
    const gitDir = await run(dir, ['rev-parse', '--git-dir']);
    if (path.resolve(dir, gitDir) === path.resolve(dir, '.git')) return;
  } catch {
    // não está dentro de repo nenhum (com o ceiling, o caso comum do bug)
  }
  throw new GitError(
    `Recusado: "${dir}" não é a raiz de um repositório git próprio — ` +
      `operação abortada para não tocar no repositório do LocalDrawDB.`,
    '',
  );
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  files: string[];
  branches: string[];
}

function run(cwd: string, args: string[], opts: { trim?: boolean; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, spawnOptions(cwd, opts.timeout), (err, stdout, stderr) => {
      if (err) {
        // `||` e não `??`: numa falha de spawn (git fora do PATH, cwd inexistente)
        // `err.stderr` é undefined e `stderr` chega como string vazia — que não é
        // nullish e engoliria o `err.message` ("spawn git ENOENT"), o único
        // diagnóstico disponível nesse caso.
        const rawStderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr;
        const stderrText = (rawStderr && rawStderr.trim()) || (stderr && String(stderr).trim()) || err.message;
        reject(new GitError(redactCredentials(`git ${args.join(' ')} falhou`), redactCredentials(stderrText)));
        return;
      }
      // O porcelain do `git status` carrega o código de status nas 2 primeiras
      // colunas (` M arquivo`), então quem parseia posições pede trim: false.
      resolve(opts.trim === false ? String(stdout).replace(/\s+$/, '') : String(stdout).trim());
    });
  });
}

export async function isGitAvailable(): Promise<boolean> {
  try {
    await run(process.cwd(), ['--version']);
    return true;
  } catch {
    return false;
  }
}

// `rev-parse --is-inside-work-tree` responde true para QUALQUER subdiretório de
// QUALQUER repositório ancestral — inclusive `data/domains/<slug>/` dentro do
// próprio clone do LocalDrawDB, o que fazia todo domínio local nascer com
// `hasGit: true` e o remote do projeto (push/switch-branch operariam no repo
// real). Comparamos o toplevel com o próprio `dir`: só é repo se ele for a raiz.
// `fs.realpath` dos dois lados porque `os.tmpdir()` no macOS é symlink
// (`/var` -> `/private/var`) e o git devolve o caminho já resolvido.
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const top = await run(dir, ['rev-parse', '--show-toplevel']);
    const [a, b] = await Promise.all([fs.realpath(top), fs.realpath(dir)]);
    return path.resolve(a) === path.resolve(b);
  } catch {
    return false;
  }
}

export async function currentBranch(dir: string): Promise<string> {
  // `branch --show-current` também funciona em repositório recém-inicializado
  // (branch "unborn", ainda sem commits) — cenário normal logo após
  // attachGitToDomain —, onde `rev-parse --abbrev-ref HEAD` falha com
  // "fatal: ambiguous argument 'HEAD'".
  const name = await run(dir, ['branch', '--show-current']);
  if (name) return name;
  // Vazio = HEAD destacado; mantém o comportamento anterior (retorna "HEAD").
  return run(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export async function listBranches(dir: string): Promise<string[]> {
  const out = await run(dir, ['branch', '--format=%(refname:short)']);
  return out ? out.split('\n') : [];
}

export async function getStatus(dir: string): Promise<GitStatus> {
  const branch = await currentBranch(dir);
  const porcelain = await run(dir, ['status', '--porcelain'], { trim: false });
  const files = porcelain ? porcelain.split('\n').map((l) => l.slice(3).trim()) : [];
  const branches = await listBranches(dir);
  let ahead = 0;
  let behind = 0;
  try {
    const counts = await run(dir, ['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`]);
    const [a, b] = counts.split(/\s+/).map(Number);
    ahead = a ?? 0;
    behind = b ?? 0;
  } catch {
    // sem upstream configurado — sem ahead/behind, não é um erro fatal
  }
  return { branch, ahead, behind, dirty: files.length > 0, files, branches };
}

export async function switchBranch(dir: string, branch: string, create = false): Promise<void> {
  // Sem pré-check de dirty: criar branch (`switch -c`) leva os arquivos sujos
  // junto, como o git. Trocar para existente recusa só se o git recusar.
  // Repo recém-anexado (HEAD unborn) não tem `main` de verdade — um
  // `switch -c feat` sozinho abandonaria o unborn e a lista ficaria só com feat.
  if (create) await ensureInitialCommit(dir);
  await run(dir, create ? ['switch', '-c', branch] : ['switch', branch]);
}

export async function pull(dir: string): Promise<void> {
  const status = await getStatus(dir);
  if (status.dirty) {
    throw new Error('Há mudanças não commitadas — salve ou commite antes de atualizar.');
  }
  await run(dir, ['pull']);
}

export async function commit(dir: string, message: string): Promise<{ branch: string }> {
  const branch = await currentBranch(dir);
  await run(dir, ['add', '-A']);
  const pending = await run(dir, ['status', '--porcelain']);
  if (!pending) {
    throw new Error('Nada para commitar.');
  }
  await run(dir, ['commit', '-m', message]);
  return { branch };
}

async function hasUpstream(dir: string, branch: string): Promise<boolean> {
  try {
    await run(dir, ['rev-parse', '--verify', `origin/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function push(dir: string): Promise<{ branch: string }> {
  const status = await getStatus(dir);
  if (status.dirty) {
    throw new Error('Há mudanças não commitadas — commite antes de enviar.');
  }
  if ((await hasUpstream(dir, status.branch)) && status.ahead === 0) {
    throw new Error('Nada para enviar.');
  }
  await run(dir, ['push', '-u', 'origin', status.branch]);
  return { branch: status.branch };
}

export async function remoteUrl(dir: string): Promise<string | null> {
  try {
    return await run(dir, ['remote', 'get-url', 'origin']);
  } catch {
    return null;
  }
}

export async function cloneRepo(url: string, destDir: string): Promise<void> {
  // Clone só. O first commit (README + arquivos do projeto) roda em
  // `bootstrapEmptyRepo` ao conectar/abrir — senão o registry cria projetos
  // depois e o GitHub fica com commit vazio + working tree suja.
  await run(path.dirname(destDir), ['clone', url, destDir]);
}

export async function initRepo(dir: string, remoteUrl?: string): Promise<void> {
  await run(dir, ['init', '-b', 'main']);
  if (remoteUrl) {
    await run(dir, ['remote', 'add', 'origin', remoteUrl]);
  }
  await bootstrapEmptyRepo(dir);
}

async function hasHead(dir: string): Promise<boolean> {
  try {
    await run(dir, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

async function writeReadmeIfMissing(dir: string): Promise<void> {
  const file = path.join(dir, 'README.md');
  try {
    await fs.access(file);
    return;
  } catch {
    // ainda não existe
  }
  try {
    await fs.writeFile(file, `# ${path.basename(dir)}\n`, 'utf8');
  } catch {
    // unit tests com cwd fictício; o commit --allow-empty ainda cria o HEAD
  }
}

async function gitCommitFirst(dir: string, allowEmpty: boolean): Promise<void> {
  await run(dir, ['add', '-A']);
  if (!allowEmpty) {
    const pending = await run(dir, ['status', '--porcelain']);
    if (!pending) return;
  }
  await run(dir, [
    '-c',
    'user.name=LocalDrawDB',
    '-c',
    'user.email=localdrawdb@localhost',
    'commit',
    ...(allowEmpty ? (['--allow-empty'] as const) : []),
    '-m',
    'first commit',
  ]);
  await run(dir, ['branch', '-M', 'main']);
}

/** Commit inicial em `main` quando o repo ainda não tem HEAD (GitHub vazio / git init). */
async function ensureInitialCommit(dir: string): Promise<void> {
  await assertOwnRepo(dir);
  if (await hasHead(dir)) return;
  await writeReadmeIfMissing(dir);
  await gitCommitFirst(dir, true);
}

/**
 * Sequência da página vazia do GitHub, mesmo sem o usuário editar nada:
 * README, `first commit`, `main`, `push -u origin main`.
 * No-op se `origin/main` já existe (já publicou). Push falho não lança.
 */
export async function bootstrapEmptyRepo(dir: string): Promise<void> {
  // Nunca bootstrapear um diretório que não é a raiz de um repo próprio —
  // senão `add`/`commit`/`push` cairiam no repositório do LocalDrawDB.
  await assertOwnRepo(dir);

  // Já enviado: não auto-commita trabalho sujo em repo que já tem histórico remoto.
  if ((await hasHead(dir)) && (await hasUpstream(dir, 'main'))) return;

  await writeReadmeIfMissing(dir);
  const origin = await remoteUrl(dir);
  let published = false;
  if (origin) {
    try {
      published = Boolean(await run(dir, ['ls-remote', '--heads', 'origin'], { timeout: 8_000 }));
    } catch {
      published = false;
    }
  }

  const headed = await hasHead(dir);
  if (!headed) {
    await gitCommitFirst(dir, true);
  } else if (!published) {
    const dirty = Boolean(await run(dir, ['status', '--porcelain']));
    if (dirty) await gitCommitFirst(dir, false);
  }

  if (origin && !published && (await hasHead(dir))) {
    try {
      await run(dir, ['push', '-u', 'origin', 'main'], { timeout: 20_000 });
    } catch {
      // sem credencial de escrita — commit local já está feito
    }
  }
}

export async function credentialApprove(
  dir: string,
  input: { protocol: string; host: string; username: string; password: string },
): Promise<void> {
  const payload =
    `protocol=${input.protocol}\nhost=${input.host}\nusername=${input.username}\n` +
    `password=${input.password}\n\n`;
  await new Promise<void>((resolve, reject) => {
    const child = execFile('git', ['credential', 'approve'], spawnOptions(dir), (err, _stdout, stderr) => {
      if (err) {
        // Mesmo tratamento do `run()`: `credentialApprove` não passa por ele
        // (precisa do handle do processo pra escrever no stdin), então o
        // fallback com `||` (stderr vazio não engole o err.message) e a redação
        // de credenciais precisam ser repetidos aqui.
        const rawStderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr;
        const stderrText = (rawStderr && rawStderr.trim()) || (stderr && String(stderr).trim()) || err.message;
        reject(new GitError('git credential approve falhou', redactCredentials(stderrText)));
        return;
      }
      resolve();
    });
    child.stdin?.write(payload);
    child.stdin?.end();
  });
}
