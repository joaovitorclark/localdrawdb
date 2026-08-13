import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildAppModeArgs, findEdgePath, openApp, parseRegistryCommand } from '../edgeAppMode.mjs';

// Caminhos montados com path.join: estes testes rodam em macOS/Linux, onde o
// separador não é `\`.
const PF_X86 = path.join('C:', 'Program Files (x86)');
const PF = path.join('C:', 'Program Files');
const EDGE_SUFFIX = path.join('Microsoft', 'Edge', 'Application', 'msedge.exe');
const EDGE_IN_X86 = path.join(PF_X86, EDGE_SUFFIX);
const EDGE_IN_PF = path.join(PF, EDGE_SUFFIX);

const ENV = { 'ProgramFiles(x86)': PF_X86, ProgramFiles: PF };

describe('parseRegistryCommand', () => {
  it('extrai o caminho entre aspas da saída do reg query', () => {
    const output = [
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Clients\\StartMenuInternet\\Microsoft Edge\\shell\\open\\command',
      '    (Default)    REG_SZ    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"',
      '',
    ].join('\r\n');
    expect(parseRegistryCommand(output)).toBe(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  });

  it('descarta argumentos que acompanham o executável', () => {
    const output =
      '    (Default)    REG_SZ    "C:\\Edge\\msedge.exe" --single-argument %1';
    expect(parseRegistryCommand(output)).toBe('C:\\Edge\\msedge.exe');
  });

  it('devolve null para saída vazia ou sem REG_SZ', () => {
    expect(parseRegistryCommand(null)).toBeNull();
    expect(parseRegistryCommand('')).toBeNull();
    expect(parseRegistryCommand('ERRO: nao foi possivel encontrar a chave')).toBeNull();
  });

  it('extrai caminho sem aspas descartando argumentos', () => {
    const output = '    (Default)    REG_SZ    C:\\Edge\\msedge.exe --single-argument %1';
    expect(parseRegistryCommand(output)).toBe('C:\\Edge\\msedge.exe');
  });

  it('extrai caminho sem aspas sem argumentos', () => {
    const output = '    (Default)    REG_SZ    C:\\Edge\\msedge.exe';
    expect(parseRegistryCommand(output)).toBe('C:\\Edge\\msedge.exe');
  });
});

describe('findEdgePath', () => {
  it('prefere Program Files (x86) — onde o Edge stable instala mesmo em Windows 64-bit', async () => {
    const fileExists = vi.fn(async (p) => p === EDGE_IN_X86 || p === EDGE_IN_PF);
    const queryRegistry = vi.fn();

    const found = await findEdgePath({ env: ENV, fileExists, queryRegistry });

    expect(found).toBe(EDGE_IN_X86);
    // Achou por caminho conhecido: não paga o custo de consultar o registro.
    expect(queryRegistry).not.toHaveBeenCalled();
  });

  it('cai para Program Files quando não existe em (x86)', async () => {
    const fileExists = vi.fn(async (p) => p === EDGE_IN_PF);
    const found = await findEdgePath({ env: ENV, fileExists, queryRegistry: vi.fn() });
    expect(found).toBe(EDGE_IN_PF);
  });

  it('consulta o registro quando nenhum caminho conhecido existe', async () => {
    const fromRegistry = path.join('D:', 'Edge', 'msedge.exe');
    const fileExists = vi.fn(async (p) => p === fromRegistry);
    const queryRegistry = vi.fn(async () => `    (Default)    REG_SZ    "${fromRegistry}"`);

    const found = await findEdgePath({ env: ENV, fileExists, queryRegistry });

    expect(found).toBe(fromRegistry);
    expect(queryRegistry).toHaveBeenCalledTimes(1);
  });

  it('devolve null quando o registro aponta para um arquivo inexistente', async () => {
    const fileExists = vi.fn(async () => false);
    const queryRegistry = vi.fn(async () => '    (Default)    REG_SZ    "C:\\sumiu\\msedge.exe"');

    expect(await findEdgePath({ env: ENV, fileExists, queryRegistry })).toBeNull();
  });

  it('devolve null sem quebrar quando o ambiente não tem as variáveis do Windows', async () => {
    const fileExists = vi.fn(async () => false);
    const queryRegistry = vi.fn(async () => null);

    expect(await findEdgePath({ env: {}, fileExists, queryRegistry })).toBeNull();
    // env vazio: nenhum candidato conhecido pra testar.
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('encontra Edge em LOCALAPPDATA quando os Program Files não estão definidos', async () => {
    const LOCALAPPDATA = path.join('C:', 'Users', 'jvclark', 'AppData', 'Local');
    const EDGE_IN_LOCALAPPDATA = path.join(LOCALAPPDATA, EDGE_SUFFIX);
    const fileExists = vi.fn(async (p) => p === EDGE_IN_LOCALAPPDATA);
    const queryRegistry = vi.fn();

    const found = await findEdgePath({ env: { LOCALAPPDATA }, fileExists, queryRegistry });

    expect(found).toBe(EDGE_IN_LOCALAPPDATA);
    // Achou por caminho conhecido: não consulta registro.
    expect(queryRegistry).not.toHaveBeenCalled();
  });
});

// Dublê de ChildProcess: registra unref/handlers sem spawnar nada de verdade.
function fakeChild() {
  const handlers = {};
  return {
    unref: vi.fn(),
    on: vi.fn((event, fn) => {
      handlers[event] = fn;
    }),
    emit: (event, arg) => handlers[event]?.(arg),
  };
}

describe('buildAppModeArgs', () => {
  it('monta os argumentos de janela de aplicativo com perfil isolado', () => {
    const profileDir = path.join('C:', 'LocalDrawDB', 'data', 'edge-profile');
    const args = buildAppModeArgs({ url: 'http://127.0.0.1:5174', profileDir });

    expect(args).toEqual([
      '--app=http://127.0.0.1:5174',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ]);
  });
});

describe('openApp', () => {
  const launcherDir = path.join('C:', 'LocalDrawDB');
  const url = 'http://127.0.0.1:5174';

  it('abre o Edge em modo app quando o Edge existe', async () => {
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const fallbackOpen = vi.fn();

    const result = await openApp({
      url,
      launcherDir,
      findEdgePathImpl: async () => EDGE_IN_X86,
      spawnImpl,
      fallbackOpen,
      logger: { warn: vi.fn() },
    });

    expect(result).toEqual({ mode: 'edge-app', edgePath: EDGE_IN_X86 });
    expect(fallbackOpen).not.toHaveBeenCalled();

    const [exe, args, opts] = spawnImpl.mock.calls[0];
    expect(exe).toBe(EDGE_IN_X86);
    expect(args).toContain(`--app=${url}`);
    // Perfil dentro da pasta portátil: nada em %LOCALAPPDATA%.
    expect(args).toContain(
      `--user-data-dir=${path.join(launcherDir, 'data', 'edge-profile')}`,
    );
    // detached + unref: fechar o launcher não pode arrastar a janela junto.
    expect(opts).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(child.unref).toHaveBeenCalled();
  });

  it('cai no navegador padrão quando não há Edge', async () => {
    const spawnImpl = vi.fn();
    const fallbackOpen = vi.fn();
    const logger = { warn: vi.fn() };

    const result = await openApp({
      url,
      launcherDir,
      findEdgePathImpl: async () => null,
      spawnImpl,
      fallbackOpen,
      logger,
    });

    expect(result).toEqual({ mode: 'default-browser', edgePath: null });
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(fallbackOpen).toHaveBeenCalledWith(url);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('cai no navegador padrão quando o Edge existe mas falha ao subir', async () => {
    const child = fakeChild();
    const fallbackOpen = vi.fn();
    const logger = { warn: vi.fn() };

    await openApp({
      url,
      launcherDir,
      findEdgePathImpl: async () => EDGE_IN_X86,
      spawnImpl: () => child,
      fallbackOpen,
      logger,
    });

    // spawn reporta falha de execução de forma assíncrona, via evento 'error'.
    expect(fallbackOpen).not.toHaveBeenCalled();
    child.emit('error', new Error('EACCES'));
    expect(fallbackOpen).toHaveBeenCalledWith(url);
    expect(logger.warn).toHaveBeenCalled();
  });
});
