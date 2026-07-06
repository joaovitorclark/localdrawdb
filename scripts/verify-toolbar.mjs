// v18-03: toolbar — indicador único, PNG no menu Exportar, rótulo Organizar.
import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL ?? 'http://localhost:5192/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('header.toolbar', { timeout: 15000 });

// 1) indicador único: nenhum .savestate solto na toolbar, StatusLog presente
if (await page.locator('header.toolbar > .savestate').count()) {
  throw new Error('savestate duplicado');
}
if (!(await page.locator('.status-log__btn').count())) {
  throw new Error('StatusLog ausente');
}

// 2) botão Export PNG não existe; item no menu sim
if (await page.getByRole('button', { name: 'Export PNG' }).count()) {
  throw new Error('botão PNG ainda existe');
}
await page.locator('.toolbar__export-trigger').click();
await page.getByRole('button', { name: 'PNG do canvas' }).waitFor({ timeout: 3000 });

// 3) rótulo Organizar
await page.locator('header.toolbar').getByRole('button', { name: 'Organizar', exact: true }).waitFor({ timeout: 3000 });

console.log('erros de console:', errors.length ? errors : 'nenhum');
await browser.close();

if (errors.length) {
  console.error('\n❌ TOOLBAR FALHOU (console)');
  process.exit(1);
}
console.log('\n✅ TOOLBAR OK');
process.exit(0);
