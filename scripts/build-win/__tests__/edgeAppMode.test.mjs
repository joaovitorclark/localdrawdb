import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findEdgePath, parseRegistryCommand } from '../edgeAppMode.mjs';

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
