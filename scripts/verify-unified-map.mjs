import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0,140)));
await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.waitForSelector('.table-node', { timeout: 15000 });
await page.waitForTimeout(700);

const t = page.locator('.react-flow__node-table').filter({ hasText: 'dim_product' }).first();
await t.locator('.col-row', { hasText: 'category' }).first().click({ force: true });
await page.waitForTimeout(300);
console.log('ColumnPanel visível?', await page.locator('.column-panel').count());
console.log('secção Mapeamentos (L2) unificada?', await page.locator('.column-panel__mappings').count());
console.log('painel avulso antigo sumiu?', (await page.locator('.field-lineage-panel-wrap').count()) === 0);

// adiciona um mapeamento: escolhe tabela origem + coluna origem, + mapeamento
const selects = page.locator('.column-panel__mappings select');
const opts = await selects.nth(0).locator('option').allInnerTexts();
const srcTable = opts.find(o => o && !/escolher/.test(o));
await selects.nth(0).selectOption({ label: srcTable });
await page.waitForTimeout(200);
const colOpts = await selects.nth(1).locator('option').allInnerTexts();
const srcCol = colOpts.find(o => o && o !== '—');
await selects.nth(1).selectOption({ label: srcCol });
await page.getByRole('button', { name: '+ mapeamento' }).click({ force: true });
await page.waitForTimeout(400);
console.log(`origem escolhida: ${srcTable}.${srcCol}`);
console.log('linhas de mapeamento após add:', await page.locator('.column-panel__mappings .field-lineage-panel__row-btn').count());

await page.getByRole('button', { name: 'Salvar' }).click({ force: true });
await page.waitForTimeout(1200);
const file = readFileSync('data/projects/default/project.dbml', 'utf8');
console.log('LineageFields no arquivo?', /LineageFields\s*\{/.test(file), '| tem category?', /\.category\b/.test(file.split('LineageFields')[1] ?? ''));
console.log('erros:', errs.length ? errs : 'nenhum');
await b.close();
