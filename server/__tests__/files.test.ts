import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATA_DIR, ROOT } from '../files.ts';

// Este teste sempre operou sobre o data/ real do clone, via o fallback
// implícito de getDataDir(). Desde que files.ts passou a resolver pelo
// domínio ativo (exigindo domínio ou override explícito), a intenção
// precisa ser declarada.
beforeAll(() => {
  process.env.LOCALDRAWDB_DATA_DIR = DATA_DIR;
});
afterAll(() => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
});

describe('files.ts paths', () => {
  it('resolve data/ relativo ao clone (server/..)', () => {
    expect(DATA_DIR).toBe(path.join(ROOT, 'data'));
  });
});

describe('/api/meta', () => {
  it('expoe root e inputDir do projeto ativo (dentro de data/projects/)', async () => {
    const { default: Fastify } = await import('fastify');
    const { registerRoutes } = await import('../routes.ts');
    const app = Fastify();
    await registerRoutes(app);
    const res = await app.inject({ method: 'GET', url: '/api/meta' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { root: string; inputDir: string };
    // inputDir deve apontar para o input do projeto ativo (dentro de data/projects/)
    expect(body.inputDir).toContain(path.join('data', 'projects'));
    expect(body.inputDir).toContain('input');
    expect(body.root).toBe(ROOT);
    await app.close();
  });
});
