// v18: clique de coluna tolera jitter (Windows), pane click não desseleciona a
// coluna, Esc desseleciona. Requer servidor em :5192.
import { chromium } from 'playwright-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.waitForSelector('.react-flow__node-table', { timeout: 15000 });
await page.waitForTimeout(800);

const fails = [];
const check = (label, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) fails.push(label);
};
const panelOpen = () => page.locator('.column-panel').count();

// Foca uma tabela REAL pela lista do painel Camadas (as tabelas visíveis no load
// podem ser stubs externos, cujas colunas não são selecionáveis).
await page.getByText('gold.dim_customer', { exact: true }).first().click();
await page.waitForTimeout(900);

// 1) Clique com jitter: down → move 3px → up ainda seleciona a coluna
const row = page
  .locator('.react-flow__node-table[data-id="gold.dim_customer"] .col-row')
  .nth(1);
const box = await row.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 3, cy + 1); // jitter típico de mouse no Windows
await page.mouse.up();
await page.waitForTimeout(500);
check('clique com jitter de 3px seleciona a coluna (painel aberto)', (await panelOpen()) > 0);

// 2) Clique no pane NÃO desseleciona a coluna. Acha um ponto que seja realmente
// pane (fora de nós/grupos/painéis) via elementFromPoint.
const panePoint = await page.evaluate(() => {
  for (let x = 700; x < 1400; x += 40) {
    for (let y = 80; y < 900; y += 40) {
      const el = document.elementFromPoint(x, y);
      if (el && el.classList.contains('react-flow__pane')) return { x, y };
    }
  }
  return null;
});
if (!panePoint) throw new Error('não achei ponto de pane vazio');
await page.mouse.click(panePoint.x, panePoint.y);
await page.waitForTimeout(400);
check('clique no pane mantém a coluna selecionada', (await panelOpen()) > 0);

// 3) Esc desseleciona
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape desseleciona a coluna (painel fecha)', (await panelOpen()) === 0);

check('sem erros de console', errors.length === 0);
await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} verificação(ões) falharam`);
  process.exit(1);
}
console.log('\nverify-column-select: tudo ok');
