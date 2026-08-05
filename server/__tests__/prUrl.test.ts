import { describe, expect, it } from 'vitest';
import { buildPrUrl } from '../prUrl.ts';

describe('buildPrUrl', () => {
  it('GitHub HTTPS', () => {
    const r = buildPrUrl('https://github.com/acme/repo.git', 'feature/x');
    expect(r).toEqual({ host: 'github.com', url: 'https://github.com/acme/repo/compare/feature/x?expand=1' });
  });

  it('GitHub SSH', () => {
    const r = buildPrUrl('git@github.com:acme/repo.git', 'feature/x');
    expect(r).toEqual({ host: 'github.com', url: 'https://github.com/acme/repo/compare/feature/x?expand=1' });
  });

  it('GitLab HTTPS', () => {
    const r = buildPrUrl('https://gitlab.com/acme/repo.git', 'feature/x');
    expect(r).toEqual({
      host: 'gitlab.com',
      url: 'https://gitlab.com/acme/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fx',
    });
  });

  it('Bitbucket HTTPS', () => {
    const r = buildPrUrl('https://bitbucket.org/acme/repo.git', 'feature/x');
    expect(r).toEqual({
      host: 'bitbucket.org',
      url: 'https://bitbucket.org/acme/repo/pull-requests/new?source=feature%2Fx',
    });
  });

  it('Azure DevOps HTTPS', () => {
    const r = buildPrUrl('https://dev.azure.com/acme/proj/_git/repo', 'feature/x');
    expect(r).toEqual({
      host: 'dev.azure.com',
      url: 'https://dev.azure.com/acme/proj/_git/repo/pullrequestcreate?sourceRef=feature%2Fx',
    });
  });

  it('host desconhecido retorna null', () => {
    expect(buildPrUrl('https://git.empresa-interna.com/acme/repo.git', 'feature/x')).toBeNull();
  });

  it('URL de remote inválida retorna null em vez de lançar', () => {
    expect(buildPrUrl('not-a-url', 'feature/x')).toBeNull();
  });
});
