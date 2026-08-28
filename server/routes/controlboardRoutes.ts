// Rotas do controlboard (/api/board/*): listar domínios+projetos (de TODOS
// os domínios, não só "local") e ligar/desligar instâncias dedicadas sob
// demanda. Processo separado de server/routes.ts — nunca roda em produção,
// só via `npm run dev` (modo board, default sem argumentos).
import type { FastifyInstance } from 'fastify';
import { listDomains, createLocalDomain, cloneDomain, deleteDomain, getDomain } from '../domains.ts';
import { listProjects, createProject, ensureRegistry, syncRegistryWithDisk } from '../files.ts';
import { setActiveDomainSlug } from '../domainContext.ts';
import type { InstanceManager } from '../controlboardInstances.ts';

type CreateDomainBody = { name?: string };
type CloneDomainBody = { url?: string; name?: string };
type CreateProjectBody = { domainId?: string; name?: string };
type LaunchBody = { domainId?: string; projectId?: string };

function errorMessage(e: any, fallback: string): string {
  return e?.stderr || e?.message || fallback;
}

function isNotFound(e: any): boolean {
  return typeof e?.message === 'string' && e.message.includes('não encontrado');
}

/**
 * Lista os projetos de um domínio SEM os efeitos colaterais de
 * `activateDomain()` (que também dispara `seedGitIfNeeded` — commit/push de
 * bootstrap via rede). Troca o domínio ativo do processo e lê os projetos.
 *
 * Chama `syncRegistryWithDisk()` (add-only) mas NÃO `ensureRegistry()`: o sync
 * só adota pastas `projects/<slug>/` que já existem — não materializa projeto
 * "default" via `migrateLegacy()`. Assim um domínio clonado que traz projetos
 * no disco (mas cujo `projects.json` foi perdido) aparece no board com os
 * projetos certos.
 */
async function listProjectsForDomain(slug: string) {
  setActiveDomainSlug(slug);
  await syncRegistryWithDisk().catch(() => {});
  return listProjects();
}

/**
 * Serializa handlers que leem/escrevem o domínio ativo do processo (estado
 * global mutável em server/domainContext.ts) — sem isto, duas requisições
 * concorrentes podem intercalar setActiveDomainSlug()/reset e uma delas
 * ler/escrever no domínio errado.
 */
let domainStateQueue: Promise<void> = Promise.resolve();
function withDomainLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = domainStateQueue.then(fn, fn);
  domainStateQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function registerControlboardRoutes(app: FastifyInstance, instances: InstanceManager): void {
  app.get('/api/board/domains', async () => {
    return withDomainLock(async () => {
      const domains = await listDomains();
      const withProjects: unknown[] = [];
      try {
        for (const domain of domains) {
          const projects = await listProjectsForDomain(domain.slug);
          withProjects.push({ ...domain, projects });
        }
      } finally {
        setActiveDomainSlug(null);
      }
      return { domains: withProjects };
    });
  });

  app.post<{ Body: CreateDomainBody }>('/api/board/domains', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'Nome é obrigatório.' });
    const domain = await createLocalDomain(name);
    reply.code(201);
    return domain;
  });

  app.post<{ Body: CloneDomainBody }>('/api/board/domains/clone', async (req, reply) => {
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

  app.delete<{ Params: { id: string } }>('/api/board/domains/:id', async (req, reply) => {
    try {
      const domain = await getDomain(req.params.id);
      await instances.stopByDomainAndWait(domain.slug);
      await withDomainLock(async () => {
        await deleteDomain(req.params.id);
      });
      return { ok: true };
    } catch (e: any) {
      if (isNotFound(e)) return reply.code(404).send({ error: e.message });
      return reply.code(422).send({ error: errorMessage(e, 'Falha ao remover o domínio.') });
    }
  });

  app.post<{ Body: CreateProjectBody }>('/api/board/projects', async (req, reply) => {
    const domainId = req.body?.domainId?.trim();
    const name = req.body?.name?.trim();
    if (!domainId) return reply.code(400).send({ error: 'domainId é obrigatório.' });
    if (!name) return reply.code(400).send({ error: 'Nome é obrigatório.' });
    let domain;
    try {
      domain = await getDomain(domainId);
    } catch (e: any) {
      return reply.code(404).send({ error: e.message });
    }
    return withDomainLock(async () => {
      setActiveDomainSlug(domain.slug);
      try {
        await ensureRegistry();
        const project = await createProject(name);
        return { ...project, domainId: domain.id, domainSlug: domain.slug };
      } finally {
        setActiveDomainSlug(null);
      }
    });
  });

  app.get('/api/board/instances', async () => {
    return { instances: instances.list() };
  });

  app.post<{ Body: LaunchBody }>('/api/board/instances', async (req, reply) => {
    const domainId = req.body?.domainId?.trim();
    const projectId = req.body?.projectId?.trim();
    if (!domainId || !projectId) {
      return reply.code(400).send({ error: 'domainId e projectId são obrigatórios.' });
    }
    let domain;
    try {
      domain = await getDomain(domainId);
    } catch (e: any) {
      return reply.code(404).send({ error: e.message });
    }
    const projects = await withDomainLock(async () => {
      try {
        return await listProjectsForDomain(domain.slug);
      } finally {
        setActiveDomainSlug(null);
      }
    });
    const project = projects.find((p) => p.id === projectId);
    if (!project) return reply.code(404).send({ error: 'Projeto não encontrado.' });
    try {
      const instance = await instances.launch({
        domainSlug: domain.slug,
        domainName: domain.name,
        projectSlug: project.slug,
        projectName: project.name,
      });
      reply.code(201);
      return instance;
    } catch (e: any) {
      return reply.code(500).send({ error: errorMessage(e, 'Falha ao subir a instância.') });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/board/instances/:id', async (req, reply) => {
    const stopped = instances.stop(req.params.id);
    if (!stopped) return reply.code(404).send({ error: 'Instância não encontrada.' });
    return { ok: true };
  });
}
