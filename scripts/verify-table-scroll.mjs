// v15-02: tabela larga (>48 col) tem scroll interno; ao selecionar, a barra fica visível
// e estável (scrollbar-gutter); rola até o fim; o handle de origem permanece dentro do
// container (não coberto pela barra).
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

// Injeta uma tabela com 60 colunas para forçar o scroll interno (threshold 48).
const cols = Array.from({ length: 60 }, (_, i) => `  c${i} int`).join('\n');
await page.locator('.cm-content').click();
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
await page.keyboard.press('Backspace');
await page.keyboard.insertText(`Table wide.big {\n${cols}\n}\n`);
await page.waitForTimeout(1200);

// Traz a tabela para a viewport (React Flow culla nós fora de tela).
await page.locator('.react-flow__controls-fitview').click({ force: true });
await page.waitForSelector('.table-node', { timeout: 15000 });
await page.waitForTimeout(300);

const scroll = page.locator('.table-node__cols--scroll').first();
const hasScroll = await scroll.count();
console.log('container de scroll presente?', hasScroll);

// Seleciona a tabela.
await page.locator('.table-node').first().click({ force: true });
await page.waitForTimeout(400);

const metrics = await scroll.evaluate((el) => ({
  scrollable: el.scrollHeight > el.clientHeight,
  gutter: getComputedStyle(el).scrollbarGutter,
}));
console.log('rolável?', metrics.scrollable, '| scrollbar-gutter:', metrics.gutter);

const scrolled = await scroll.evaluate((el) => {
  el.scrollTop = el.scrollHeight;
  return el.scrollTop > 0;
});
console.log('rolou até o fim?', scrolled);

await page.waitForTimeout(200);
const handleClear = await page.evaluate(() => {
  const cont = document.querySelector('.table-node__cols--scroll');
  const handles = cont?.querySelectorAll('.col-handle');
  if (!cont || !handles?.length) return false;
  const contRect = cont.getBoundingClientRect();
  return Array.from(handles).some((h) => {
    const r = h.getBoundingClientRect();
    return r.width > 0 && r.right <= contRect.right + 1;
  });
});
console.log('handle de origem dentro do container?', handleClear);

const ok =
  hasScroll > 0 &&
  metrics.scrollable &&
  metrics.gutter === 'stable' &&
  scrolled &&
  handleClear &&
  errors.length === 0;
console.log('erros:', errors.length ? errors : 'nenhum');
console.log(ok ? 'OK: scroll interno estável na seleção' : 'FALHA');
await browser.close();
process.exit(ok ? 0 : 1);
