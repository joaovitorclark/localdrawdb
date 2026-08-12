import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { DomainMeta, GitStatusResponse } from '../api';
import { formatGitSummary, hostFromRemote, isAuthError } from './gitPanelHelpers';
import { CredentialsWizard } from './CredentialsWizard';

/**
 * `api.ts` monta o erro como `` `${url} -> ${status}: ${serverError}` ``; o que interessa
 * ao usuário é o `serverError`. Mensagens sem esse formato passam inalteradas.
 */
function readableError(msg: string): string {
  return msg.split(': ').slice(1).join(': ') || msg;
}

/** Guard do servidor (`server/git.ts`): trocar de branch com a árvore suja sempre falha. */
function isDirtyTreeError(msg: string): boolean {
  return /n[ãa]o commitadas/i.test(msg);
}

/**
 * Painel de git da toolbar: branch atual, resumo do status e as ações do dia a dia
 * (atualizar/publicar/abrir PR). Erros de credencial abrem o `CredentialsWizard`
 * em vez de despejar a mensagem crua do git na toolbar.
 *
 * Domínio sem git não renderiza nada (`null`).
 *
 * `onRepoChanged` avisa o dono que os ARQUIVOS em disco mudaram (pull ou troca de
 * branch). Sem isso o App continuaria com o modelo carregado na montagem e o
 * autosave gravaria o state antigo por cima do que acabou de ser puxado.
 */
export function GitPanel({
  domain,
  onRepoChanged,
}: {
  domain: DomainMeta;
  onRepoChanged?: () => void;
}) {
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [wizardHost, setWizardHost] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.getGitStatus(domain.id);
      setStatus(s);
    } catch (e: unknown) {
      setStatus(null);
      setMessage((e as Error).message);
      setError(true);
    }
  }, [domain.id]);

  useEffect(() => {
    if (!domain.hasGit) return;
    void refreshStatus();
  }, [domain.hasGit, refreshStatus]);

  if (!domain.hasGit) return null;

  const openWizard = () => setWizardHost(hostFromRemote(domain.remoteUrl) ?? 'seu provedor git');

  /** Erro de credencial vira wizard; o resto vira mensagem inline. */
  const handleFailure = (e: unknown) => {
    const msg = (e as Error)?.message ?? String(e);
    if (isAuthError(msg)) {
      openWizard();
    } else {
      setMessage(msg);
      setError(true);
    }
  };

  /** Envolve uma ação de git com busy/limpeza de mensagem/refresh do status. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    setError(false);
    try {
      await action();
    } catch (e: unknown) {
      handleFailure(e);
    } finally {
      setBusy(false);
      await refreshStatus();
    }
  };

  const handlePull = () =>
    run(async () => {
      await api.gitPull(domain.id);
      setMessage('Atualizado.');
      // O pull reescreveu project.dbml/canvas.json em disco: o dono precisa
      // recarregar o App, senão o autosave sobrescreve o que foi puxado.
      onRepoChanged?.();
    });

  const handlePublish = () => {
    const msg = window.prompt('Mensagem do commit:');
    if (!msg?.trim()) return;
    return run(async () => {
      await api.gitPush(domain.id, msg.trim());
      setMessage('Publicado.');
    });
  };

  const handleSwitchBranch = () => {
    const current = status?.hasGit ? status.branch : '';
    const branch = window.prompt('Trocar para a branch:', current);
    if (!branch?.trim() || branch.trim() === current) return;
    const target = branch.trim();
    return run(async () => {
      try {
        await api.switchGitBranch(domain.id, target, false);
      } catch (e: unknown) {
        // Branch inexistente é o caso comum aqui: oferece criar em vez de só falhar.
        // Erro de credencial ou árvore suja não tem conserto criando a branch: propaga.
        const msg = (e as Error)?.message ?? String(e);
        if (isAuthError(msg) || isDirtyTreeError(msg)) throw e;
        const reason = readableError(msg);
        if (!window.confirm(`${reason}\n\nCriar a branch "${target}"?`)) throw e;
        await api.switchGitBranch(domain.id, target, true);
      }
      setMessage(`Na branch ${target}.`);
      // Trocar de branch troca os arquivos do working tree: mesmo motivo do pull.
      onRepoChanged?.();
    });
  };

  const handleOpenPr = () =>
    run(async () => {
      const { url } = await api.getPrUrl(domain.id);
      if (url) window.open(url, '_blank', 'noreferrer');
      else setMessage('Sem link automático para este host — publique e abra o PR manualmente.');
    });

  const summary = formatGitSummary(status);

  return (
    <div className="git-panel">
      <button
        className="git-panel__branch"
        onClick={() => void handleSwitchBranch()}
        disabled={busy}
        title="Trocar de branch"
      >
        {status?.hasGit ? status.branch : '...'}
      </button>
      {summary && <span className="git-panel__summary">{summary}</span>}
      <button onClick={() => void handlePull()} disabled={busy} title="Puxar mudanças do remoto">
        Atualizar
      </button>
      <button onClick={() => void handlePublish()} disabled={busy} title="Commitar e enviar ao remoto">
        Publicar
      </button>
      <button onClick={() => void handleOpenPr()} disabled={busy} title="Abrir pull request no provedor">
        Abrir PR
      </button>
      <button onClick={openWizard} disabled={busy} title="Configurar token de acesso">
        Credenciais
      </button>
      {message && (
        <span
          className={error ? 'git-panel__message git-panel__message--error' : 'git-panel__message'}
          title={message}
        >
          {error ? readableError(message) : message}
        </span>
      )}
      {wizardHost && (
        <CredentialsWizard
          domainId={domain.id}
          host={wizardHost}
          onDone={() => {
            setWizardHost(null);
            void refreshStatus();
          }}
          onCancel={() => setWizardHost(null)}
        />
      )}
    </div>
  );
}
