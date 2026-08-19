/**
 * Testes TDD das rotas de domínio (/api/domains, /api/context) e do guard
 * `requireActiveDomain` nas rotas legadas de projeto.
 *
 * Convenção: LOCALDRAWDB_DATA_DIR aponta para um tmpdir isolado por teste —
 * é o "diretório base" onde domains.json + domains/<slug>/ são criados.
 * Nos testes do guard 409, o env var é removido de propósito: sem domínio
 * ativo E sem override, files.ts lança e a rota legada precisa traduzir
 * isso em 409 (é exatamente a situação de produção antes da escolha de
 * domínio — em produção LOCALDRAWDB_DATA_DIR nunca está setado).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-domainroutes-'));
  process.env.LOCALDRAWDB_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
  delete process.env.LOCALDRAWDB_DOMAIN;
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function buildApp() {
  const { default: Fastify } = await import('fastify');
  const { registerRoutes } = await import('../routes.ts');
  const app = Fastify();
  await registerRoutes(app);
  return app;
}

async function createDomain(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
  const res = await app.inject({ method: 'POST', url: '/api/domains', payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; slug: string; dir: string; hasGit: boolean };
}

describe('GET /api/domains', () => {
  it('lista vazio antes de qualquer migração/criação', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/domains' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ domains: [], activeDomainSlug: null });
  });
});

describe('POST /api/domains', () => {
  it('cria domínio, ativa, e rotas legadas de projeto passam a funcionar', async () => {
    const app = await buildApp();

    const domain = await createDomain(app, 'Vendas');
    expect(domain.slug).toBe('vendas');

    const activate = await app.inject({ method: 'POST', url: `/api/domains/${domain.id}/activate` });
    expect(activate.statusCode).toBe(200);
    expect((activate.json() as { ok: boolean }).ok).toBe(true);

    const projects = await app.inject({ method: 'GET', url: '/api/projects' });
    await app.close();
    expect(projects.statusCode).toBe(200);
    const body = projects.json() as { projects: unknown[] };
    expect(body.projects).toHaveLength(1); // default criado pelo ensureRegistry do domínio
    // e o projeto vive dentro do diretório do domínio, não na raiz do data dir
    const inside = await fs
      .stat(path.join(tmpDir, 'domains', 'vendas', 'projects.json'))
      .then(() => true)
      .catch(() => false);
    expect(inside).toBe(true);
  });

  it('400 quando o nome está ausente ou vazio', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/domains', payload: { name: '  ' } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/domains/:id/activate', () => {
  it('404 para id inexistente', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/domains/nao-existe/activate' });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/domains/clone', () => {
  it('400 sem url', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/domains/clone', payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it('422 quando o git clone falha', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains/clone',
      payload: { url: path.join(tmpDir, 'repo-inexistente.git'), name: 'Falho' },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBeTruthy();
  });
});

describe('POST /api/domains/:id/attach-git', () => {
  it('inicializa git no domínio e passa a reportar hasGit', async () => {
    const app = await buildApp();
    const domain = await createDomain(app, 'ComGit');
    const res = await app.inject({
      method: 'POST',
      url: `/api/domains/${domain.id}/attach-git`,
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect((res.json() as { hasGit: boolean }).hasGit).toBe(true);
  });

  it('404 quando o domínio não existe', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/domains/nao-existe/attach-git', payload: {} });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('422 (não 404) quando o domínio existe mas a operação de git falha', async () => {
    // Segundo attach com remote: `git remote add origin` falha porque origin já
    // existe. O domínio existe — 404 aqui seria enganoso.
    const app = await buildApp();
    const domain = await createDomain(app, 'DoisRemotes');
    const first = await app.inject({
      method: 'POST',
      url: `/api/domains/${domain.id}/attach-git`,
      payload: { remoteUrl: 'https://example.com/a.git' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/domains/${domain.id}/attach-git`,
      payload: { remoteUrl: 'https://example.com/b.git' },
    });
    await app.close();
    expect(second.statusCode).toBe(422);
  });
});

describe('GET /api/domains/:id/git-status', () => {
  it('retorna hasGit: false para domínio sem git', async () => {
    const app = await buildApp();
    const domain = await createDomain(app, 'SemGit');
    const res = await app.inject({ method: 'GET', url: `/api/domains/${domain.id}/git-status` });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hasGit: false });
  });

  it('retorna branch/dirty para domínio com git', async () => {
    const app = await buildApp();
    const domain = await createDomain(app, 'ComStatus');
    await app.inject({ method: 'POST', url: `/api/domains/${domain.id}/attach-git`, payload: {} });
    const res = await app.inject({ method: 'GET', url: `/api/domains/${domain.id}/git-status` });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hasGit: boolean; branch: string; dirty: boolean; branches: string[] };
    expect(body.hasGit).toBe(true);
    expect(typeof body.branch).toBe('string');
    expect(typeof body.dirty).toBe('boolean');
    expect(Array.isArray(body.branches)).toBe(true);
  });

  it('404 para domínio inexistente', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/domains/nao-existe/git-status' });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe('rotas de git em domínio sem git', () => {
  it('switch-branch / pull / push / commit / pr-url / credential retornam 404', async () => {
    const app = await buildApp();
    const domain = await createDomain(app, 'SemGitRotas');
    const base = `/api/domains/${domain.id}/git`;

    const switchBranch = await app.inject({
      method: 'POST',
      url: `${base}/switch-branch`,
      payload: { branch: 'feature/x' },
    });
    const pull = await app.inject({ method: 'POST', url: `${base}/pull` });
    const push = await app.inject({ method: 'POST', url: `${base}/push` });
    const commit = await app.inject({
      method: 'POST',
      url: `${base}/commit`,
      payload: { message: 'wip' },
    });
    const prUrl = await app.inject({ method: 'GET', url: `${base}/pr-url` });
    const credential = await app.inject({
      method: 'POST',
      url: `${base}/credential`,
      payload: { host: 'github.com', username: 'u', token: 't' },
    });
    await app.close();

    expect(switchBranch.statusCode).toBe(404);
    expect(pull.statusCode).toBe(404);
    expect(push.statusCode).toBe(404);
    expect(commit.statusCode).toBe(404);
    expect(prUrl.statusCode).toBe(404);
    expect(credential.statusCode).toBe(404);
  });

  it('valida o body antes de olhar o domínio (400)', async () => {
    const app = await buildApp();
    const domain = await createDomain(app, 'Validacao');
    const base = `/api/domains/${domain.id}/git`;

    const noBranch = await app.inject({ method: 'POST', url: `${base}/switch-branch`, payload: {} });
    const noMessage = await app.inject({ method: 'POST', url: `${base}/commit`, payload: {} });
    const noCred = await app.inject({ method: 'POST', url: `${base}/credential`, payload: { host: 'x' } });
    await app.close();

    expect(noBranch.statusCode).toBe(400);
    expect(noMessage.statusCode).toBe(400);
    expect(noCred.statusCode).toBe(400);
  });
});

describe('rotas de git em domínio com git', () => {
  it('switch-branch cria a branch; pr-url monta a URL a partir do remote', async () => {
    const app = await buildApp();
    const domain = await createDomain(app, 'GitOps');
    await app.inject({
      method: 'POST',
      url: `/api/domains/${domain.id}/attach-git`,
      payload: { remoteUrl: 'https://github.com/acme/repo.git' },
    });

    const switched = await app.inject({
      method: 'POST',
      url: `/api/domains/${domain.id}/git/switch-branch`,
      payload: { branch: 'feature/x', create: true },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json()).toEqual({ ok: true, branch: 'feature/x' });

    const prUrl = await app.inject({ method: 'GET', url: `/api/domains/${domain.id}/git/pr-url` });
    await app.close();
    expect(prUrl.statusCode).toBe(200);
    const body = prUrl.json() as { url: string; host: string; remoteUrl: string; branch: string };
    expect(body.host).toBe('github.com');
    expect(body.branch).toBe('feature/x');
    expect(body.url).toContain('github.com/acme/repo/compare/feature/x');
    expect(body.remoteUrl).toBe('https://github.com/acme/repo.git');
  });

  it('push sem nada pendente retorna 409', async () => {
    const app = await buildApp();
    const domain = await createDomain(app, 'GitPush');
    await app.inject({ method: 'POST', url: `/api/domains/${domain.id}/attach-git`, payload: {} });
    const res = await app.inject({
      method: 'POST',
      url: `/api/domains/${domain.id}/git/push`,
    });
    await app.close();
    expect(res.statusCode).toBe(409);
  });
});

describe('rotas legadas de projeto sem domínio ativo', () => {
  it('GET /api/projects retorna 409 com mensagem clara', async () => {
    delete process.env.LOCALDRAWDB_DATA_DIR;
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toMatch(/domínio ativo/i);
  });

  it('rotas de escrita também são bloqueadas com 409', async () => {
    delete process.env.LOCALDRAWDB_DATA_DIR;
    const app = await buildApp();
    const create = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'X' } });
    const legacyGet = await app.inject({ method: 'GET', url: '/api/project' });
    const legacyPut = await app.inject({ method: 'PUT', url: '/api/project', payload: { dbml: '' } });
    await app.close();
    expect(create.statusCode).toBe(409);
    expect(legacyGet.statusCode).toBe(409);
    expect(legacyPut.statusCode).toBe(409);
  });
});

describe('GET /api/context', () => {
  it('domain null antes de ativar; preenchido depois', async () => {
    const app = await buildApp();
    const before = await app.inject({ method: 'GET', url: '/api/context' });
    expect(before.json()).toEqual({ domain: null });

    const domain = await createDomain(app, 'X');
    await app.inject({ method: 'POST', url: `/api/domains/${domain.id}/activate` });

    const after = await app.inject({ method: 'GET', url: '/api/context' });
    await app.close();
    expect((after.json() as { domain: { id: string } }).domain.id).toBe(domain.id);
  });
});

describe('POST /api/context/clear', () => {
  it('limpa o domínio ativo — rotas legadas voltam a dar 409', async () => {
    const app = await buildApp();
    const domain = await createDomain(app, 'X');
    await app.inject({ method: 'POST', url: `/api/domains/${domain.id}/activate` });

    const cleared = await app.inject({ method: 'POST', url: '/api/context/clear' });
    expect(cleared.statusCode).toBe(200);

    const context = await app.inject({ method: 'GET', url: '/api/context' });
    expect(context.json()).toEqual({ domain: null });

    // Sem o override de teste (situação real de produção), a rota legada 409.
    delete process.env.LOCALDRAWDB_DATA_DIR;
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    await app.close();
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /api/meta', () => {
  it('inclui gitAvailable e activeDomain', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/meta' });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { gitAvailable: boolean; activeDomain: string | null };
    expect(typeof body.gitAvailable).toBe('boolean');
    expect(body.activeDomain).toBeNull();
  });

  it('não quebra sem domínio ativo nem data dir (boot da tela de escolha)', async () => {
    delete process.env.LOCALDRAWDB_DATA_DIR;
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/meta' });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { inputDir: string | null; activeDomain: string | null };
    expect(body.inputDir).toBeNull();
    expect(body.activeDomain).toBeNull();
  });

  it('reflete o domínio ativo depois do activate', async () => {
    const app = await buildApp();
    const domain = await createDomain(app, 'Meta Dom');
    await app.inject({ method: 'POST', url: `/api/domains/${domain.id}/activate` });
    const res = await app.inject({ method: 'GET', url: '/api/meta' });
    await app.close();
    expect((res.json() as { activeDomain: string | null }).activeDomain).toBe('meta-dom');
  });
});
