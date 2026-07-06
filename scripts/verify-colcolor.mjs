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
// seleciona a coluna 'category' (col-row com esse texto)
const col = t.locator('.col-row', { hasText: 'category' }).first();
await col.click({ force: true });
await page.waitForTimeout(300);
console.log('ColumnPanel visível?', await page.locator('.column-panel').count());
console.log('seletor de cor presente?', await page.locator('.column-panel__colors').count());
// clica no dot vermelho (primeiro)
await page.locator('.col-color-dot').first().click({ force: true });
await page.waitForTimeout(400);
const nameColor = await col.locator('.col-name').evaluate(el => getComputedStyle(el).color);
console.log('cor do nome no canvas:', nameColor, '(esperado rgb(220, 38, 38))');
// salva e confere o arquivo
await page.getByRole('button', { name: 'Salvar' }).click({ force: true });
await page.waitForTimeout(1200);
const file = readFileSync('data/projects/default/project.dbml', 'utf8');
const line = file.split('\n').find(l => /dim_product\.category:\s*#/.test(l)) ?? '(não achou)';
console.log('no arquivo:', line.trim());
console.log('erros:', errs.length ? errs : 'nenhum');
await b.close();
