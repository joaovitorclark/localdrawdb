import { describe, expect, it } from 'vitest';
import { buildTokenCreationUrl } from '../tokenUrl.ts';

describe('buildTokenCreationUrl', () => {
  it('GitHub', () => {
    expect(buildTokenCreationUrl('github.com')).toContain('github.com/settings/tokens/new');
  });

  it('GitLab', () => {
    expect(buildTokenCreationUrl('gitlab.com')).toContain('gitlab.com');
  });

  it('Bitbucket', () => {
    expect(buildTokenCreationUrl('bitbucket.org')).toContain('bitbucket.org');
  });

  it('Azure DevOps', () => {
    expect(buildTokenCreationUrl('dev.azure.com')).toContain('dev.azure.com');
  });

  it('host desconhecido retorna null', () => {
    expect(buildTokenCreationUrl('git.empresa-interna.com')).toBeNull();
  });
});
