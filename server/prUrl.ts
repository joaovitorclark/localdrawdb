// Monta a URL de "abrir PR/MR" a partir do remote origin — heurística por
// host. Host desconhecido retorna null (front mostra só a URL crua).

export interface PrUrlResult {
  host: string;
  url: string;
}

/** Normaliza `git@host:owner/repo.git` e `https://host/owner/repo.git` para { host, ownerRepoPath }. */
function parseRemote(remoteUrl: string): { host: string; ownerRepoPath: string } | null {
  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (sshMatch) {
    return { host: sshMatch[1], ownerRepoPath: sshMatch[2] };
  }
  try {
    const url = new URL(remoteUrl);
    const cleanPath = url.pathname.replace(/^\/+/, '').replace(/\.git$/, '');
    return { host: url.host, ownerRepoPath: cleanPath };
  } catch {
    return null;
  }
}

export function buildPrUrl(remoteUrl: string, branch: string): PrUrlResult | null {
  const parsed = parseRemote(remoteUrl);
  if (!parsed) return null;
  const { host, ownerRepoPath } = parsed;
  const encodedBranch = encodeURIComponent(branch);

  if (host === 'github.com') {
    return { host, url: `https://github.com/${ownerRepoPath}/compare/${branch}?expand=1` };
  }
  if (host === 'gitlab.com') {
    return {
      host,
      url: `https://gitlab.com/${ownerRepoPath}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodedBranch}`,
    };
  }
  if (host === 'bitbucket.org') {
    return { host, url: `https://bitbucket.org/${ownerRepoPath}/pull-requests/new?source=${encodedBranch}` };
  }
  if (host === 'dev.azure.com') {
    return { host, url: `https://dev.azure.com/${ownerRepoPath}/pullrequestcreate?sourceRef=${encodedBranch}` };
  }
  return null;
}
