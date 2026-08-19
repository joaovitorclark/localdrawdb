import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { DomainMeta, ProjectMeta } from '../api';
import { sortDomainsByName, domainBadge } from './domainPickerHelpers';

type View = 'domains' | 'projects';
type NewDomainMode = 'local' | 'clone' | null;

export function DomainPicker({ onOpened }: { onOpened: (domain: DomainMeta) => void }) {
  const [view, setView] = useState<View>('domains');
  const [domains, setDomains] = useState<DomainMeta[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<DomainMeta | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newDomainMode, setNewDomainMode] = useState<NewDomainMode>(null);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainUrl, setNewDomainUrl] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachUrl, setAttachUrl] = useState('');

  const refreshDomains = useCallback(async () => {
    try {
      const { domains: list } = await api.listDomains();
      setDomains(list);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshDomains();
  }, [refreshDomains]);

  const openDomain = useCallback(async (domain: DomainMeta) => {
    setError(null);
    try {
      await api.activateDomain(domain.id);
      const { projects: list } = await api.listProjects();
      setSelectedDomain(domain);
      setProjects(list);
      setView('projects');
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, []);

  const backToDomains = useCallback(async () => {
    await api.clearContext().catch(() => {});
    setSelectedDomain(null);
    setProjects([]);
    setView('domains');
    await refreshDomains();
  }, [refreshDomains]);

  const openProject = useCallback(
    async (projectId: string) => {
      if (!selectedDomain) return;
      setError(null);
      try {
        await api.activateProject(projectId);
        onOpened(selectedDomain);
      } catch (e: unknown) {
        setError((e as Error).message);
      }
    },
    [selectedDomain, onOpened],
  );

  const handleCreateDomain = useCallback(async () => {
    setError(null);
    try {
      if (newDomainMode === 'clone') {
        if (!newDomainUrl.trim()) return;
        await api.cloneDomain(newDomainUrl.trim(), newDomainName.trim() || undefined);
      } else {
        if (!newDomainName.trim()) return;
        await api.createDomain(newDomainName.trim());
      }
      setNewDomainMode(null);
      setNewDomainName('');
      setNewDomainUrl('');
      await refreshDomains();
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [newDomainMode, newDomainName, newDomainUrl, refreshDomains]);

  /**
   * Versiona um domínio local (git init + remote opcional). O `DomainMeta`
   * retornado já vem com `hasGit: true`, então substituir o `selectedDomain`
   * atualiza a badge na hora e faz `openProject` abrir a versão correta.
   */
  const handleAttachGit = useCallback(async () => {
    if (!selectedDomain) return;
    setError(null);
    try {
      const updated = await api.attachGitToDomain(selectedDomain.id, attachUrl.trim() || undefined);
      setSelectedDomain(updated);
      setDomains((list) => list.map((d) => (d.id === updated.id ? updated : d)));
      setAttachOpen(false);
      setAttachUrl('');
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [selectedDomain, attachUrl]);

  const handleRemoveDomain = useCallback(
    async (domain: DomainMeta) => {
      const ok = window.confirm(
        `Apagar "${domain.name}" deste computador? O repositório no GitHub não será alterado.`,
      );
      if (!ok) return;
      setError(null);
      try {
        await api.deleteDomain(domain.id);
        await refreshDomains();
      } catch (e: unknown) {
        setError((e as Error).message);
      }
    },
    [refreshDomains],
  );

  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    setError(null);
    try {
      await api.createProject(newProjectName.trim());
      setNewProjectName('');
      const { projects: list } = await api.listProjects();
      setProjects(list);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }, [newProjectName]);

  return (
    <div className="domain-picker">
      <header className="domain-picker__header">
        <strong className="brand">LocalDrawDB</strong>
        {view === 'projects' && (
          <button onClick={() => void backToDomains()} className="domain-picker__back">
            ← Domínios
          </button>
        )}
      </header>

      {error && <div className="domain-picker__error">{error}</div>}

      {view === 'domains' && (
        <section className="domain-picker__list">
          <h2>Escolha um domínio</h2>
          {sortDomainsByName(domains).map((d) => (
            <div key={d.id} className="domain-picker__row">
              <button type="button" className="domain-picker__item" onClick={() => void openDomain(d)}>
                <span
                  className={`domain-picker__badge domain-picker__badge--${d.hasGit ? 'git' : 'local'}`}
                >
                  {domainBadge(d)}
                </span>
                <span className="domain-picker__name">{d.name}</span>
              </button>
              <button
                type="button"
                className="domain-picker__remove"
                title="Remover deste computador"
                aria-label={`Remover ${d.name}`}
                onClick={() => void handleRemoveDomain(d)}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2.2 2.2l7.6 7.6M9.8 2.2l-7.6 7.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}

          {newDomainMode === null ? (
            <div className="domain-picker__new-actions">
              <button onClick={() => setNewDomainMode('local')}>+ Novo domínio local</button>
              <button onClick={() => setNewDomainMode('clone')}>+ Clonar repositório</button>
            </div>
          ) : (
            <div className="domain-picker__new-form">
              <input
                placeholder="Nome do domínio"
                value={newDomainName}
                onChange={(e) => setNewDomainName(e.target.value)}
              />
              {newDomainMode === 'clone' && (
                <input
                  placeholder="URL do repositório (https ou ssh)"
                  value={newDomainUrl}
                  onChange={(e) => setNewDomainUrl(e.target.value)}
                />
              )}
              <button onClick={() => void handleCreateDomain()}>Criar</button>
              <button onClick={() => setNewDomainMode(null)}>Cancelar</button>
            </div>
          )}
        </section>
      )}

      {view === 'projects' && selectedDomain && (
        <section className="domain-picker__list">
          <h2>
            <span
              className={`domain-picker__badge domain-picker__badge--${selectedDomain.hasGit ? 'git' : 'local'}`}
            >
              {domainBadge(selectedDomain)}
            </span>{' '}
            {selectedDomain.name}
          </h2>
          {!selectedDomain.hasGit &&
            (attachOpen ? (
              <div className="domain-picker__new-form">
                <input
                  placeholder="URL do remote (opcional — https ou ssh)"
                  value={attachUrl}
                  onChange={(e) => setAttachUrl(e.target.value)}
                />
                <button onClick={() => void handleAttachGit()}>Confirmar</button>
                <button onClick={() => setAttachOpen(false)}>Cancelar</button>
              </div>
            ) : (
              <div className="domain-picker__new-actions">
                <button onClick={() => setAttachOpen(true)} title="Versionar este domínio com git">
                  Anexar repositório
                </button>
              </div>
            ))}
          {projects.map((p) => (
            <button
              key={p.id}
              className="domain-picker__item"
              onClick={() => void openProject(p.id)}
            >
              <span className="domain-picker__name">{p.name}</span>
            </button>
          ))}
          <div className="domain-picker__new-form">
            <input
              placeholder="Nome do novo projeto"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <button onClick={() => void handleCreateProject()}>+ Novo projeto</button>
          </div>
        </section>
      )}
    </div>
  );
}
