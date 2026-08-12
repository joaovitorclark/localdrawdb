import type { GitStatusResponse } from '../api';

/**
 * Resumo curto do estado do git para a toolbar.
 * Sem git (ou status ainda não carregado) => string vazia, para não ocupar espaço.
 *
 * Os marcadores usados (`●`, `↑`, `↓`) são símbolos geométricos/setas, não emoji
 * pictográfico: a convenção `no-ui-emoji` do projeto proíbe as faixas
 * 2600-27BF/1F300-1FAFF, e por isso o estado limpo é o texto "Em dia" (sem check mark).
 */
export function formatGitSummary(status: GitStatusResponse | null): string {
  if (!status || !status.hasGit) return '';
  const parts: string[] = [];
  if (status.dirty) {
    parts.push(`● ${status.files.length} não commitado${status.files.length === 1 ? '' : 's'}`);
  }
  if (status.ahead > 0) parts.push(`↑${status.ahead}`);
  if (status.behind > 0) parts.push(`↓${status.behind}`);
  return parts.length ? parts.join(' ') : 'Em dia';
}

/**
 * Host do remote, para saber a qual provedor pedir credenciais.
 * Cobre a forma SCP-like do git (`git@host:org/repo.git`), que não é uma URL válida,
 * e delega o resto para `URL` (que também descarta credenciais embutidas).
 */
export function hostFromRemote(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const sshMatch = remoteUrl.match(/^[^@/\s]+@([^:/\s]+):/);
  if (sshMatch) return sshMatch[1];
  try {
    return new URL(remoteUrl).host || null;
  } catch {
    return null;
  }
}

/**
 * Heurística: o erro do git veio de credencial faltando/inválida?
 * Em caso positivo o painel abre o `CredentialsWizard` em vez de só mostrar
 * a mensagem crua do git, que é pouco acionável para o usuário final.
 */
export function isAuthError(message: string): boolean {
  return /auth|credential|autentica|permission denied|403|could not read/i.test(message);
}
