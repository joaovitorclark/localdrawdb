// Wrapper fino sobre o `git` do sistema (child_process). Sem lib de git em
// JS — decisão da Spec A (robustez de auth/SSH/LFS de graça).
import { execFile } from 'node:child_process';
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

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  files: string[];
}

function run(cwd: string, args: string[], opts: { trim?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
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

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await run(dir, ['rev-parse', '--is-inside-work-tree']);
    return true;
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
  return { branch, ahead, behind, dirty: files.length > 0, files };
}

export async function switchBranch(dir: string, branch: string, create = false): Promise<void> {
  const status = await getStatus(dir);
  if (status.dirty) {
    throw new Error('Há mudanças não commitadas — salve ou commite antes de trocar de branch.');
  }
  await run(dir, create ? ['switch', '-c', branch] : ['switch', branch]);
}

export async function pull(dir: string): Promise<void> {
  const status = await getStatus(dir);
  if (status.dirty) {
    throw new Error('Há mudanças não commitadas — salve ou commite antes de atualizar.');
  }
  await run(dir, ['pull']);
}

export async function commitAndPush(dir: string, message: string): Promise<{ branch: string }> {
  const branch = await currentBranch(dir);
  await run(dir, ['add', '-A']);
  const pending = await run(dir, ['status', '--porcelain']);
  if (!pending) {
    throw new Error('Nada para publicar — nenhuma mudança pendente.');
  }
  await run(dir, ['commit', '-m', message]);
  await run(dir, ['push', '-u', 'origin', branch]);
  return { branch };
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
    const child = execFile('git', ['credential', 'approve'], { cwd: dir }, (err, _stdout, stderr) => {
      if (err) {
        reject(new GitError('git credential approve falhou', stderr ?? err.message));
        return;
      }
      resolve();
    });
    child.stdin?.write(payload);
    child.stdin?.end();
  });
}
