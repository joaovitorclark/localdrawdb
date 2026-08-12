import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildExeLauncher } from '../buildLauncher.mjs';

const FILE_ALIGN = 0x200;
const SECT_ALIGN = 0x1000;
const PE_OFF = 0x80;
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/**
 * Binário PE64 mínimo, porém *estruturalmente válido*, pra servir de base da
 * injeção no teste (o node.exe real tem 100MB+ e não cabe numa suíte).
 *
 * Um arquivo só com "MZ" + padding não serve: o postject usa LIEF pra parsear
 * o executável e exige, nesta ordem, (a) um PE parseável de verdade — senão
 * falha com "Executable must be a supported format: ELF, PE, or Mach-O";
 * (b) uma seção `.rsrc` + Resource Table no data directory, porque em PE o
 * blob entra como recurso RCDATA — senão falha com "Error when injecting
 * resource"; (c) a string do sentinel fuse gravada no binário no formato
 * `<fuse>:0`, que o postject procura e vira `<fuse>:1` pra sinalizar que há
 * um blob SEA embutido — senão falha com "Could not find the sentinel ... in
 * the binary". O node.exe real satisfaz os três naturalmente.
 *
 * Continua sendo um executável que não roda (não tem código Node dentro) — o
 * objetivo aqui é só verificar que a injeção acontece e não corrompe o
 * formato. Rodar o .exe de verdade fica pro checklist manual em Windows.
 */
function makeMinimalPe64() {
  const NSECT = 2;
  const headers = Buffer.alloc(FILE_ALIGN, 0);

  // --- DOS header ---
  headers.write('MZ', 0, 'ascii');
  headers.writeUInt32LE(PE_OFF, 0x3c); // e_lfanew

  let o = PE_OFF;
  headers.write('PE\0\0', o, 'ascii'); o += 4;

  // --- COFF file header (20 bytes) ---
  headers.writeUInt16LE(0x8664, o); o += 2; // Machine = AMD64
  headers.writeUInt16LE(NSECT, o); o += 2;  // NumberOfSections
  headers.writeUInt32LE(0, o); o += 4;      // TimeDateStamp
  headers.writeUInt32LE(0, o); o += 4;      // PointerToSymbolTable
  headers.writeUInt32LE(0, o); o += 4;      // NumberOfSymbols
  headers.writeUInt16LE(240, o); o += 2;    // SizeOfOptionalHeader (PE32+)
  headers.writeUInt16LE(0x0022, o); o += 2; // EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE

  // --- Optional header PE32+ (240 bytes) ---
  headers.writeUInt16LE(0x20b, o); o += 2;  // Magic PE32+
  headers.writeUInt8(1, o); o += 1;         // MajorLinkerVersion
  headers.writeUInt8(0, o); o += 1;         // MinorLinkerVersion
  headers.writeUInt32LE(FILE_ALIGN, o); o += 4;      // SizeOfCode
  headers.writeUInt32LE(FILE_ALIGN, o); o += 4;      // SizeOfInitializedData
  headers.writeUInt32LE(0, o); o += 4;               // SizeOfUninitializedData
  headers.writeUInt32LE(SECT_ALIGN, o); o += 4;      // AddressOfEntryPoint
  headers.writeUInt32LE(SECT_ALIGN, o); o += 4;      // BaseOfCode
  headers.writeBigUInt64LE(0x140000000n, o); o += 8; // ImageBase
  headers.writeUInt32LE(SECT_ALIGN, o); o += 4;      // SectionAlignment
  headers.writeUInt32LE(FILE_ALIGN, o); o += 4;      // FileAlignment
  headers.writeUInt16LE(6, o); o += 2;      // MajorOperatingSystemVersion
  headers.writeUInt16LE(0, o); o += 2;      // MinorOperatingSystemVersion
  headers.writeUInt16LE(0, o); o += 2;      // MajorImageVersion
  headers.writeUInt16LE(0, o); o += 2;      // MinorImageVersion
  headers.writeUInt16LE(6, o); o += 2;      // MajorSubsystemVersion
  headers.writeUInt16LE(0, o); o += 2;      // MinorSubsystemVersion
  headers.writeUInt32LE(0, o); o += 4;      // Win32VersionValue
  headers.writeUInt32LE(SECT_ALIGN * (NSECT + 1), o); o += 4; // SizeOfImage
  headers.writeUInt32LE(FILE_ALIGN, o); o += 4;               // SizeOfHeaders
  headers.writeUInt32LE(0, o); o += 4;      // CheckSum
  headers.writeUInt16LE(3, o); o += 2;      // Subsystem = CONSOLE
  headers.writeUInt16LE(0, o); o += 2;      // DllCharacteristics
  headers.writeBigUInt64LE(0x100000n, o); o += 8; // SizeOfStackReserve
  headers.writeBigUInt64LE(0x1000n, o); o += 8;   // SizeOfStackCommit
  headers.writeBigUInt64LE(0x100000n, o); o += 8; // SizeOfHeapReserve
  headers.writeBigUInt64LE(0x1000n, o); o += 8;   // SizeOfHeapCommit
  headers.writeUInt32LE(0, o); o += 4;      // LoaderFlags
  headers.writeUInt32LE(16, o); o += 4;     // NumberOfRvaAndSizes

  const dataDirOff = o;
  o += 16 * 8; // 16 data directories, zeradas por padrão
  // DataDirectory[2] = Resource Table -> aponta pra seção .rsrc.
  headers.writeUInt32LE(SECT_ALIGN * 2, dataDirOff + 2 * 8);
  headers.writeUInt32LE(16, dataDirOff + 2 * 8 + 4);

  const writeSection = (name, rva, rawPtr, characteristics) => {
    headers.write(name.padEnd(8, '\0'), o, 8, 'ascii'); o += 8;
    headers.writeUInt32LE(FILE_ALIGN, o); o += 4; // VirtualSize
    headers.writeUInt32LE(rva, o); o += 4;        // VirtualAddress
    headers.writeUInt32LE(FILE_ALIGN, o); o += 4; // SizeOfRawData
    headers.writeUInt32LE(rawPtr, o); o += 4;     // PointerToRawData
    headers.writeUInt32LE(0, o); o += 4;          // PointerToRelocations
    headers.writeUInt32LE(0, o); o += 4;          // PointerToLinenumbers
    headers.writeUInt16LE(0, o); o += 2;          // NumberOfRelocations
    headers.writeUInt16LE(0, o); o += 2;          // NumberOfLinenumbers
    headers.writeUInt32LE(characteristics, o); o += 4;
  };

  writeSection('.text', SECT_ALIGN, FILE_ALIGN, 0x60000020);      // CODE|EXECUTE|READ
  writeSection('.rsrc', SECT_ALIGN * 2, FILE_ALIGN * 2, 0x40000040); // INITIALIZED_DATA|READ

  // .text: um `ret` + a string do sentinel fuse "desarmado" (`:0`).
  const text = Buffer.alloc(FILE_ALIGN, 0);
  text.writeUInt8(0xc3, 0);
  text.write(`${SEA_FUSE}:0\0`, 0x10, 'ascii');

  // .rsrc: IMAGE_RESOURCE_DIRECTORY vazio (16 bytes zerados) + padding.
  const rsrc = Buffer.alloc(FILE_ALIGN, 0);

  return Buffer.concat([headers, text, rsrc]);
}

let outDir;
let fakeNodeExe;

beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localdrawdb-buildlauncher-'));
  fakeNodeExe = path.join(outDir, 'fake-node.exe');
  await fs.writeFile(fakeNodeExe, makeMinimalPe64());
});

afterEach(async () => {
  await fs.rm(outDir, { recursive: true, force: true });
});

describe('buildExeLauncher', () => {
  it('gera um .exe maior que o binário base, com o header PE intacto', async () => {
    const exePath = await buildExeLauncher({ outDir, nodeExePath: fakeNodeExe });

    const exists = await fs.stat(exePath).then((s) => s.isFile()).catch(() => false);
    expect(exists).toBe(true);
    expect(exePath.endsWith('.exe')).toBe(true);

    const baseSize = (await fs.stat(fakeNodeExe)).size;
    const finalSize = (await fs.stat(exePath)).size;
    expect(finalSize).toBeGreaterThan(baseSize);

    const header = await fs.readFile(exePath);
    expect(header.subarray(0, 2).toString('ascii')).toBe('MZ');

    // O postject "arma" o fuse (`:0` -> `:1`) quando injeta o blob — prova de
    // que a injeção foi feita, e não só que o arquivo cresceu.
    expect(header.includes(`${SEA_FUSE}:1`)).toBe(true);
  }, 30_000);
});
