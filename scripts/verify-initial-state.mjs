// Verificação headless: estado inicial sem seleção e com painéis transitórios fechados.
import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.URL ?? 'http://localhost:5192/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.react-flow__node', { timeout: 15000 });
await page.waitForTimeout(800);

const selectedNodeCount = await page.locator('.react-flow__node.selected').count();
const selectionBarCount = await page.locator('.selection-bar').count();
const openPagesPanelCount = await page.locator('.pages-panel:not(.is-collapsed)').count();
const openRecordsPanelCount = await page.locator('.records-panel.is-open').count();

console.log('nós selecionados:', selectedNodeCount);
console.log('selection bar visível:', selectionBarCount > 0);
console.log('pages panel aberto:', openPagesPanelCount > 0);
console.log('records panel aberto:', openRecordsPanelCount > 0);

await browser.close();

if (selectedNodeCount > 0) throw new Error('nó selecionado no load');
if (selectionBarCount > 0) throw new Error('SelectionBar visível no load');
if (openPagesPanelCount > 0) throw new Error('PagesPanel aberto');
if (openRecordsPanelCount > 0) throw new Error('RecordsPanel aberto');

console.log('\n✅ INITIAL STATE OK');
