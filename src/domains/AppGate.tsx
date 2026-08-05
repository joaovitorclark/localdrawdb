// Resolve o contexto (domínio ativo) ANTES de montar o App existente. Enquanto
// não há domínio ativo, mostra a tela de escolha; assim que um domínio é
// ativado no servidor, monta o App do zero (key={domain.id}) — o App.tsx
// continua assumindo, como sempre assumiu, que há um projeto pronto assim
// que ele monta.
import { useCallback, useEffect, useState } from 'react';
import App from '../App';
import { DomainPicker } from './DomainPicker';
import * as api from '../api';
import type { DomainMeta } from '../api';

export function AppGate() {
  const [activeDomain, setActiveDomain] = useState<DomainMeta | null | undefined>(undefined);
  // Incrementado quando o git muda os arquivos em disco (pull / troca de branch):
  // entra na `key` do App para forçar remount e recarregar tudo do servidor.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    api
      .getContext()
      .then(({ domain }) => setActiveDomain(domain))
      .catch(() => setActiveDomain(null));
  }, []);

  const handleOpened = useCallback((domain: DomainMeta) => {
    setActiveDomain(domain);
  }, []);

  const handleRepoChanged = useCallback(() => setNonce((n) => n + 1), []);

  const handleBackToDomains = useCallback(() => {
    void api.clearContext().catch(() => {});
    setActiveDomain(null);
  }, []);

  if (activeDomain === undefined) {
    return <div className="app-gate-loading">Carregando…</div>;
  }
  if (activeDomain === null) {
    return <DomainPicker onOpened={handleOpened} />;
  }
  return (
    <App
      key={`${activeDomain.id}:${nonce}`}
      domain={activeDomain}
      onBackToDomains={handleBackToDomains}
      onRepoChanged={handleRepoChanged}
    />
  );
}
