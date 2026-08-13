import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  buildAppModeArgs,
  ensureDesktopShortcut,
  findEdgePath,
  openApp,
  parseRegistryCommand,
} from '../edgeAppMode.mjs';

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

describe('ensureDesktopShortcut', () => {
  let launcherDir;

  beforeEach(async () => {
    // Diretório real em vez de fs mockado: o marcador é o núcleo do
    // comportamento aqui, e testá-lo contra o filesystem de verdade é mais
    // fiel do que espiar chamadas de writeFile.
    launcherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-shortcut-'));
    await fs.mkdir(path.join(launcherDir, 'data'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(launcherDir, { recursive: true, force: true });
  });

  const markerPath = () => path.join(launcherDir, 'data', '.desktop-shortcut-attempted');

  it('cria o atalho na primeira execução e grava o marcador', async () => {
    const execImpl = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const exePath = path.join(launcherDir, 'LocalDrawDB.exe');

    const result = await ensureDesktopShortcut({
      launcherDir,
      exePath,
      execImpl,
      logger: { warn: vi.fn() },
    });

    expect(result).toEqual({ created: true });
    expect(execImpl).toHaveBeenCalledTimes(1);

    const [cmd, args, opts] = execImpl.mock.calls[0];
    expect(cmd).toBe('powershell.exe');
    expect(args).toContain('-NoProfile');
    expect(args).toContain('-NonInteractive');
    // O caminho da Área de Trabalho é resolvido pelo próprio PowerShell —
    // é o que respeita redirecionamento (OneDrive, política de grupo).
    expect(args.at(-1)).toContain("GetFolderPath(\"Desktop\")");
    expect(args.at(-1)).toContain('LocalDrawDB.lnk');
    // Caminhos vão por env, não interpolados no script: evita quebrar (ou pior,
    // injetar) quando o caminho tem aspas, espaços ou `$`.
    expect(opts.env.LDB_TARGET).toBe(exePath);
    expect(opts.env.LDB_WORKDIR).toBe(launcherDir);
    expect(opts.env.LDB_ICON).toBe(path.join(launcherDir, 'dist', 'favicon.ico'));

    const markerExists = await fs.stat(markerPath()).then(() => true).catch(() => false);
    expect(markerExists).toBe(true);
  });

  it('não tenta de novo quando o marcador já existe', async () => {
    await fs.writeFile(markerPath(), 'já tentado', 'utf8');
    const execImpl = vi.fn();

    const result = await ensureDesktopShortcut({
      launcherDir,
      exePath: path.join(launcherDir, 'LocalDrawDB.exe'),
      execImpl,
      logger: { warn: vi.fn() },
    });

    expect(result).toEqual({ created: false, reason: 'already-attempted' });
    expect(execImpl).not.toHaveBeenCalled();
  });

  it('engole a falha do PowerShell, avisa e marca a tentativa', async () => {
    const execImpl = vi.fn(async () => {
      throw new Error('AccessDenied');
    });
    const logger = { warn: vi.fn() };

    const result = await ensureDesktopShortcut({
      launcherDir,
      exePath: path.join(launcherDir, 'LocalDrawDB.exe'),
      execImpl,
      logger,
    });

    expect(result).toEqual({ created: false, reason: 'error' });
    expect(logger.warn).toHaveBeenCalled();
    // Marca mesmo na falha: num Windows com política restritiva a criação
    // falha sempre, e sem o marcador o launcher pagaria um spawn de
    // PowerShell em toda execução, pra sempre.
    const markerExists = await fs.stat(markerPath()).then(() => true).catch(() => false);
    expect(markerExists).toBe(true);
  });
});
