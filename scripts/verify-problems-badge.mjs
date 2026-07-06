// v15-03: badge de problemas no topo abre popover ao clicar; item navega.
// Injeta um DBML com erro/aviso via editor para garantir que há issues.
import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
const benign = (t) => /favicon/i.test(t) || /Failed to load resource.*404/i.test(t);
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !benign(m.text()) && errors.push(m.text()));

await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app', { timeout: 15000 });
await page.waitForTimeout(500);

// Digita um DBML com Ref para tabela inexistente (gera issue de validação).
const cm = page.locator('.cm-content');
await cm.click();
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
await page.keyboard.press('Backspace');
await page.keyboard.insertText(
  'Table a.x {\n  id int [pk]\n}\nRef: a.x.id > a.missing.id\n',
);
await page.waitForTimeout(900);

const badge = page.locator('.problems-badge');
const hasBadge = await badge.count();
console.log('badge presente?', hasBadge);

let popCount = 0;
let items = 0;
if (hasBadge) {
  await badge.first().click({ force: true });
  await page.waitForTimeout(300);
  popCount = await page.locator('.problems-pop').count();
  items = await page.locator('.problems-pop__item').count();
}
console.log('popover aberto?', popCount, '| itens:', items);

// Clicar fora fecha
await page.locator('.pane--canvas').click({ position: { x: 400, y: 400 }, force: true });
await page.waitForTimeout(200);
const closed = (await page.locator('.problems-pop').count()) === 0;
console.log('fecha ao clicar fora?', closed);

const ok = hasBadge > 0 && popCount === 1 && items > 0 && closed && errors.length === 0;
console.log('erros:', errors.length ? errors : 'nenhum');
console.log(ok ? 'OK: badge + popover + navegação' : 'FALHA');
await browser.close();
process.exit(ok ? 0 : 1);
