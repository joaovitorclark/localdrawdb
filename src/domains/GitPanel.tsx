import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { DomainMeta, GitStatusResponse } from '../api';
import { Chevron } from '../icons';
import { formatGitSummary, hostFromRemote, isAuthError } from './gitPanelHelpers';
import { CredentialsWizard } from './CredentialsWizard';

/**
 * `api.ts` monta o erro como `` `${url} -> ${status}: ${serverError}` ``; o que interessa
 * ao usuário é o `serverError`. Mensagens sem esse formato passam inalteradas.
 */
function readableError(msg: string): string {
  return msg.split(': ').slice(1).join(': ') || msg;
}

/**
 * Painel git da toolbar: um botão com a branch atual abre um dropdown
 * (commit / pull / push, criar branch). Sem `window.prompt`.
 *
 * `onRepoChanged` avisa o dono que os ARQUIVOS em disco mudaram (pull / troca
 * de branch). Sem isso o App continuaria com o modelo carregado na montagem e o
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [wizardHost, setWizardHost] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!domain.hasGit) return null;

  const git = status?.hasGit ? status : null;
  const summary = formatGitSummary(status);
  const branchLabel = git?.branch ?? '...';

  const openWizard = () => setWizardHost(hostFromRemote(domain.remoteUrl) ?? 'seu provedor git');

  const handleFailure = (e: unknown) => {
    const msg = (e as Error)?.message ?? String(e);
    if (isAuthError(msg)) {
      openWizard();
    } else {
      setMessage(msg);
      setError(true);
    }
  };

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

  const handleSwitch = (name: string) => {
    if (!git || name === git.branch) return;
    return run(async () => {
      await api.switchGitBranch(domain.id, name, false);
      setMessage(`Na branch ${name}.`);
      onRepoChanged?.();
    });
  };

  const handleCreateBranch = () => {
    const name = newBranch.trim();
    if (!name) return;
    if (git && name === git.branch) return;
    return run(async () => {
      await api.switchGitBranch(domain.id, name, true);
      setNewBranch('');
      setMessage(`Na branch ${name}.`);
      onRepoChanged?.();
    });
  };

  const handleCommit = () => {
    const msg = commitMsg.trim();
    if (!msg) {
      setMessage('Mensagem de commit é obrigatória.');
      setError(true);
      return;
    }
    return run(async () => {
      await api.gitCommit(domain.id, msg);
      setCommitMsg('');
      setMessage('Commit criado.');
    });
  };

  const handlePull = () =>
    run(async () => {
      await api.gitPull(domain.id);
      setMessage('Atualizado.');
      onRepoChanged?.();
    });

  const handlePush = () =>
    run(async () => {
      await api.gitPush(domain.id);
      setMessage('Enviado.');
    });

  const handleOpenPr = () =>
    run(async () => {
      const { url } = await api.getPrUrl(domain.id);
      if (url) window.open(url, '_blank', 'noreferrer');
      else setMessage('Sem link automático para este host — faça push e abra o PR manualmente.');
    });

  return (
    <div className="git-panel" ref={rootRef}>
      <button
        type="button"
        className="git-panel__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        title="Operações git"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="git-panel__branch">{branchLabel}</span>
        {summary ? <span className="git-panel__summary">{summary}</span> : null}
        <Chevron dir="down" className="icon-inline" size={14} />
      </button>
      {open ? (
        <div className="git-panel__dropdown" role="menu">
          {summary ? <div className="git-panel__status">{summary}</div> : null}
          {git
            ? git.branches.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="menuitem"
                  className={
                    name === git.branch ? 'git-panel__item git-panel__item--current' : 'git-panel__item'
                  }
                  disabled={busy || name === git.branch}
                  onClick={() => void handleSwitch(name)}
                >
                  {name === git.branch ? `${name} (atual)` : name}
                </button>
              ))
            : null}
          <div className="git-panel__row">
            <input
              className="git-panel__input"
              placeholder="nova-branch"
              value={newBranch}
              disabled={busy}
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateBranch();
              }}
            />
            <button type="button" disabled={busy || !newBranch.trim()} onClick={() => void handleCreateBranch()}>
              Criar branch
            </button>
          </div>
          <div className="git-panel__row">
            <input
              className="git-panel__input"
              placeholder="mensagem do commit"
              value={commitMsg}
              disabled={busy}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCommit();
              }}
            />
            <button type="button" disabled={busy} onClick={() => void handleCommit()}>
              commit
            </button>
          </div>
          <button type="button" className="git-panel__item" disabled={busy} onClick={() => void handlePull()}>
            pull
          </button>
          <button type="button" className="git-panel__item" disabled={busy} onClick={() => void handlePush()}>
            push
          </button>
          <button type="button" className="git-panel__item" disabled={busy} onClick={() => void handleOpenPr()}>
            Abrir PR
          </button>
          <button type="button" className="git-panel__item" disabled={busy} onClick={openWizard}>
            Credenciais
          </button>
          {message ? (
            <div
              className={error ? 'git-panel__message git-panel__message--error' : 'git-panel__message'}
              title={message}
            >
              {error ? readableError(message) : message}
            </div>
          ) : null}
        </div>
      ) : null}
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
