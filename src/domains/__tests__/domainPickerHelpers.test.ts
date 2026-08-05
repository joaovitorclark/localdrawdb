import { describe, expect, it } from 'vitest';
import { sortDomainsByName, domainBadge } from '../domainPickerHelpers';
import type { DomainMeta } from '../../api';

function makeDomain(overrides: Partial<DomainMeta>): DomainMeta {
  return {
    id: '1',
    slug: 'x',
    name: 'X',
    dir: '/tmp/x',
    hasGit: false,
    remoteUrl: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('sortDomainsByName', () => {
  it('ordena alfabeticamente por nome', () => {
    const domains = [makeDomain({ name: 'Zeta' }), makeDomain({ name: 'Alpha' })];
    expect(sortDomainsByName(domains).map((d) => d.name)).toEqual(['Alpha', 'Zeta']);
  });
});

describe('domainBadge', () => {
  it('🔒 Local para domínio sem git', () => {
    expect(domainBadge(makeDomain({ hasGit: false }))).toBe('🔒 Local');
  });

  it('🌿 Git para domínio com git', () => {
    expect(domainBadge(makeDomain({ hasGit: true }))).toBe('🌿 Git');
  });
});
