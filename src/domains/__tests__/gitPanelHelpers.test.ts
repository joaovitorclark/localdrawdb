import { describe, expect, it } from 'vitest';
import { formatGitSummary, hostFromRemote, isAuthError } from '../gitPanelHelpers';

describe('formatGitSummary', () => {
  it('null: string vazia', () => {
    expect(formatGitSummary(null)).toBe('');
  });

  it('sem git: string vazia', () => {
    expect(formatGitSummary({ hasGit: false })).toBe('');
  });

  it('em dia (sem dirty/ahead/behind)', () => {
    expect(
      formatGitSummary({ hasGit: true, branch: 'main', ahead: 0, behind: 0, dirty: false, files: [] }),
    ).toBe('Em dia');
  });

  it('dirty com N arquivos', () => {
    expect(
      formatGitSummary({ hasGit: true, branch: 'main', ahead: 0, behind: 0, dirty: true, files: ['a.dbml', 'b.json'] }),
    ).toBe('● 2 não commitados');
  });

  it('1 arquivo usa singular', () => {
    expect(
      formatGitSummary({ hasGit: true, branch: 'main', ahead: 0, behind: 0, dirty: true, files: ['a.dbml'] }),
    ).toBe('● 1 não commitado');
  });

  it('ahead e behind combinados', () => {
    expect(
      formatGitSummary({ hasGit: true, branch: 'main', ahead: 2, behind: 1, dirty: false, files: [] }),
    ).toBe('↑2 ↓1');
  });

  it('dirty + ahead na mesma linha', () => {
    expect(
      formatGitSummary({ hasGit: true, branch: 'main', ahead: 3, behind: 0, dirty: true, files: ['a.dbml'] }),
    ).toBe('● 1 não commitado ↑3');
  });
});

describe('hostFromRemote', () => {
  it('null para remote null', () => {
    expect(hostFromRemote(null)).toBeNull();
  });

  it('extrai host de URL SSH', () => {
    expect(hostFromRemote('git@github.com:acme/repo.git')).toBe('github.com');
  });

  it('extrai host de URL HTTPS', () => {
    expect(hostFromRemote('https://gitlab.com/acme/repo.git')).toBe('gitlab.com');
  });

  it('ignora credenciais embutidas na URL HTTPS', () => {
    expect(hostFromRemote('https://user:token@github.com/acme/repo.git')).toBe('github.com');
  });

  it('null para string sem forma de URL', () => {
    expect(hostFromRemote('nao-e-uma-url')).toBeNull();
  });
});

describe('isAuthError', () => {
  it('detecta mensagens de autenticação', () => {
    expect(isAuthError('fatal: Authentication failed')).toBe(true);
    expect(isAuthError('remote: Permission denied')).toBe(true);
    expect(isAuthError('could not read Username')).toBe(true);
  });

  it('não marca erro genérico como auth', () => {
    expect(isAuthError('Há mudanças não commitadas')).toBe(false);
  });
});
