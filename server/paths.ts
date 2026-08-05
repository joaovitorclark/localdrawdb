// Raiz do repositório e diretório de dados default — únicas fontes de
// verdade para ambos, para evitar ciclos de import entre files.ts e
// domainContext.ts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
