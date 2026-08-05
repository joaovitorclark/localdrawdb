import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const DBML_FIXTURE = `Table silver.dim_cliente {
  cliente_key bigint [pk]
  nome string
}

Table silver.fato_venda {
  venda_key bigint [pk]
  cliente_key bigint
}

Ref: silver.fato_venda.cliente_key > silver.dim_cliente.cliente_key

TableGroup dimensoes {
  silver.dim_cliente
}

LayerGroup prata [color: #c0c0c0] {
  silver.dim_cliente
}

Lineage {
  silver.fato_venda < silver.dim_cliente
}

LineageFields {
  silver.fato_venda.cliente_key < silver.dim_cliente.cliente_key [note: 'lookup']
}

Records silver.dim_cliente(cliente_key, nome) {
  1, Ana
}

Colors {
  silver.dim_cliente: #b08d57
  @dimensoes: #112233
  silver.fato_venda.venda_key: #ff0000
}
`;

describe('runImport — arquivos .dbml no input', () => {
  it('importa .dbml com cores, camadas com cor, linhagem L1/L2 e records', async () => {
    const { runImport } = await import('../routes.ts');
    const out = await runImport([{ file: 'model.dbml', content: DBML_FIXTURE }], '');
    expect(out.imported.some((i) => i.includes('model.dbml'))).toBe(true);
    expect(out.dbml).toContain('silver.dim_cliente: #b08d57');
    expect(out.dbml).toContain('@dimensoes: #112233');
    expect(out.dbml).toContain('silver.fato_venda.venda_key: #ff0000');
    expect(out.dbml).toContain('LayerGroup prata [color: #c0c0c0] {');
    expect(out.dbml).toMatch(/Lineage\s*\{[^}]*silver\.fato_venda < silver\.dim_cliente/);
    expect(out.dbml).toMatch(/LineageFields\s*\{/);
    expect(out.dbml).toMatch(/Records silver\.dim_cliente/);
    expect(out.lineageFieldCount).toBe(1);
  });

  it('.dbml inválido gera warning sem abortar os demais arquivos', async () => {
    const { runImport } = await import('../routes.ts');
    const out = await runImport(
      [
        { file: 'broken.dbml', content: 'Table broken { invalid' },
        { file: 'ok.sql', content: 'CREATE TABLE t (\n  id NUMBER(10)\n);' },
      ],
      '',
    );
    expect(out.warnings?.some((w) => w.includes('broken.dbml'))).toBe(true);
    expect(out.dbml).toMatch(/Table t\b/);
  });

  it('merge: tabela homônima do .dbml vence e cores mesclam por chave', async () => {
    const { runImport } = await import('../routes.ts');
    const base = 'Table silver.dim_cliente {\n  cliente_key bigint [pk]\n}\n\nColors {\n  silver.dim_cliente: #000000\n  outra.tabela: #ffffff\n}\n';
    const out = await runImport([{ file: 'model.dbml', content: DBML_FIXTURE }], base);
    expect(out.dbml).toContain('silver.dim_cliente: #b08d57');
    expect(out.dbml).toContain('outra.tabela: #ffffff');
    expect(out.dbml).toContain('nome string');
  });

  it('IMPORT_EXTS aceita .dbml', async () => {
    const { IMPORT_EXTS } = await import('../files.ts');
    expect(IMPORT_EXTS).toContain('.dbml');
  });
});

describe('POST /api/import', () => {
  it('DBML inválido não bloqueia merge (retorna warning)', async () => {
    const { default: Fastify } = await import('fastify');
    const { registerRoutes } = await import('../routes.ts');
    const app = Fastify();
    await registerRoutes(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: { dbml: 'Table broken { invalid syntax here' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { warnings?: string[]; dbml?: string };
    expect(body.warnings?.some((w) => w.includes('DBML do projeto ignorado'))).toBe(true);
    expect(typeof body.dbml).toBe('string');
    await app.close();
  });
});
