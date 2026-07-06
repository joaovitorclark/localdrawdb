// v18-01 — Verifica o round-trip de cores do export LocalDrawDB (Oracle) via API:
// export com cores/linhagem → arquivo com rodapés @colors/@layercolors → import do
// arquivo num projeto TEMPORÁRIO vazio → DBML devolvido com Colors {} e LayerGroup
// [color:] equivalentes. Requer servidor em BASE_URL (default :5192).
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:5192';

const FIXTURE_DBML = `Table silver.dim_cliente {
  cliente_key bigint [pk]
  nome string [note: 'nome completo']
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
  silver.fato_venda
}

Lineage {
  silver.fato_venda < silver.dim_cliente
}

LineageFields {
  silver.fato_venda.cliente_key < silver.dim_cliente.cliente_key [note: 'lookup']
}

Colors {
  silver.dim_cliente: #b08d57
  @dimensoes: #112233
  silver.fato_venda.venda_key: #ff0000
}
`;

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

const fails = [];
function check(label, ok) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) fails.push(label);
}

// 1) Export LocalDrawDB (Oracle) com cores + linhagem.
const exp = await api('POST', '/api/export/localdrawdb', { dbml: FIXTURE_DBML, dialect: 'oracle' });
const relFile = exp.files?.find((f) => f.endsWith('model_oracle.sql')) ?? exp.files?.[0];
if (!relFile) throw new Error(`export não retornou arquivos: ${JSON.stringify(exp)}`);
const sql = await fs.readFile(path.resolve(relFile), 'utf8');
check('arquivo tem rodapé -- @colors', /^-- @colors$/m.test(sql));
check('cor de tabela no arquivo', sql.includes('--   silver.dim_cliente: #b08d57'));
check('cor de grupo no arquivo', sql.includes('--   @dimensoes: #112233'));
check('cor de coluna no arquivo', sql.includes('--   silver.fato_venda.venda_key: #ff0000'));
check('rodapé -- @layercolors com a camada', /^-- @layercolors$/m.test(sql) && sql.includes('--   prata: #c0c0c0'));
check('linhagem L1 no arquivo (@origen)', /^-- @origen: silver\.dim_cliente$/m.test(sql));
check('linhagem L2 no arquivo (@lineage)', /^-- @lineage silver\.fato_venda$/m.test(sql));

// 2) Import em projeto temporário vazio (simula "outra pessoa"), nos 3 formatos:
//    SQL Oracle (v18-01), DBML nativo (v18-10) e pacote dbt (v18-11).
const meta = await api('POST', '/api/projects', { name: `tmp-verify-colors-${Date.now()}` });
try {
  const inputDir = path.resolve('data/projects', meta.slug, 'input');
  await fs.mkdir(inputDir, { recursive: true });

  const assertRoundtrip = (fmt, dbml) => {
    check(`[${fmt}] cor de tabela`, dbml.includes('silver.dim_cliente: #b08d57'));
    check(`[${fmt}] cor de grupo`, dbml.includes('@dimensoes: #112233'));
    check(`[${fmt}] cor de coluna`, dbml.includes('silver.fato_venda.venda_key: #ff0000'));
    check(`[${fmt}] cor de camada`, dbml.includes('LayerGroup prata [color: #c0c0c0]'));
    check(`[${fmt}] linhagem L1`, /Lineage\s*\{[^}]*silver\.fato_venda < silver\.dim_cliente/.test(dbml));
    check(`[${fmt}] linhagem L2`, /LineageFields\s*\{/.test(dbml));
    check(`[${fmt}] nota de coluna`, dbml.includes("note: 'nome completo'"));
  };
  const importOnly = async (files) => {
    for (const f of await fs.readdir(inputDir, { recursive: true })) {
      const p = path.join(inputDir, String(f));
      if ((await fs.stat(p)).isFile()) await fs.rm(p);
    }
    for (const [rel, content] of files) {
      const p = path.join(inputDir, rel);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content);
    }
    return api('POST', `/api/projects/${meta.id}/import`, { dbml: '' });
  };

  // 2a) SQL Oracle exportado no passo 1
  assertRoundtrip('oracle', (await importOnly([['model_oracle.sql', sql]])).dbml);

  // 2b) DBML nativo (o próprio project.dbml enviado a outra pessoa)
  assertRoundtrip('dbml', (await importOnly([['model.dbml', FIXTURE_DBML]])).dbml);

  // 2c) Pacote dbt com meta.localdrawdb
  const dbtExp = await api('POST', '/api/export/dbt', { dbml: FIXTURE_DBML });
  const dbtFiles = [];
  for (const rel of dbtExp.files ?? []) {
    const inner = rel.slice(rel.indexOf('dbt/') + 4); // caminho dentro do pacote dbt
    dbtFiles.push([inner, await fs.readFile(path.resolve(rel), 'utf8')]);
  }
  if (!dbtFiles.length) throw new Error(`export dbt não retornou arquivos: ${JSON.stringify(dbtExp)}`);
  assertRoundtrip('dbt', (await importOnly(dbtFiles)).dbml);
} finally {
  await api('DELETE', `/api/projects/${meta.id}`);
  console.log('projeto temporário removido');
}

if (fails.length) {
  console.error(`\n${fails.length} verificação(ões) falharam`);
  process.exit(1);
}
console.log('\nverify-colors-roundtrip: tudo ok');
