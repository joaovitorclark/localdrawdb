import { useState } from 'react';
import * as api from '../api';
import { buildTokenCreationUrl } from './tokenUrl';

export function CredentialsWizard({
  domainId,
  host,
  onDone,
  onCancel,
}: {
  domainId: string;
  host: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const tokenUrl = buildTokenCreationUrl(host);

  const handleSubmit = async () => {
    if (!username.trim() || !token.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submitGitCredential(domainId, host, username.trim(), token.trim());
      onDone();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="credentials-wizard__overlay">
      <div className="credentials-wizard">
        <h3>Configurar acesso a {host}</h3>
        <p>
          Para publicar/atualizar por HTTPS, {host} pede um{' '}
          <strong>token de acesso pessoal</strong> no lugar de senha. Gere um token e cole abaixo.
        </p>
        {tokenUrl ? (
          <a href={tokenUrl} target="_blank" rel="noreferrer" className="credentials-wizard__link">
            Abrir página de criar token em {host}
          </a>
        ) : (
          <p>
            Gere um token de acesso pessoal com permissão de repositório no seu provedor ({host}).
          </p>
        )}
        <input
          placeholder="Usuário"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          placeholder="Token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {error && <div className="credentials-wizard__error">{error}</div>}
        <div className="credentials-wizard__actions">
          <button onClick={() => void handleSubmit()} disabled={submitting}>
            Salvar
          </button>
          <button onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
