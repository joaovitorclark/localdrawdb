import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_VERSION, nodeDownloadUrl, ensureNodePortable } from '../fetchNode.mjs';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-fetchnode-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('nodeDownloadUrl', () => {
  it('monta a URL oficial do nodejs.org para win-x64', () => {
    expect(nodeDownloadUrl('22.11.0')).toBe(
      'https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip',
    );
  });

  it('usa NODE_VERSION por padrão', () => {
    expect(nodeDownloadUrl()).toBe(
      `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
    );
  });
});

describe('ensureNodePortable', () => {
  it('baixa e extrai quando não há cache', async () => {
    const cacheDir = path.join(tmpDir, 'cache');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    const extractImpl = vi.fn().mockImplementation(async (_zipPath, { dir }) => {
      const nodeSubdir = path.join(dir, `node-v22.11.0-win-x64`);
      await fs.mkdir(nodeSubdir, { recursive: true });
      await fs.writeFile(path.join(nodeSubdir, 'node.exe'), 'fake-binary');
    });

    const nodeDir = await ensureNodePortable({
      version: '22.11.0',
      cacheDir,
      fetchImpl,
      extractImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip',
    );
    expect(extractImpl).toHaveBeenCalledTimes(1);
    const exists = await fs
      .stat(path.join(nodeDir, 'node.exe'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('reusa o cache e não baixa de novo na segunda chamada', async () => {
    const cacheDir = path.join(tmpDir, 'cache');
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    const extractImpl = vi.fn().mockImplementation(async (_zipPath, { dir }) => {
      const nodeSubdir = path.join(dir, `node-v22.11.0-win-x64`);
      await fs.mkdir(nodeSubdir, { recursive: true });
      await fs.writeFile(path.join(nodeSubdir, 'node.exe'), 'fake-binary');
    });

    await ensureNodePortable({ version: '22.11.0', cacheDir, fetchImpl, extractImpl });
    fetchImpl.mockClear();
    extractImpl.mockClear();
    const nodeDir2 = await ensureNodePortable({
      version: '22.11.0',
      cacheDir,
      fetchImpl,
      extractImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(extractImpl).not.toHaveBeenCalled();
    const exists = await fs
      .stat(path.join(nodeDir2, 'node.exe'))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('lança erro claro se o download falhar (ok: false)', async () => {
    const cacheDir = path.join(tmpDir, 'cache');
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(
      ensureNodePortable({ version: '22.11.0', cacheDir, fetchImpl, extractImpl: vi.fn() }),
    ).rejects.toThrow(/404/);
  });
});
