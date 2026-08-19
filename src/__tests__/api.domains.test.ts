import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listDomains', () => {
  it('faz GET /api/domains e retorna o corpo', async () => {
    mockFetchOnce(200, { domains: [], activeDomainSlug: null });
    const api = await import('../api.ts');
    const result = await api.listDomains();
    expect(result).toEqual({ domains: [], activeDomainSlug: null });
    expect(fetch).toHaveBeenCalledWith('/api/domains');
  });
});

describe('createDomain', () => {
  it('faz POST /api/domains com o nome', async () => {
    mockFetchOnce(201, { id: '1', slug: 'x', name: 'X' });
    const api = await import('../api.ts');
    await api.createDomain('X');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains');
    expect(JSON.parse(opts.body)).toEqual({ name: 'X' });
  });
});

describe('cloneDomain', () => {
  it('faz POST /api/domains/clone com url e nome', async () => {
    mockFetchOnce(201, { id: '1', slug: 'x', name: 'X' });
    const api = await import('../api.ts');
    await api.cloneDomain('https://github.com/a/b.git', 'X');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains/clone');
    expect(JSON.parse(opts.body)).toEqual({ url: 'https://github.com/a/b.git', name: 'X' });
  });
});

describe('attachGitToDomain', () => {
  it('faz POST na rota attach-git com o remoteUrl', async () => {
    mockFetchOnce(200, { id: '1', slug: 'x', name: 'X' });
    const api = await import('../api.ts');
    await api.attachGitToDomain('dom-1', 'https://github.com/a/b.git');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains/dom-1/attach-git');
    expect(JSON.parse(opts.body)).toEqual({ remoteUrl: 'https://github.com/a/b.git' });
  });
});

describe('deleteDomain', () => {
  it('faz DELETE na rota do domínio', async () => {
    mockFetchOnce(200, { ok: true });
    const api = await import('../api.ts');
    await api.deleteDomain('dom-1');
    expect(fetch).toHaveBeenCalledWith('/api/domains/dom-1', expect.objectContaining({ method: 'DELETE' }));
  });
});

describe('activateDomain', () => {
  it('faz POST na rota activate', async () => {
    mockFetchOnce(200, { ok: true, domain: { id: 'dom-1' } });
    const api = await import('../api.ts');
    const result = await api.activateDomain('dom-1');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains/dom-1/activate');
    expect(opts.method).toBe('POST');
    expect(result.ok).toBe(true);
  });
});

describe('getGitStatus', () => {
  it('faz GET na rota git-status', async () => {
    mockFetchOnce(200, { hasGit: true, branch: 'main', ahead: 0, behind: 0, dirty: false, files: [] });
    const api = await import('../api.ts');
    const result = await api.getGitStatus('dom-1');
    expect(fetch).toHaveBeenCalledWith('/api/domains/dom-1/git-status');
    expect(result.hasGit).toBe(true);
  });
});

describe('switchGitBranch', () => {
  it('envia create=false por padrão', async () => {
    mockFetchOnce(200, { ok: true, branch: 'dev' });
    const api = await import('../api.ts');
    await api.switchGitBranch('dom-1', 'dev');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains/dom-1/git/switch-branch');
    expect(JSON.parse(opts.body)).toEqual({ branch: 'dev', create: false });
  });

  it('propaga create=true', async () => {
    mockFetchOnce(200, { ok: true, branch: 'nova' });
    const api = await import('../api.ts');
    await api.switchGitBranch('dom-1', 'nova', true);
    const [, opts] = (fetch as any).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ branch: 'nova', create: true });
  });
});

describe('gitPull', () => {
  it('propaga o erro do servidor na mensagem', async () => {
    mockFetchOnce(409, { error: 'Há mudanças não commitadas — salve ou commite antes de atualizar.' });
    const api = await import('../api.ts');
    await expect(api.gitPull('dom-1')).rejects.toThrow(/não commitadas/i);
  });
});

describe('gitCommit', () => {
  it('faz POST com a mensagem de commit', async () => {
    mockFetchOnce(200, { ok: true, branch: 'main' });
    const api = await import('../api.ts');
    await api.gitCommit('dom-1', 'feat: x');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains/dom-1/git/commit');
    expect(JSON.parse(opts.body)).toEqual({ message: 'feat: x' });
  });
});

describe('gitPush', () => {
  it('faz POST sem mensagem', async () => {
    mockFetchOnce(200, { ok: true, branch: 'main' });
    const api = await import('../api.ts');
    await api.gitPush('dom-1');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains/dom-1/git/push');
    expect(JSON.parse(opts.body)).toEqual({});
  });
});

describe('getPrUrl', () => {
  it('faz GET na rota do domínio', async () => {
    mockFetchOnce(200, { url: 'https://github.com/a/b/compare/main?expand=1', host: 'github.com', remoteUrl: 'x', branch: 'main' });
    const api = await import('../api.ts');
    const result = await api.getPrUrl('dom-1');
    expect(fetch).toHaveBeenCalledWith('/api/domains/dom-1/git/pr-url');
    expect(result.host).toBe('github.com');
  });
});

describe('submitGitCredential', () => {
  it('faz POST com host/username/token', async () => {
    mockFetchOnce(200, { ok: true });
    const api = await import('../api.ts');
    await api.submitGitCredential('dom-1', 'github.com', 'me', 'tok');
    const [url, opts] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/domains/dom-1/git/credential');
    expect(JSON.parse(opts.body)).toEqual({ host: 'github.com', username: 'me', token: 'tok' });
  });
});

describe('getContext / clearContext', () => {
  it('getContext faz GET /api/context', async () => {
    mockFetchOnce(200, { domain: null });
    const api = await import('../api.ts');
    expect(await api.getContext()).toEqual({ domain: null });
    expect(fetch).toHaveBeenCalledWith('/api/context');
  });

  it('clearContext faz POST /api/context/clear', async () => {
    mockFetchOnce(200, { ok: true });
    const api = await import('../api.ts');
    await api.clearContext();
    expect(fetch).toHaveBeenCalledWith('/api/context/clear', expect.objectContaining({ method: 'POST' }));
  });
});
