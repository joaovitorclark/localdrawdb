// Deep-link para a tela de criação de token por host. Host desconhecido
// retorna null — a UI mostra instrução textual genérica nesse caso.
export function buildTokenCreationUrl(host: string): string | null {
  if (host === 'github.com') {
    return 'https://github.com/settings/tokens/new?description=LocalDrawDB&scopes=repo';
  }
  if (host === 'gitlab.com') {
    return 'https://gitlab.com/-/user_settings/personal_access_tokens?name=LocalDrawDB&scopes=write_repository';
  }
  if (host === 'bitbucket.org') {
    return 'https://bitbucket.org/account/settings/app-passwords/new';
  }
  if (host === 'dev.azure.com') {
    return 'https://dev.azure.com/_usersSettings/tokens';
  }
  return null;
}
