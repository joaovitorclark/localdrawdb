import type { DomainMeta } from '../api';

export function sortDomainsByName(domains: DomainMeta[]): DomainMeta[] {
  return [...domains].sort((a, b) => a.name.localeCompare(b.name));
}

export function domainBadge(domain: DomainMeta): string {
  return domain.hasGit ? 'Git' : 'Local';
}
