// Rotas de domínio (projetos versionados por git) + contexto ativo do processo.
// Um "domínio" é uma pasta data/domains/<slug>/ que, por dentro, tem o mesmo
// layout que files.ts sempre entendeu (projects.json + projects/).
import type { FastifyInstance } from 'fastify';
import {
  listDomains,
  createLocalDomain,
  cloneDomain,
  attachGitToDomain,
  getDomain,
  activateDomain,
  deleteDomain,
} from '../domains.ts';
import { getStatus, switchBranch, pull, commit, push, remoteUrl, credentialApprove } from '../git.ts';
import { buildPrUrl } from '../prUrl.ts';
import { getActiveDomainSlug, setActiveDomainSlug } from '../domainContext.ts';

type CreateDomainBody = { name?: string };
type CloneDomainBody = { url?: string; name?: string };
type AttachGitBody = { remoteUrl?: string };
type SwitchBranchBody = { branch?: string; create?: boolean };
type CommitBody = { message?: string };
type CredentialBody = { host?: string; username?: string; token?: string };

/** Mensagem de erro legível para o usuário (stderr do git tem prioridade). */
function errorMessage(e: any, fallback: string): string {
  return e?.stderr || e?.message || fallback;
}

/** Erros de "não encontrado" vêm de getDomain/attachGitToDomain com esse texto. */
function isNotFound(e: any): boolean {
  return typeof e?.message === 'string' && e.message.includes('não encontrado');
}

export function registerDomainRoutes(app: FastifyInstance): void {
  app.get('/api/domains', async () => {
    const domains = await listDomains();
    return { domains, activeDomainSlug: getActiveDomainSlug() };
  });

  app.post<{ Body: CreateDomainBody }>('/api/domains', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'Nome é obrigatório.' });
    const domain = await createLocalDomain(name);
    reply.code(201);
    return domain;
  });

  app.post<{ Body: CloneDomainBody }>('/api/domains/clone', async (req, reply) => {
    const url = req.body?.url?.trim();
    if (!url) return reply.code(400).send({ error: 'URL é obrigatória.' });
    try {
      const domain = await cloneDomain(url, req.body?.name?.trim());
      reply.code(201);
      return domain;
    } catch (e: any) {
      return reply.code(422).send({ error: errorMessage(e, 'Falha ao clonar repositório.') });
    }
  });

  app.post<{ Params: { id: string }; Body: AttachGitBody }>(
    '/api/domains/:id/attach-git',
    async (req, reply) => {
      try {
        return await attachGitToDomain(req.params.id, req.body?.remoteUrl?.trim() || undefined);
      } catch (e: any) {
        // 404 só quando o domínio de fato não existe. Falha de `git init` /
        // `git remote add` (ex.: origin já configurado) é 422 — o domínio
        // existe, a operação de git é que não deu.
        if (isNotFound(e)) return reply.code(404).send({ error: e.message });
        return reply.code(422).send({ error: errorMessage(e, 'Falha ao inicializar o repositório.') });
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/domains/:id/activate', async (req, reply) => {
    try {
      const domain = await activateDomain(req.params.id);
      return { ok: true, domain };
    } catch (e: any) {
      return reply.code(404).send({ error: errorMessage(e, 'Domínio não encontrado.') });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/domains/:id', async (req, reply) => {
    try {
      await deleteDomain(req.params.id);
      return { ok: true };
    } catch (e: any) {
      if (isNotFound(e)) return reply.code(404).send({ error: e.message });
      return reply.code(422).send({ error: errorMessage(e, 'Falha ao remover o domínio.') });
    }
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/git-status', async (req, reply) => {
    const domain = await getDomain(req.params.id).catch(() => null);
    if (!domain) return reply.code(404).send({ error: 'Domínio não encontrado.' });
    if (!domain.hasGit) return { hasGit: false as const };
    const status = await getStatus(domain.dir);
    return { hasGit: true as const, ...status };
  });

  app.post<{ Params: { id: string }; Body: SwitchBranchBody }>(
    '/api/domains/:id/git/switch-branch',
    async (req, reply) => {
      const branch = req.body?.branch?.trim();
      if (!branch) return reply.code(400).send({ error: 'Branch é obrigatória.' });
      const domain = await getDomain(req.params.id).catch(() => null);
      if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
      try {
        await switchBranch(domain.dir, branch, req.body?.create ?? false);
        return { ok: true, branch };
      } catch (e: any) {
        return reply.code(409).send({ error: errorMessage(e, 'Falha ao trocar de branch.') });
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/domains/:id/git/pull', async (req, reply) => {
    const domain = await getDomain(req.params.id).catch(() => null);
    if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
    try {
      await pull(domain.dir);
      return { ok: true };
    } catch (e: any) {
      return reply.code(409).send({ error: errorMessage(e, 'Falha ao atualizar.') });
    }
  });

  app.post<{ Params: { id: string }; Body: CommitBody }>('/api/domains/:id/git/commit', async (req, reply) => {
    const message = req.body?.message?.trim();
    if (!message) return reply.code(400).send({ error: 'Mensagem de commit é obrigatória.' });
    const domain = await getDomain(req.params.id).catch(() => null);
    if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
    try {
      const result = await commit(domain.dir, message);
      return { ok: true, ...result };
    } catch (e: any) {
      return reply.code(409).send({ error: errorMessage(e, 'Falha ao commitar.') });
    }
  });

  app.post<{ Params: { id: string } }>('/api/domains/:id/git/push', async (req, reply) => {
    const domain = await getDomain(req.params.id).catch(() => null);
    if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
    try {
      const result = await push(domain.dir);
      return { ok: true, ...result };
    } catch (e: any) {
      return reply.code(409).send({ error: errorMessage(e, 'Falha ao enviar.') });
    }
  });

  app.get<{ Params: { id: string } }>('/api/domains/:id/git/pr-url', async (req, reply) => {
    const domain = await getDomain(req.params.id).catch(() => null);
    if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
    const remote = await remoteUrl(domain.dir);
    const { branch } = await getStatus(domain.dir);
    if (!remote) return { url: null, host: null, remoteUrl: null, branch };
    const built = buildPrUrl(remote, branch);
    return { url: built?.url ?? null, host: built?.host ?? null, remoteUrl: remote, branch };
  });

  app.post<{ Params: { id: string }; Body: CredentialBody }>(
    '/api/domains/:id/git/credential',
    async (req, reply) => {
      const { host, username, token } = req.body ?? {};
      if (!host || !username || !token) {
        return reply.code(400).send({ error: 'host, username e token são obrigatórios.' });
      }
      const domain = await getDomain(req.params.id).catch(() => null);
      if (!domain?.hasGit) return reply.code(404).send({ error: 'Domínio sem git.' });
      try {
        await credentialApprove(domain.dir, { protocol: 'https', host, username, password: token });
        return { ok: true };
      } catch (e: any) {
        return reply.code(422).send({ error: errorMessage(e, 'Falha ao salvar credencial.') });
      }
    },
  );

  app.get('/api/context', async () => {
    const slug = getActiveDomainSlug();
    if (!slug) return { domain: null };
    const domains = await listDomains();
    const domain = domains.find((d) => d.slug === slug) ?? null;
    return { domain };
  });

  app.post('/api/context/clear', async () => {
    setActiveDomainSlug(null);
    return { ok: true };
  });
}
