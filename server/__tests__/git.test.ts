import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

function mockExecFileOnce(stdout: string, stderr = '') {
  execFileMock.mockImplementationOnce((_cmd, _args, optsOrCb, cb) => {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
    callback(null, stdout, stderr);
  });
}

function mockExecFileFail(stderr: string) {
  execFileMock.mockImplementationOnce((_cmd, _args, optsOrCb, cb) => {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
    const err = new Error('git failed') as Error & { stderr?: string };
    err.stderr = stderr;
    callback(err, '', stderr);
  });
}

// Falha de spawn: o processo nem chega a rodar, então não há `err.stderr` e o
// callback recebe stderr como string vazia — todo o diagnóstico está em err.message.
function mockExecFileSpawnFail(message: string) {
  execFileMock.mockImplementationOnce((_cmd, _args, optsOrCb, cb) => {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
    callback(new Error(message), '', '');
  });
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe('isGitAvailable', () => {
  it('true quando `git --version` funciona', async () => {
    mockExecFileOnce('git version 2.40.0');
    const { isGitAvailable } = await import('../git.ts');
    expect(await isGitAvailable()).toBe(true);
  });

  it('false quando o comando falha', async () => {
    mockExecFileFail('command not found');
    const { isGitAvailable } = await import('../git.ts');
    expect(await isGitAvailable()).toBe(false);
  });
});

describe('getStatus', () => {
  it('parseia branch, dirty e arquivos modificados', async () => {
    mockExecFileOnce('main'); // branch --show-current
    mockExecFileOnce(' M src/App.tsx\n?? novo.txt'); // status --porcelain
    mockExecFileOnce('main'); // listBranches
    mockExecFileFail('no upstream'); // rev-list ahead/behind (sem upstream)
    const { getStatus } = await import('../git.ts');
    const status = await getStatus('/tmp/repo');
    expect(status.branch).toBe('main');
    expect(status.dirty).toBe(true);
    expect(status.files).toEqual(['src/App.tsx', 'novo.txt']);
    expect(status.branches).toEqual(['main']);
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
  });

  it('sem mudanças pendentes: dirty=false', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce('main');
    mockExecFileOnce('2\t1');
    const { getStatus } = await import('../git.ts');
    const status = await getStatus('/tmp/repo');
    expect(status.dirty).toBe(false);
    expect(status.files).toEqual([]);
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(1);
  });
});

describe('pull', () => {
  it('bloqueia quando há mudanças não commitadas', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce(' M src/App.tsx');
    mockExecFileOnce('main');
    mockExecFileFail('no upstream');
    const { pull } = await import('../git.ts');
    await expect(pull('/tmp/repo')).rejects.toThrow(/não commitadas/i);
  });

  it('roda `git pull` quando não há mudanças pendentes', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce('main');
    mockExecFileOnce('0\t0');
    mockExecFileOnce('Already up to date.');
    const { pull } = await import('../git.ts');
    await expect(pull('/tmp/repo')).resolves.toBeUndefined();
    expect(execFileMock).toHaveBeenCalledTimes(5);
  });
});

describe('switchBranch', () => {
  it('usa `switch` sem pré-checar dirty quando create=false', async () => {
    mockExecFileOnce('');
    const { switchBranch } = await import('../git.ts');
    await switchBranch('/tmp/repo', 'outra');
    expect(execFileMock.mock.calls[0][1]).toEqual(['switch', 'outra']);
  });

  it('usa `switch -c` quando create=true, mesmo com árvore suja (não chama status)', async () => {
    mockExecFileOnce('');
    const { switchBranch } = await import('../git.ts');
    await switchBranch('/tmp/repo', 'nova', true);
    expect(execFileMock.mock.calls[0][1]).toEqual(['switch', '-c', 'nova']);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});

describe('commit', () => {
  it('lança quando não há nada pendente após add', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce('');
    const { commit } = await import('../git.ts');
    await expect(commit('/tmp/repo', 'msg')).rejects.toThrow(/nada para commitar/i);
  });

  it('add + commit, sem push', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce(' M a.dbml');
    mockExecFileOnce('');
    const { commit } = await import('../git.ts');
    await expect(commit('/tmp/repo', 'wip')).resolves.toEqual({ branch: 'main' });
    const cmds = execFileMock.mock.calls.map((c) => c[1] as string[]);
    expect(cmds).toContainEqual(['add', '-A']);
    expect(cmds).toContainEqual(['commit', '-m', 'wip']);
    expect(cmds.some((a) => a[0] === 'push')).toBe(false);
  });
});

describe('push', () => {
  it('recusa working tree suja e não chama git push', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce(' M a.dbml');
    mockExecFileOnce('main');
    mockExecFileFail('no upstream');
    const { push } = await import('../git.ts');
    await expect(push('/tmp/repo')).rejects.toThrow(/commite antes de enviar/i);
    expect(execFileMock.mock.calls.some((c) => (c[1] as string[])[0] === 'push')).toBe(false);
  });

  it('recusa quando já tem upstream e ahead=0', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce('main');
    mockExecFileOnce('0\t0');
    mockExecFileOnce('origin/main');
    const { push } = await import('../git.ts');
    await expect(push('/tmp/repo')).rejects.toThrow(/nada para enviar/i);
  });

  it('push -u quando não há upstream (branch nova)', async () => {
    mockExecFileOnce('feat');
    mockExecFileOnce('');
    mockExecFileOnce('feat');
    mockExecFileFail('no origin/feat');
    mockExecFileFail('no origin/feat');
    mockExecFileOnce('');
    const { push } = await import('../git.ts');
    await expect(push('/tmp/repo')).resolves.toEqual({ branch: 'feat' });
    expect(execFileMock.mock.calls.at(-1)![1]).toEqual(['push', '-u', 'origin', 'feat']);
  });
});

describe('remoteUrl', () => {
  it('retorna null quando não há remote origin', async () => {
    mockExecFileFail('No such remote');
    const { remoteUrl } = await import('../git.ts');
    expect(await remoteUrl('/tmp/repo')).toBeNull();
  });

  it('retorna a URL quando existe', async () => {
    mockExecFileOnce('https://github.com/acme/repo.git');
    const { remoteUrl } = await import('../git.ts');
    expect(await remoteUrl('/tmp/repo')).toBe('https://github.com/acme/repo.git');
  });
});

describe('erros do wrapper', () => {
  it('preserva o diagnóstico do spawn quando o git nem chega a rodar', async () => {
    mockExecFileSpawnFail('spawn git ENOENT');
    const { currentBranch } = await import('../git.ts');
    await expect(currentBranch('/tmp/repo')).rejects.toMatchObject({
      name: 'GitError',
      stderr: 'spawn git ENOENT',
    });
  });

  it('redige credenciais embutidas na URL, na mensagem e no stderr', async () => {
    execFileMock.mockImplementationOnce((_cmd, _args, optsOrCb, cb) => {
      const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
      const err = new Error('git failed') as Error & { stderr?: string };
      err.stderr = "fatal: unable to access 'https://me:tok123@github.com/acme/repo.git/'";
      callback(err, '', err.stderr);
    });
    const { cloneRepo } = await import('../git.ts');
    let error!: Error & { stderr: string };
    try {
      await cloneRepo('https://me:tok123@github.com/acme/repo.git', '/tmp/repo');
    } catch (e) {
      error = e as Error & { stderr: string };
    }
    expect(error.message).not.toContain('tok123');
    expect(error.stderr).not.toContain('tok123');
    expect(error.message).toContain('https://***@github.com/acme/repo.git');
    expect(error.stderr).toContain('https://***@github.com/acme/repo.git');
  });
});

describe('credentialApprove', () => {
  it('escreve o payload no stdin do processo git credential approve', async () => {
    const writes: string[] = [];
    execFileMock.mockImplementationOnce((_cmd, args, _opts, cb) => {
      expect(args).toEqual(['credential', 'approve']);
      const child = new EventEmitter() as EventEmitter & { stdin: { write: (s: string) => void; end: () => void } };
      child.stdin = {
        write: (s: string) => writes.push(s),
        end: () => cb(null, '', ''),
      };
      return child;
    });
    const { credentialApprove } = await import('../git.ts');
    await credentialApprove('/tmp/repo', {
      protocol: 'https', host: 'github.com', username: 'me', password: 'tok123',
    });
    expect(writes.join('')).toContain('host=github.com');
    expect(writes.join('')).toContain('password=tok123');
  });
});
