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
            <button key={d.id} className="domain-picker__item" onClick={() => void openDomain(d)}>
              <span
                className={`domain-picker__badge domain-picker__badge--${d.hasGit ? 'git' : 'local'}`}
              >
                {domainBadge(d)}
              </span>
              <span className="domain-picker__name">{d.name}</span>
            </button>
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
