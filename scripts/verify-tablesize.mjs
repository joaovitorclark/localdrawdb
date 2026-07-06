// v15-01: resize diagonal (largura + altura) pelo canto inferior-direito; persiste no
// canvas.json no formato { width, height }; sobrevive ao reload.
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CANVAS = 'data/projects/default/canvas.json';
const TABLE_ID = 'gold.dim_customer';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const benign = (t) => /favicon/i.test(t) || /Failed to load resource.*404/i.test(t);
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !benign(m.text()) && errors.push(m.text()));

await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.waitForSelector('.table-node', { timeout: 15000 });
await page.waitForTimeout(600);

const node = page.locator('.table-node').filter({ hasText: 'dim_customer' }).first();
const b0 = await node.boundingBox();
const shell = node.locator('xpath=..');
const handle = shell.locator('.table-resize-handle--corner').first();
console.log('handle de canto presente?', await handle.count());

const hb = await handle.boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
// Arrasto diagonal: aumenta largura e altura.
await page.mouse.move(hb.x + 160, hb.y + 140, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);

const b1 = await node.boundingBox();
const dw = Math.round(b1.width - b0.width);
const dh = Math.round(b1.height - b0.height);
console.log(`largura: ${Math.round(b0.width)} -> ${Math.round(b1.width)} (Δ${dw})`);
console.log(`altura:  ${Math.round(b0.height)} -> ${Math.round(b1.height)} (Δ${dh})`);

await page.getByRole('button', { name: 'Salvar' }).click({ force: true });
await page.waitForTimeout(1200);

const file = JSON.parse(readFileSync(CANVAS, 'utf8').replace(/^\ufeff/, ''));
const saved = file.sizes?.[TABLE_ID];
console.log('sizes salvos:', JSON.stringify(saved));
const savedOk =
  saved && typeof saved === 'object' && typeof saved.width === 'number' && typeof saved.height === 'number';

// Reload → a dimensão deve persistir (formato { width, height }).
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.table-node', { timeout: 15000 });
await page.waitForTimeout(700);
const node2 = page.locator('.table-node').filter({ hasText: 'dim_customer' }).first();
const b2 = await node2.boundingBox();
console.log(`após reload: ${Math.round(b2.width)}x${Math.round(b2.height)}`);
const persisted = Math.abs(b2.width - b1.width) < 12 && Math.abs(b2.height - b1.height) < 12;

const ok = dw > 40 && dh > 40 && savedOk && persisted && errors.length === 0;
console.log('erros:', errors.length ? errors : 'nenhum');
console.log(ok ? 'OK: resize diagonal + persistência {width,height}' : 'FALHA');
await browser.close();
process.exit(ok ? 0 : 1);
