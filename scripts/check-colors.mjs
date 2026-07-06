import { chromium } from 'playwright-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 0xff, n & 0xff].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`check-colors: ${msg}`);
    process.exit(1);
  }
};

assert(ratio('#5a6b85', '#ffffff') >= 4.5, 'muted-on-light × branco');
assert(ratio('#9fb0c9', '#13284b') >= 4.5, 'muted × navy');
console.log('contraste WCAG ok');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:5192/', { waitUntil: 'networkidle' });
await page.waitForSelector('.table-node');
await page.locator('.table-node__header').first().locator('.table-node__color').click();
await page.locator('.color-palette button').nth(1).click();
await page.waitForTimeout(1300); // deixa o autosave disparar
await browser.close();
console.log('cor escolhida + autosave aguardado');
