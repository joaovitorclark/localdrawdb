/**
 * Testes das rotas do controlboard (/api/board/*): listar domínios+projetos
 * de TODOS os domínios (não só "local"), criar/clonar/apagar domínio, criar
 * projeto, e ligar/desligar instâncias via InstanceManager fake (sem
 * spawnar processo real).
 *
 * Mesma convenção de domainRoutes.test.ts: LOCALDRAWDB_DATA_DIR isolado por
 * teste + vi.resetModules() antes de cada import dinâmico, porque
 * domainContext.ts guarda o domínio ativo em estado de módulo.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createInstanceManager } from '../controlboardInstances.ts';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-controlboard-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function fakeInstanceManager() {
  return createInstanceManager({
    startInstance: async () => ({ server: new EventEmitter() as any, web: new EventEmitter() as any }),
    stopInstance: () => {},
    findFreePort: async (start: number, _host?: string, exclude = new Set<number>()) => {
      let port = start;
      while (exclude.has(port)) port++;
      return port;
    },
  });
}

async function buildApp(instances = fakeInstanceManager()) {
  const { default: Fastify } = await import('fastify');
  const { registerControlboardRoutes } = await import('../routes/controlboardRoutes.ts');
  const app = Fastify();
  registerControlboardRoutes(app, instances);
  return { app, instances };
}

async function createDomain(app: Awaited<ReturnType<typeof buildApp>>['app'], name: string) {
  const res = await app.inject({ method: 'POST', url: '/api/board/domains', payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; slug: string; name: string; dir: string; hasGit: boolean };
}

describe('GET /api/board/domains', () => {
  it('lista vazio antes de qualquer criação', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/board/domains' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ domains: [] });
  });

  it('lista domínios com seus projetos, sem precisar ativar nenhum antes', async () => {
    const { app } = await buildApp();
    const vendas = await createDomain(app, 'Vendas');
    await createDomain(app, 'RH');

    const res = await app.inject({ method: 'GET', url: '/api/board/domains' });
    await app.close();
    const body = res.json() as { domains: { slug: string; projects: { name: string }[] }[] };
    expect(body.domains.map((d) => d.slug).sort()).toEqual(['rh', 'vendas']);
    const found = body.domains.find((d) => d.slug === vendas.slug)!;
    expect(found.projects).toHaveLength(1); // default criado pelo ensureRegistry
  });
});

describe('POST /api/board/domains', () => {
  it('400 quando o nome está ausente ou vazio', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/board/domains', payload: { name: '  ' } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/board/domains/clone', () => {
  it('400 sem url', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/board/domains/clone', payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it('422 quando o git clone falha', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/board/domains/clone',
      payload: { url: path.join(tmpDir, 'repo-inexistente.git'), name: 'Falho' },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });
});

describe('DELETE /api/board/domains/:id', () => {
  it('remove o domínio e a pasta local', async () => {
    const { app } = await buildApp();
    const fica = await createDomain(app, 'Fica');
    const sai = await createDomain(app, 'Sai');
    const res = await app.inject({ method: 'DELETE', url: `/api/board/domains/${sai.id}` });
    expect(res.statusCode).toBe(200);

    const listed = await app.inject({ method: 'GET', url: '/api/board/domains' });
    await app.close();
    const body = listed.json() as { domains: { slug: string }[] };
    expect(body.domains.map((d) => d.slug)).toEqual([fica.slug]);
    await expect(fs.stat(sai.dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('404 para id inexistente', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/board/domains/nao-existe' });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('para as instâncias do domínio antes de apagar', async () => {
    const { app, instances } = await buildApp();
    const domain = await createDomain(app, 'Comrodando');
    const domainsRes = await app.inject({ method: 'GET', url: '/api/board/domains' });
    const projectId = (
      domainsRes.json() as { domains: { id: string; projects: { id: string }[] }[] }
    ).domains.find((d) => d.id === domain.id)!.projects[0].id;

    const launch = await app.inject({
      method: 'POST',
      url: '/api/board/instances',
      payload: { domainId: domain.id, projectId },
    });
    expect(launch.statusCode).toBe(201);

    const del = await app.inject({ method: 'DELETE', url: `/api/board/domains/${domain.id}` });
    await app.close();
    expect(del.statusCode).toBe(200);
    expect(instances.list()).toHaveLength(0);
  });
});

describe('POST /api/board/projects', () => {
  it('cria projeto dentro do domínio informado', async () => {
    const { app } = await buildApp();
    const domain = await createDomain(app, 'Vendas');
    const res = await app.inject({
      method: 'POST',
      url: '/api/board/projects',
      payload: { domainId: domain.id, name: 'Q1' },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slug: string; domainSlug: string };
    expect(body.slug).toBe('q1');
    expect(body.domainSlug).toBe('vendas');
  });

  it('404 quando o domínio não existe', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/board/projects',
      payload: { domainId: 'nao-existe', name: 'Q1' },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/board/instances', () => {
  it('lança a instância e ela aparece em GET /api/board/instances', async () => {
    const { app } = await buildApp();
    const domain = await createDomain(app, 'Vendas');
    const domainsRes = await app.inject({ method: 'GET', url: '/api/board/domains' });
    const project = (
      domainsRes.json() as { domains: { id: string; projects: { id: string; slug: string }[] }[] }
    ).domains[0].projects[0];

    const res = await app.inject({
      method: 'POST',
      url: '/api/board/instances',
      payload: { domainId: domain.id, projectId: project.id },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; url: string };
    expect(body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const list = await app.inject({ method: 'GET', url: '/api/board/instances' });
    await app.close();
    expect((list.json() as { instances: { id: string }[] }).instances.map((i) => i.id)).toEqual([body.id]);
  });

  it('404 quando domainId ou projectId não existem', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/board/instances',
      payload: { domainId: 'nao-existe', projectId: 'x' },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/board/instances/:id', () => {
  it('para a instância e some da listagem', async () => {
    const { app, instances } = await buildApp();
    const domain = await createDomain(app, 'Vendas');
    const domainsRes = await app.inject({ method: 'GET', url: '/api/board/domains' });
    const project = (
      domainsRes.json() as { domains: { id: string; projects: { id: string }[] }[] }
    ).domains[0].projects[0];
    const launch = await app.inject({
      method: 'POST',
      url: '/api/board/instances',
      payload: { domainId: domain.id, projectId: project.id },
    });
    const { id } = launch.json() as { id: string };

    const res = await app.inject({ method: 'DELETE', url: `/api/board/instances/${id}` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(instances.list()).toHaveLength(0);
  });

  it('404 para id inexistente', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/board/instances/nao-existe' });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
