import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL ?? 'http://localhost:5192/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.react-flow__node', { timeout: 15000 });

const layersBtn = page.locator('.layers-panel__collapse');
const pagesBtn = page.locator('.pages-panel__collapse');
const recordsBtn = page.locator('.records-panel__toggle');

await page.waitForSelector('.layers-panel');
await page.waitForSelector('.pages-panel');

// Garante seleção de tabela para exibir o RecordsPanel.
if ((await recordsBtn.count()) === 0) {
  await page.locator('.table-node').first().click({ force: true });
}
await page.waitForSelector('.records-panel__toggle', { timeout: 10000 });

// Colapsa todos os painéis (forçando toggle para gravar estado).
if ((await page.locator('.layers-panel.is-collapsed').count()) > 0) {
  await layersBtn.click();
}
await layersBtn.click();

if ((await page.locator('.pages-panel.is-collapsed').count()) > 0) {
  await pagesBtn.click();
}
await pagesBtn.click();

if ((await page.locator('.records-panel.is-open').count()) === 0) {
  await recordsBtn.click();
}
await recordsBtn.click();

const { viewportArea, panelsArea } = await page.evaluate(() => {
  const viewport = window.innerWidth * window.innerHeight;
  const selectors = ['.layers-panel', '.pages-panel', '.records-panel'];
  const panels = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  const area = panels.reduce((sum, el) => {
    const r = el.getBoundingClientRect();
    return sum + r.width * r.height;
  }, 0);
  return { viewportArea: viewport, panelsArea: area };
});

const occupiedRatio = panelsArea / viewportArea;
if (occupiedRatio > 0.2) {
  throw new Error(`painéis colapsados ocupam ${(occupiedRatio * 100).toFixed(2)}% (>20%)`);
}

// AC3: filtro de Camadas sobrevive colapsar/expandir.
await layersBtn.click(); // expande
await page.fill('.layers-panel__search', 'dim');
await layersBtn.click(); // colapsa
await layersBtn.click(); // expande
const filterValue = await page.inputValue('.layers-panel__search');
if (filterValue !== 'dim') {
  throw new Error('filtro do LayersPanel foi perdido após colapsar/expandir');
}

// Persiste todos colapsados e recarrega.
if ((await page.locator('.layers-panel.is-collapsed').count()) === 0) await layersBtn.click();
if ((await page.locator('.pages-panel.is-collapsed').count()) === 0) await pagesBtn.click();
if ((await page.locator('.records-panel.is-open').count()) > 0) await recordsBtn.click();

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.layers-panel');
await page.waitForSelector('.pages-panel');

const collapseValues = await page.evaluate(() => ({
  layers: localStorage.getItem('ldb.panel.layers'),
  pages: localStorage.getItem('ldb.panel.pages'),
  records: localStorage.getItem('ldb.panel.records'),
}));

if (collapseValues.layers !== '1' || collapseValues.pages !== '1' || collapseValues.records !== '1') {
  throw new Error(`persistência inválida: ${JSON.stringify(collapseValues)}`);
}

if ((await page.locator('.layers-panel.is-collapsed').count()) === 0) {
  throw new Error('LayersPanel não voltou colapsado após reload');
}
if ((await page.locator('.pages-panel.is-collapsed').count()) === 0) {
  throw new Error('PagesPanel não voltou colapsado após reload');
}

console.log('ocupação dos painéis colapsados:', `${(occupiedRatio * 100).toFixed(2)}%`);
console.log('persistência localStorage:', collapseValues);
console.log('erros:', errors.length ? errors : 'nenhum');

await browser.close();

const ok = errors.length === 0;
console.log(ok ? '\n✅ COLLAPSE OK' : '\n❌ COLLAPSE FALHOU');
process.exit(ok ? 0 : 1);
