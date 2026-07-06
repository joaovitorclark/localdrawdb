// v15-06: em resolução pequena, a área revelável (html/body/#root) deve ter a cor do
// canvas (--canvas-bg = rgb(238,242,248)), não o fundo escuro do app (--bg).
import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
// Viewport pequena para forçar o cenário do report.
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
// Ignora ruído de recurso ausente (ex.: favicon 404) — só interessam erros de página/JS.
const benign = (t) => /favicon/i.test(t) || /Failed to load resource.*404/i.test(t);
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !benign(m.text()) && errors.push(m.text()));

await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.waitForSelector('.app', { timeout: 15000 });
await page.waitForTimeout(400);

const bg = await page.evaluate(() => {
  const read = (el) => getComputedStyle(el).backgroundColor;
  return {
    html: read(document.documentElement),
    body: read(document.body),
    root: read(document.getElementById('root')),
  };
});

const EXPECTED = 'rgb(238, 242, 248)';
const ok = bg.body === EXPECTED && bg.html === EXPECTED && bg.root === EXPECTED;
console.log('backgrounds:', JSON.stringify(bg));
console.log('esperado:', EXPECTED);
console.log(ok ? 'OK: sem faixa preta (fundo = canvas-bg)' : 'FALHA: fundo revelável não é canvas-bg');
console.log('erros:', errors.length ? errors : 'nenhum');
await browser.close();
process.exit(ok && errors.length === 0 ? 0 : 1);
