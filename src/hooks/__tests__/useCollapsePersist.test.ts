import { describe, expect, it } from 'vitest';
import {
  parseCollapsed,
  readCollapsed,
  readCollapsedWithLegacy,
  writeCollapsed,
} from '../useCollapsePersist';

function createStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('parseCollapsed', () => {
  it('respeita valor salvo e fallback para default', () => {
    expect(parseCollapsed('1', false)).toBe(true);
    expect(parseCollapsed('0', true)).toBe(false);
    expect(parseCollapsed(null, true)).toBe(true);
    expect(parseCollapsed(null, false)).toBe(false);
    expect(parseCollapsed('lixo', true)).toBe(true);
  });
});

describe('readCollapsed', () => {
  it('lê estado persistido pelo parser', () => {
    const storage = createStorage({ 'ldb.panel.records': '0' });
    expect(readCollapsed('ldb.panel.records', true, storage)).toBe(false);
  });

  it('retorna default quando storage não tem chave', () => {
    const storage = createStorage();
    expect(readCollapsed('ldb.panel.records', true, storage)).toBe(true);
  });
});

describe('writeCollapsed', () => {
  it('grava 1/0 conforme estado', () => {
    const storage = createStorage();
    writeCollapsed('ldb.panel.pages', true, storage);
    expect(readCollapsed('ldb.panel.pages', false, storage)).toBe(true);
    writeCollapsed('ldb.panel.pages', false, storage);
    expect(readCollapsed('ldb.panel.pages', true, storage)).toBe(false);
  });
});

describe('readCollapsedWithLegacy', () => {
  it('prioriza chave nova quando presente', () => {
    const storage = createStorage({
      'ldb.panel.layers': '0',
      'localdrawdb.layersPanelCollapsed': '1',
    });
    expect(
      readCollapsedWithLegacy(
        'ldb.panel.layers',
        'localdrawdb.layersPanelCollapsed',
        true,
        storage,
      ),
    ).toBe(false);
  });

  it('usa chave legada quando a nova está ausente', () => {
    const storage = createStorage({ 'localdrawdb.pagesPanelCollapsed': '1' });
    expect(
      readCollapsedWithLegacy(
        'ldb.panel.pages',
        'localdrawdb.pagesPanelCollapsed',
        false,
        storage,
      ),
    ).toBe(true);
  });

  it('retorna default quando ambas estão ausentes', () => {
    const storage = createStorage();
    expect(
      readCollapsedWithLegacy(
        'ldb.panel.layers',
        'localdrawdb.layersPanelCollapsed',
        false,
        storage,
      ),
    ).toBe(false);
  });
});
