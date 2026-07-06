// v18-07: valida overlay de atalhos (?), Escape e digitação no editor.
import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL ?? 'http://localhost:5192/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.react-flow__node', { timeout: 15000 });

await page.keyboard.press('Shift+Slash');
await page.waitForSelector('.shortcuts-overlay', { timeout: 3000 });

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
if (await page.locator('.shortcuts-overlay').count()) {
  throw new Error('overlay não fechou com Escape');
}

await page.click('.cm-editor');
await page.keyboard.press('Shift+Slash');
await page.waitForTimeout(300);
if (await page.locator('.shortcuts-overlay').count()) {
  throw new Error('? abriu com editor focado');
}

console.log('erros:', errors.length ? errors : 'nenhum');
await browser.close();

const ok = errors.length === 0;
console.log(ok ? '\n✅ HELP OK' : '\n❌ HELP FALHOU');
process.exit(ok ? 0 : 1);
