// Wrapper fino sobre o `git` do sistema (child_process). Sem lib de git em
// JS — decisão da Spec A (robustez de auth/SSH/LFS de graça).
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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

// Opções comuns a todo spawn de `git`:
// - `GIT_TERMINAL_PROMPT=0`: sem isso, um `pull`/`clone` contra repo privado sem
//   credencial configurada fica pendurado pedindo login no terminal — segurando
//   a requisição HTTP indefinidamente.
// - `timeout`: rede lenta/remote inacessível não pode virar request eterno.
// - `maxBuffer`: saídas grandes (clone verboso, status enorme) não podem matar
//   o comando com ENOBUFS no default de 1MB.
function spawnOptions(cwd: string) {
  return {
    cwd,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  };
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  files: string[];
  branches: string[];
}

function run(cwd: string, args: string[], opts: { trim?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, spawnOptions(cwd), (err, stdout, stderr) => {
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
  await run(path.dirname(destDir), ['clone', url, destDir]);
}

export async function initRepo(dir: string, remoteUrl?: string): Promise<void> {
  await run(dir, ['init']);
  if (remoteUrl) {
    await run(dir, ['remote', 'add', 'origin', remoteUrl]);
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
