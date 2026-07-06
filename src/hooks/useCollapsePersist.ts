import { useCallback, useState } from 'react';

type CollapseStorage = Pick<Storage, 'getItem' | 'setItem'>;

const LEGACY_KEYS: Record<string, string | undefined> = {
  'ldb.panel.layers': 'localdrawdb.layersPanelCollapsed',
  'ldb.panel.pages': 'localdrawdb.pagesPanelCollapsed',
};

function getStorage(storage?: CollapseStorage): CollapseStorage {
  if (storage) return storage;
  return localStorage;
}

export function parseCollapsed(raw: string | null, defaultCollapsed: boolean): boolean {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return defaultCollapsed;
}

export function readCollapsed(
  key: string,
  defaultCollapsed: boolean,
  storage?: CollapseStorage,
): boolean {
  try {
    return parseCollapsed(getStorage(storage).getItem(key), defaultCollapsed);
  } catch {
    return defaultCollapsed;
  }
}

export function readCollapsedWithLegacy(
  key: string,
  legacyKey: string,
  defaultCollapsed: boolean,
  storage?: CollapseStorage,
): boolean {
  try {
    const storageApi = getStorage(storage);
    const currentRaw = storageApi.getItem(key);
    if (currentRaw !== null) return parseCollapsed(currentRaw, defaultCollapsed);
    return parseCollapsed(storageApi.getItem(legacyKey), defaultCollapsed);
  } catch {
    return defaultCollapsed;
  }
}

export function writeCollapsed(
  key: string,
  collapsed: boolean,
  storage?: CollapseStorage,
): void {
  try {
    getStorage(storage).setItem(key, collapsed ? '1' : '0');
  } catch {
    /* noop */
  }
}

export function useCollapsePersist(
  key: string,
  defaultCollapsed: boolean,
): readonly [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    const legacyKey = LEGACY_KEYS[key];
    return legacyKey
      ? readCollapsedWithLegacy(key, legacyKey, defaultCollapsed)
      : readCollapsed(key, defaultCollapsed);
  });

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      writeCollapsed(key, next);
      return next;
    });
  }, [key]);

  return [collapsed, toggle] as const;
}
