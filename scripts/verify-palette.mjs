// v18-06: valida command palette (Cmd/Ctrl+K), foco de tabela e ação de export.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL ?? 'http://localhost:5192/';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.app', { timeout: 15000 });

// Cmd/Ctrl+K abre o palette e Enter em "dim_cust" foca/seleciona a tabela.
await page.keyboard.press(`${MOD}+k`);
await page.waitForSelector('.command-palette__input', { timeout: 5000 });
await page.fill('.command-palette__input', 'dim_cust');
await page.keyboard.press('Enter');
await page.waitForFunction(
  () => Array.from(document.querySelectorAll('.records-table__title')).some((el) => el.textContent?.includes('gold.dim_customer')),
  { timeout: 7000 },
);
const focused = await page.evaluate(
  () => Array.from(document.querySelectorAll('.records-table__title')).some((el) => el.textContent?.includes('gold.dim_customer')),
);

// Executa "Exportar Oracle DDL" via palette e valida arquivo(s) gerado(s).
await page.keyboard.press(`${MOD}+k`);
await page.waitForSelector('.command-palette__input', { timeout: 5000 });
await page.fill('.command-palette__input', 'Exportar Oracle DDL');
await page.keyboard.press('Enter');
await page.waitForFunction(
  () => !!document.querySelector('.status')?.textContent?.includes('Gerado:'),
  { timeout: 10000 },
);
const status = await page.locator('.status').innerText();
const filesPart = status.split('Gerado:')[1]?.trim() ?? '';
const files = filesPart
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const missing = files.filter((relPath) => !existsSync(path.resolve(ROOT, relPath)));

console.log('tabela focada/selecionada:', focused);
console.log('status export:', status);
console.log('arquivos exportados:', files);
console.log('arquivos ausentes:', missing);
console.log('erros:', errors.length ? errors : 'nenhum');

await browser.close();
const ok = focused && files.length > 0 && missing.length === 0 && errors.length === 0;
console.log(ok ? '\n✅ PALETTE OK' : '\n❌ PALETTE FALHOU');
process.exit(ok ? 0 : 1);
