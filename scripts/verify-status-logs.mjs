// v15-04: gerar N ações → dropdown de logs mostra entradas (recentes no topo) e fecha fora.
import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const benign = (t) => /favicon/i.test(t) || /Failed to load resource.*404/i.test(t);
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !benign(m.text()) && errors.push(m.text()));

// addTable usa prompt(); aceita com um nome único a cada diálogo.
let seq = 0;
page.on('dialog', (d) => d.accept(`hdr.tbl_${++seq}`));

await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app', { timeout: 15000 });
// Espera o load concluir (status "Pronto") para não competir com as ações.
await page.waitForFunction(() => {
  const el = document.querySelector('.status-log__btn');
  return el && !/Carregando/i.test(el.textContent || '');
}, { timeout: 15000 });
await page.waitForTimeout(300);

// Gera algumas ações que empurram status: cria N tabelas.
for (let i = 0; i < 4; i++) {
  await page.getByRole('button', { name: '+ Tabela' }).click({ force: true });
  await page.waitForTimeout(250);
}
await page.waitForTimeout(300);

const btn = page.locator('.status-log__btn');
console.log('botão de status presente?', await btn.count());
await btn.first().click({ force: true });
await page.waitForTimeout(250);

const items = await page.locator('.status-log__item').count();
console.log('entradas no dropdown:', items);

// Recente no topo: primeira entrada deve mencionar a última tabela criada.
const firstMsg = await page.locator('.status-log__item .status-log__msg').first().textContent();
console.log('primeira (mais recente):', firstMsg);

// Fecha ao clicar fora.
await page.locator('.pane--canvas').click({ position: { x: 500, y: 400 }, force: true });
await page.waitForTimeout(200);
const closed = (await page.locator('.status-log__pop').count()) === 0;
console.log('fecha ao clicar fora?', closed);

const ok = items >= 4 && /Tabela criada/i.test(firstMsg ?? '') && closed && errors.length === 0;
console.log('erros:', errors.length ? errors : 'nenhum');
console.log(ok ? 'OK: dropdown de logs' : 'FALHA');
await browser.close();
process.exit(ok ? 0 : 1);
