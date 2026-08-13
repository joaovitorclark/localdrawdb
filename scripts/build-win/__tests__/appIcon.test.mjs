import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ICON_PATH = path.join(ROOT, 'public', 'favicon.ico');

describe('ícone da aplicação', () => {
  it('public/favicon.ico é um ICO válido com múltiplas resoluções', async () => {
    const buf = await fs.readFile(ICON_PATH);
    // Cabeçalho ICONDIR: reserved=0, type=1 (ícone), count=N.
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(1);
    const count = buf.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(4);

    // Cada ICONDIRENTRY tem 16 bytes; offset+tamanho precisam caber no arquivo,
    // senão o Windows mostra o ícone genérico em vez de falhar visivelmente.
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16;
      const bytes = buf.readUInt32LE(entry + 8);
      const offset = buf.readUInt32LE(entry + 12);
      expect(bytes).toBeGreaterThan(0);
      expect(offset + bytes).toBeLessThanOrEqual(buf.length);
    }
  });

  it('index.html referencia o favicon', async () => {
    const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('/favicon.ico');
  });
});
