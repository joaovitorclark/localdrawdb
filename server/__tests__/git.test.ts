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
    mockExecFileOnce('main'); // rev-parse --abbrev-ref HEAD
    mockExecFileOnce(' M src/App.tsx\n?? novo.txt'); // status --porcelain
    mockExecFileFail('no upstream'); // rev-list ahead/behind (sem upstream)
    const { getStatus } = await import('../git.ts');
    const status = await getStatus('/tmp/repo');
    expect(status.branch).toBe('main');
    expect(status.dirty).toBe(true);
    expect(status.files).toEqual(['src/App.tsx', 'novo.txt']);
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
  });

  it('sem mudanças pendentes: dirty=false', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
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
    mockExecFileFail('no upstream');
    const { pull } = await import('../git.ts');
    await expect(pull('/tmp/repo')).rejects.toThrow(/não commitadas/i);
  });

  it('roda `git pull` quando não há mudanças pendentes', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce('0\t0');
    mockExecFileOnce('Already up to date.');
    const { pull } = await import('../git.ts');
    await expect(pull('/tmp/repo')).resolves.toBeUndefined();
    expect(execFileMock).toHaveBeenCalledTimes(4);
  });
});

describe('switchBranch', () => {
  it('bloqueia quando há mudanças não commitadas', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce(' M src/App.tsx');
    mockExecFileFail('no upstream');
    const { switchBranch } = await import('../git.ts');
    await expect(switchBranch('/tmp/repo', 'outra')).rejects.toThrow(/não commitadas/i);
  });

  it('usa `switch -c` quando create=true', async () => {
    mockExecFileOnce('main');
    mockExecFileOnce('');
    mockExecFileOnce('0\t0');
    mockExecFileOnce('');
    const { switchBranch } = await import('../git.ts');
    await switchBranch('/tmp/repo', 'nova', true);
    const lastCall = execFileMock.mock.calls.at(-1)!;
    expect(lastCall[1]).toEqual(['switch', '-c', 'nova']);
  });
});

describe('commitAndPush', () => {
  it('lança erro claro quando não há nada para publicar', async () => {
    mockExecFileOnce('main'); // currentBranch
    mockExecFileOnce(''); // add -A
    mockExecFileOnce(''); // status --porcelain (vazio = nada pendente)
    const { commitAndPush } = await import('../git.ts');
    await expect(commitAndPush('/tmp/repo', 'msg')).rejects.toThrow(/nada para publicar/i);
  });

  it('commita e publica quando há mudanças', async () => {
    mockExecFileOnce('main'); // currentBranch
    mockExecFileOnce(''); // add -A
    mockExecFileOnce(' M src/App.tsx'); // status --porcelain
    mockExecFileOnce(''); // commit
    mockExecFileOnce(''); // push
    const { commitAndPush } = await import('../git.ts');
    const result = await commitAndPush('/tmp/repo', 'minha mensagem');
    expect(result).toEqual({ branch: 'main' });
    const pushCall = execFileMock.mock.calls.at(-1)!;
    expect(pushCall[1]).toEqual(['push', '-u', 'origin', 'main']);
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
