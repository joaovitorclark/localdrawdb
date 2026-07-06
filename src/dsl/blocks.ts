// Tokenizer de blocos top-level do DBML. Habilita Organize e o tratamento de
// Records sem depender do re-export instável do @dbml/core.

export type BlockType =
  | 'project'
  | 'enum'
  | 'table'
  | 'tableGroup'
  | 'layerGroup'
  | 'ref'
  | 'lineage'
  | 'lineageFields'
  | 'records'
  | 'rolenames'
  | 'colors'
  | 'dbt'
  | 'comment'
  | 'blank';

export type Block = { type: BlockType; name?: string; text: string; lineStart?: number };

/**
 * Normaliza fins de linha para `\n` (converte CRLF e CR isolado do Windows/legado).
 * Crítico para os regexes de campo/rename: em JS, `.` não casa `\r` e `$` (sem flag `m`)
 * não casa antes de `\r`, então `\r` residual quebra `parseFieldLine` e a detecção de rename.
 */
export const normalizeEol = (src: string): string => src.replace(/\r\n?/g, '\n');

/** Delta de chaves numa linha, ignorando strings ('...'/"...") e comentário //. */
function braceDelta(line: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '/' && line[i + 1] === '/') break; // resto é comentário
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  return depth;
}

function detectType(trimmed: string): BlockType {
  if (/^Project\b/i.test(trimmed)) return 'project';
  if (/^Enum\b/i.test(trimmed)) return 'enum';
  if (/^LayerGroup\b/i.test(trimmed)) return 'layerGroup';
  if (/^TableGroup\b/i.test(trimmed)) return 'tableGroup';
  if (/^Table\b/i.test(trimmed)) return 'table';
  if (/^Ref\b/i.test(trimmed)) return 'ref';
  if (/^LineageFields\b/i.test(trimmed)) return 'lineageFields';
  if (/^Lineage\b/i.test(trimmed)) return 'lineage';
  if (/^records\b/i.test(trimmed)) return 'records';
  if (/^Rolenames\b/i.test(trimmed)) return 'rolenames';
  if (/^Colors\b/i.test(trimmed)) return 'colors';
  if (/^Dbt\b/i.test(trimmed)) return 'dbt';
  return 'comment';
}

function detectName(type: BlockType, trimmed: string): string | undefined {
  if (type === 'table') return /^Table\s+("?[^"\s{]+"?)/i.exec(trimmed)?.[1];
  if (type === 'tableGroup') return /^TableGroup\s+("?[^"\s{]+"?)/i.exec(trimmed)?.[1];
  if (type === 'records') return /^records\s+("?[^"\s(]+"?)/i.exec(trimmed)?.[1];
  if (type === 'enum') return /^Enum\s+("?[^"\s{]+"?)/i.exec(trimmed)?.[1];
  return undefined;
}

/**
 * Divide o DBML em blocos top-level. Comentários e linhas em branco imediatamente
 * acima de um bloco são anexados ao texto daquele bloco (viajam junto ao organizar).
 */
export function splitDbmlBlocks(src: string): Block[] {
  const lines = src.split('\n');
  const blocks: Block[] = [];
  let leading: string[] = [];
  let leadingStart = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      if (!leading.length) leadingStart = i;
      leading.push(line);
      i++;
      continue;
    }
    if (trimmed.startsWith('//')) {
      if (!leading.length) leadingStart = i;
      leading.push(line);
      i++;
      continue;
    }

    const type = detectType(trimmed);
    const blockStart = i;
    const blockLines = [line];
    let depth = braceDelta(line);
    i++;
    while (i < lines.length && depth > 0) {
      blockLines.push(lines[i]);
      depth += braceDelta(lines[i]);
      i++;
    }

    const text = [...leading, ...blockLines].join('\n');
    const lineStart = leading.length ? leadingStart : blockStart;
    leading = [];
    blocks.push({ type, name: detectName(type, trimmed), text, lineStart });
  }

  if (leading.some((l) => l.trim() !== '')) {
    blocks.push({ type: 'comment', text: leading.join('\n'), lineStart: leadingStart });
  }
  return blocks;
}

export function isBlockType(b: Block, t: BlockType): boolean {
  return b.type === t;
}
