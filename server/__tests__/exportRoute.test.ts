import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerRoutes } from '../routes.ts';
import { DATA_DIR } from '../paths.ts';

// Estes testes sempre operaram sobre o data/ real do clone, via o fallback
// implícito de getDataDir(). Desde que files.ts passou a resolver pelo
// domínio ativo (exigindo domínio ou override explícito), a intenção
// precisa ser declarada.
beforeAll(() => {
  process.env.LOCALDRAWDB_DATA_DIR = DATA_DIR;
});
afterAll(() => {
  delete process.env.LOCALDRAWDB_DATA_DIR;
});

const MIN_DBML = `Table loja.cliente {
  id bigint [pk]
  nome string
}
`;

describe('POST /api/export', () => {
  async function appWithRoutes() {
    const app = Fastify();
    await registerRoutes(app);
    return app;
  }

  it('exporta localdrawdb spark', async () => {
    const app = await appWithRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/export',
      payload: { dbml: MIN_DBML, format: 'localdrawdb', dialect: 'spark' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { files: string[] };
    expect(body.files.some((f) => f.includes('localdrawdb/model_spark.sql'))).toBe(true);
    await app.close();
  });

  it('exporta oracle-ddl', async () => {
    const app = await appWithRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/export',
      payload: { dbml: MIN_DBML, format: 'oracle-ddl' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { files: string[] };
    expect(body.files.some((f) => f.includes('oracle/'))).toBe(true);
    await app.close();
  });

  it('alias /api/export/ddl delega para spark-ddl', async () => {
    const app = await appWithRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/ddl',
      payload: { dbml: MIN_DBML },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { files: string[] };
    expect(body.files.some((f) => f.includes('spark/'))).toBe(true);
    await app.close();
  });

  it('alias /api/export/input delega para localdrawdb', async () => {
    const app = await appWithRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/api/export/input',
      payload: { dbml: MIN_DBML, dialect: 'spark' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { files: string[] };
    expect(body.files.some((f) => f.includes('localdrawdb/'))).toBe(true);
    await app.close();
  });
});
