// Mutações de texto do DBML ancoradas no bloco da tabela (via splitDbmlBlocks).
// Princípio: nomes de coluna são únicos numa tabela -> localização robusta por nome.
import { splitDbmlBlocks, normalizeEol } from './blocks';
import { quoteDbmlNote } from './dbmlNotes';
import { splitTableColumn } from './dbmlClean';
import { dbmlIdent } from './parse';

const stripQuotes = (s: string) => s.replace(/["`]/g, '').trim();

/** Casa o nome do bloco com um id possivelmente qualificado (schema.tabela). */
function tableMatches(blockName: string | undefined, target: string): boolean {
  if (!blockName) return false;
  const a = stripQuotes(blockName).toLowerCase();
  const b = stripQuotes(target).toLowerCase();
  if (a === b) return true;
  const lastA = a.split('.').pop()!;
  const lastB = b.split('.').pop()!;
  return lastA === lastB && (a.endsWith('.' + lastB) || b.endsWith('.' + lastA) || lastA === b || lastB === a);
}

/** Reconstrói o src aplicando `fn` ao texto do bloco da tabela alvo. */
function mutateTableBlock(src: string, table: string, fn: (blockText: string) => string): string {
  const blocks = splitDbmlBlocks(src);
  let found = false;
  const out = blocks.map((b) => {
    if (b.type === 'table' && tableMatches(b.name, table)) {
      found = true;
      return fn(b.text);
    }
    return b.text;
  });
  return found ? out.join('\n') : src;
}

/** Quebra uma linha de campo em { indent, name, rest (tipo+settings) }. */
function parseFieldLine(line: string): { indent: string; name: string; rest: string } | null {
  const m = /^(\s*)("?[A-Za-z_][\w]*"?|"[^"]+")\s+(.*)$/.exec(line);
  if (!m) return null;
  return { indent: m[1], name: stripQuotes(m[2]), rest: m[3] };
}

const isFieldLine = (line: string) => {
  const t = line.trim();
  if (!t || t.startsWith('//')) return false;
  if (/^Table\b/i.test(t) || t.startsWith('}') || t === '{') return false;
  if (/^(Note|indexes)\b/i.test(t)) return false;
  return /^("?[A-Za-z_][\w]*"?|"[^"]+")\s+\S/.test(t);
};

// ---- Settings de coluna ----

export type ColSettings = {
  pk?: boolean;
  notNull?: boolean;
  note?: string;
  default?: string;
  /** FK inline: `schema.tabela.coluna` */
  refTarget?: string | null;
};

/** Reescreve o sufixo [..] de uma coluna, preservando settings não gerenciados. */
function applySettings(rest: string, s: ColSettings): string {
  const bracket = /\[([^\]]*)\]\s*$/.exec(rest);
  const typePart = bracket ? rest.slice(0, bracket.index).trim() : rest.trim();
  const existing = bracket
    ? bracket[1].split(',').map((x) => x.trim()).filter(Boolean)
    : [];

  // Remove os tokens gerenciados; mantém o resto (unique, increment, ...).
  const managed = /^(pk|primary key|not null|note\s*:|default\s*:|ref\s*:)/i;
  const kept = existing.filter((tok) => !managed.test(tok));

  const tokens = [...kept];
  if (s.pk) tokens.push('pk');
  if (s.notNull) tokens.push('not null');
  if (s.note) tokens.push(`note: ${quoteDbmlNote(s.note)}`);
  if (s.default !== undefined && s.default !== '') tokens.push(`default: ${s.default}`);
  if (s.refTarget) tokens.push(`ref: > ${s.refTarget}`);

  return tokens.length ? `${typePart} [${tokens.join(', ')}]` : typePart;
}

/** Extrai os settings gerenciados de uma linha de campo (helper puro, sem regex fora). */
function readFieldLineSettings(rest: string): ColSettings {
  const bracket = /\[([^\]]*)\]\s*$/.exec(rest);
  const inside = bracket?.[1] ?? '';
  const toks = bracket ? bracket[1].split(',').map((x) => x.trim()) : [];
  const result: ColSettings = {};
  result.pk = toks.some((t) => /^(pk|primary key)$/i.test(t));
  result.notNull = toks.some((t) => /^not null$/i.test(t));
  result.note = /note\s*:\s*'([^']*)'/i.exec(inside)?.[1];
  result.default = /default\s*:\s*([^,]+)/i.exec(inside)?.[1]?.trim();
  const refM = /ref\s*:\s*>\s*([^\s,]+)/i.exec(inside);
  if (refM) result.refTarget = refM[1];
  return result;
}

/** Lê os settings gerenciados atuais de uma coluna a partir do texto do bloco da tabela. */
function readSettingsFromBlock(blockText: string, column: string): ColSettings {
  for (const line of blockText.split('\n')) {
    if (!isFieldLine(line)) continue;
    const f = parseFieldLine(line);
    if (!f || f.name !== stripQuotes(column)) continue;
    return readFieldLineSettings(f.rest);
  }
  return {};
}

/** Lê os settings gerenciados atuais de uma coluna (para popular o painel). */
export function getColumnSettings(src: string, table: string, column: string): ColSettings {
  let result: ColSettings = {};
  mutateTableBlock(src, table, (block) => {
    result = readSettingsFromBlock(block, column);
    return block;
  });
  return result;
}

/** Versão que recebe os blocos já parseados (evita re-split do DBML a cada chamada). */
export function getColumnSettingsFromBlocks(
  blocks: ReturnType<typeof splitDbmlBlocks>,
  table: string,
  column: string,
): ColSettings {
  for (const b of blocks) {
    if (b.type === 'table' && tableMatches(b.name, table)) {
      return readSettingsFromBlock(b.text, column);
    }
  }
  return {};
}

export function setColumnSetting(
  src: string,
  table: string,
  column: string,
  settings: ColSettings,
): string {
  return mutateTableBlock(src, table, (block) =>
    block
      .split('\n')
      .map((line) => {
        if (!isFieldLine(line)) return line;
        const f = parseFieldLine(line);
        if (!f || f.name !== stripQuotes(column)) return line;
        return `${f.indent}${f.name} ${applySettings(f.rest, settings)}`;
      })
      .join('\n'),
  );
}

function formatNoteLine(note: string): string {
  return `  Note: ${quoteDbmlNote(note)}`;
}

function upsertNoteLine(blockText: string, note: string): string {
  const lines = blockText.split('\n');
  const trimmed = note.trim();
  const noteIdx = lines.findIndex((l) => /^\s*Note\s*:/i.test(l));
  if (trimmed) {
    const noteLine = formatNoteLine(trimmed);
    if (noteIdx >= 0) lines[noteIdx] = noteLine;
    else {
      let closeIdx = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim() === '}') {
          closeIdx = i;
          break;
        }
      }
      lines.splice(closeIdx >= 0 ? closeIdx : lines.length, 0, noteLine);
    }
  } else if (noteIdx >= 0) {
    lines.splice(noteIdx, 1);
  }
  return lines.join('\n');
}

/** Atualiza `Note:` no bloco Table. */
export function setTableNote(src: string, table: string, note: string): string {
  return mutateTableBlock(src, table, (block) => upsertNoteLine(block, note));
}

/** Atualiza `Note:` no bloco Records da tabela. */
export function setRecordsNote(src: string, table: string, note: string): string {
  const blocks = splitDbmlBlocks(src);
  let found = false;
  const out = blocks.map((b) => {
    if (b.type !== 'records' || !tableMatches(b.name, table)) return b.text;
    found = true;
    return upsertNoteLine(b.text, note);
  });
  return found ? out.join('\n') : src;
}

/** Prefere Records se existir bloco; senão altera Note da Table. */
export function setTableOrRecordsNote(src: string, table: string, note: string): string {
  const hasRecords = splitDbmlBlocks(src).some(
    (b) => b.type === 'records' && tableMatches(b.name, table),
  );
  return hasRecords ? setRecordsNote(src, table, note) : setTableNote(src, table, note);
}

export function renameColumn(src: string, table: string, oldName: string, newName: string): string {
  return mutateTableBlock(src, table, (block) =>
    block
      .split('\n')
      .map((line) => {
        if (!isFieldLine(line)) return line;
        const f = parseFieldLine(line);
        if (!f || f.name !== stripQuotes(oldName)) return line;
        return `${f.indent}${dbmlIdent(newName)} ${f.rest}`;
      })
      .join('\n'),
  );
}

/** Renomeia coluna na definição e propaga refs, LineageFields, Records e indexes. */
export function renameColumnAllRefs(
  src: string,
  table: string,
  oldName: string,
  newName: string,
): string {
  src = normalizeEol(src); // CRLF-safe: `parseFieldLine`/regexes de campo assumem LF
  const old = stripQuotes(oldName);
  const neu = stripQuotes(newName);
  if (!old || !neu || old === neu) return src;

  let out = renameColumn(src, table, old, neu);
  const t = stripQuotes(table);
  const oldQ = `${t}.${old}`;
  const newQ = `${t}.${neu}`;
  const qRe = new RegExp(`(?<![\\w.])${escapeRegex(oldQ)}(?![\\w])`, 'g');
  out = out.replace(qRe, newQ);

  out = mutateTableBlock(out, table, (block) => {
    let inIndexes = false;
    return block
      .split('\n')
      .map((line) => {
        if (/^\s*indexes\s*\{/i.test(line)) inIndexes = true;
        if (inIndexes && line.trim() === '}') inIndexes = false;
        if (inIndexes) return line.replace(new RegExp(`\\b${escapeRegex(old)}\\b`, 'g'), neu);
        return line;
      })
      .join('\n');
  });

  const blocks = splitDbmlBlocks(out);
  out = blocks
    .map((b) => {
      if (b.type === 'records') {
        const tbl = /^records\s+("?[^"\s(]+"?)\s*\(([^)]*)\)/i.exec(b.text);
        if (tbl && stripQuotes(tbl[1]) === t) {
          const cols = tbl[2].split(',').map((c) => c.trim());
          const updated = cols.map((c) => (stripQuotes(c) === old ? neu : c)).join(', ');
          return b.text.replace(tbl[2], updated);
        }
      }
      return b.text;
    })
    .join('\n');

  return out;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Nome qualificado completo (não aceita `schema.` ou segmentos vazios). */
export function isCompleteTableId(id: string): boolean {
  const s = stripQuotes(id);
  if (!s || s.endsWith('.') || s.startsWith('.')) return false;
  if (/\.\./.test(s)) return false;
  const parts = s.split('.');
  return parts.every((p) => /^[A-Za-z_][\w]*$/.test(p));
}

/** Regex que casa só o identificador completo da tabela (nunca prefixo schema). */
function tableIdReplaceRegex(old: string): RegExp {
  const escaped = escapeRegex(old);
  if (old.includes('.')) {
    // Qualificado: ok antes de `.coluna` (Ref) ou fim do token (Table, TableGroup).
    return new RegExp(`(?<![\\w.])${escaped}(?=\\.[A-Za-z_][\\w]*|(?![\\w.]))`, 'g');
  }
  // Sem ponto: não pode ser seguido de `.` (evita silver → silver.dim_x).
  return new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`, 'g');
}

/**
 * Renomeia uma tabela em todo o documento: cabeçalho, refs e membros de TableGroup.
 * Casa o token qualificado inteiro — nunca substitui só o prefixo schema (ex.: silver em silver.dim_x).
 */
export function renameTable(src: string, tableId: string, newName: string): string {
  src = normalizeEol(src); // CRLF-safe: consistência com a detecção e a contagem de refs
  const old = stripQuotes(tableId);
  const neu = stripQuotes(newName.trim());
  if (!old || !neu || old === neu) return src;
  if (!isCompleteTableId(old) || !isCompleteTableId(neu)) return src;
  return src.replace(tableIdReplaceRegex(old), dbmlIdent(neu));
}

export function addColumn(src: string, table: string, name: string, type = 'string'): string {
  return mutateTableBlock(src, table, (block) => {
    const close = block.lastIndexOf('}');
    if (close < 0) return block;
    const indent = '  ';
    const insertion = `${indent}${dbmlIdent(name)} ${type}\n`;
    return block.slice(0, close) + insertion + block.slice(close);
  });
}

// ---- Refs (drag-to-create) ----

export function refExists(src: string, fromTbl: string, fromCol: string, toTbl: string, toCol: string): boolean {
  const a = `${stripQuotes(fromTbl)}.${fromCol}`;
  const b = `${stripQuotes(toTbl)}.${toCol}`;
  for (const block of splitDbmlBlocks(src)) {
    if (block.type !== 'ref') continue;
    const text = block.text.replace(/["`]/g, '');
    if (text.includes(a) && text.includes(b)) return true;
  }
  return false;
}

// ---- Camadas (LayerGroup no DBML) ----

const lgName = (block: string) => /LayerGroup\s+("?[^"\s[{]+"?)/i.exec(block)?.[1]?.replace(/["`]/g, '');
const lgRemoveMember = (block: string, tableId: string) =>
  block
    .split('\n')
    .filter((l) => l.trim().replace(/["`]/g, '') !== stripQuotes(tableId))
    .join('\n');
function lgAddMember(block: string, tableId: string): string {
  if (block.includes(`\n  ${tableId}`) || new RegExp(`\\n\\s*${escapeRegex(tableId)}\\s*\\n`).test(block)) return block;
  const close = block.lastIndexOf('}');
  if (close < 0) return block;
  return block.slice(0, close) + `  ${dbmlIdent(tableId)}\n` + block.slice(close);
}

/** Atribui (ou remove) a camada de uma tabela mutando os blocos `LayerGroup` do DBML. */
export function setTableLayer(src: string, tableId: string, layerId: string | null, color?: string): string {
  let found = false;
  const out = splitDbmlBlocks(src).map((b) => {
    if (b.type !== 'layerGroup') return b.text;
    let text = lgRemoveMember(b.text, tableId); // tabela fica em no máximo 1 camada
    if (layerId && lgName(b.text)?.toLowerCase() === layerId.toLowerCase()) {
      text = lgAddMember(text, tableId);
      found = true;
    }
    return text;
  });
  let result = out.join('\n');
  if (layerId && !found) {
    const colorPart = color ? ` [color: ${color}]` : '';
    result = `${result.replace(/\n+$/, '')}\n\nLayerGroup ${layerId}${colorPart} {\n  ${dbmlIdent(tableId)}\n}\n`;
  }
  return result.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Cria um LayerGroup vazio (camada nova) no DBML. */
export function addLayerGroup(src: string, name: string, color: string): string {
  const id = name.toLowerCase().replace(/\s+/g, '_');
  if (splitDbmlBlocks(src).some((b) => b.type === 'layerGroup' && lgName(b.text)?.toLowerCase() === id)) return src;
  return `${src.replace(/\n+$/, '')}\n\nLayerGroup ${id} [color: ${color}] {\n}\n`;
}

// ---- Lineage (bloco Lineage no DBML) ----

/** Adiciona um par source→target ao bloco Lineage (cria o bloco se não existir). */
export function addLineageEntry(src: string, source: string, target: string): string {
  const blocks = splitDbmlBlocks(src);
  const linBlock = blocks.find((b) => b.type === 'lineage');
  if (linBlock) {
    const lines = linBlock.text.split('\n');
    const existing = lines.find((l) => {
      const m = /^(\s*)([^\s<]+)\s*</.exec(l);
      return m && m[2].trim() === target;
    });
    if (existing) {
      if (existing.includes(source)) return src;
      const updated = existing.replace(/(<\s*.+)$/, `$1, ${source}`);
      const newText = linBlock.text.replace(existing, updated);
      return src.replace(linBlock.text, newText);
    }
    const close = linBlock.text.lastIndexOf('}');
    if (close >= 0) {
      const newText = linBlock.text.slice(0, close) + `  ${target} < ${source}\n` + linBlock.text.slice(close);
      return src.replace(linBlock.text, newText);
    }
  }
  return `${src.replace(/\n+$/, '')}\n\nLineage {\n  ${target} < ${source}\n}\n`;
}

/** Remove um par source→target do bloco Lineage. Remove a linha se ficar sem sources. */
export function removeLineageEntry(src: string, source: string, target: string): string {
  const blocks = splitDbmlBlocks(src);
  const linBlock = blocks.find((b) => b.type === 'lineage');
  if (!linBlock) return src;
  const updated = linBlock.text.split('\n').map((line) => {
    const m = /^(\s*)([^\s<]+)\s*<\s*(.+)$/.exec(line);
    if (!m || m[2].trim() !== target) return line;
    const sources = m[3].split(',').map((s) => s.trim()).filter((s) => s !== source);
    if (!sources.length) return null;
    return `${m[1]}${m[2]} < ${sources.join(', ')}`;
  }).filter((l): l is string => l !== null).join('\n');
  if (!/\S/.test(updated.replace(/Lineage\s*\{/i, '').replace('}', ''))) {
    return src.replace(linBlock.text, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  return src.replace(linBlock.text, updated);
}

// ---- LineageFields (mapeamento coluna→coluna) ----

function fieldLineageLine(
  targetTable: string,
  targetColumn: string,
  sourceTable: string,
  sourceColumn: string,
  meta?: { note?: string; ref?: string },
): string {
  const tq = `${targetTable}.${targetColumn}`;
  const sq = `${sourceTable}.${sourceColumn}`;
  const parts: string[] = [];
  if (meta?.note) parts.push(`note: ${quoteDbmlNote(meta.note)}`);
  if (meta?.ref) parts.push(`ref: '${meta.ref.replace(/'/g, "\\'")}'`);
  const bracket = parts.length ? ` [${parts.join(', ')}]` : '';
  return `  ${tq} < ${sq}${bracket}`;
}

/** Adiciona mapeamento campo→campo ao bloco LineageFields. */
export function addFieldLineageEntry(
  src: string,
  sourceTable: string,
  sourceColumn: string,
  targetTable: string,
  targetColumn: string,
  meta?: { note?: string; ref?: string },
): string {
  const line = fieldLineageLine(targetTable, targetColumn, sourceTable, sourceColumn, meta);
  const blocks = splitDbmlBlocks(src);
  const block = blocks.find((b) => b.type === 'lineageFields');
  if (block) {
    const needle = `${targetTable}.${targetColumn} < ${sourceTable}.${sourceColumn}`;
    if (block.text.includes(needle)) return src;
    const close = block.text.lastIndexOf('}');
    if (close >= 0) {
      const newText = block.text.slice(0, close) + `${line}\n` + block.text.slice(close);
      return src.replace(block.text, newText);
    }
  }
  return `${src.replace(/\n+$/, '')}\n\nLineageFields {\n${line}\n}\n`;
}

/** Remove mapeamento campo→campo. */
export function removeFieldLineageEntry(
  src: string,
  sourceTable: string,
  sourceColumn: string,
  targetTable: string,
  targetColumn: string,
): string {
  const blocks = splitDbmlBlocks(src);
  const block = blocks.find((b) => b.type === 'lineageFields');
  if (!block) return src;
  const prefix = `${targetTable}.${targetColumn} < ${sourceTable}.${sourceColumn}`;
  const updated = block.text
    .split('\n')
    .filter((l) => !l.trim().startsWith(prefix) && !l.includes(prefix))
    .join('\n');
  if (!/\S/.test(updated.replace(/LineageFields\s*\{/i, '').replace('}', ''))) {
    return src.replace(block.text, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  return src.replace(block.text, updated);
}

/** Atualiza note/ref de um mapeamento existente. */
export function updateFieldLineageMeta(
  src: string,
  sourceTable: string,
  sourceColumn: string,
  targetTable: string,
  targetColumn: string,
  meta: { note?: string; ref?: string },
): string {
  const without = removeFieldLineageEntry(src, sourceTable, sourceColumn, targetTable, targetColumn);
  return addFieldLineageEntry(
    without, sourceTable, sourceColumn, targetTable, targetColumn, meta,
  );
}

type FieldLineageKey = {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
};

/** Substitui um mapeamento existente (inclui mudança de origem/destino). */
export function updateFieldLineageEntry(
  src: string,
  prev: FieldLineageKey,
  next: FieldLineageKey & { note?: string; ref?: string },
): string {
  const without = removeFieldLineageEntry(
    src, prev.sourceTable, prev.sourceColumn, prev.targetTable, prev.targetColumn,
  );
  return addFieldLineageEntry(
    without,
    next.sourceTable,
    next.sourceColumn,
    next.targetTable,
    next.targetColumn,
    { note: next.note, ref: next.ref },
  );
}

/** Remove bloco `Ref` ou FK inline `[ref: > …]` do par indicado. */
export function removeRef(
  src: string,
  fromTbl: string,
  fromCol: string,
  toTbl: string,
  toCol: string,
): string {
  const a = `${stripQuotes(fromTbl)}.${fromCol}`;
  const b = `${stripQuotes(toTbl)}.${toCol}`;
  let removed = false;
  const kept = splitDbmlBlocks(src).filter((block) => {
    if (block.type !== 'ref') return true;
    const text = block.text.replace(/["`]/g, '');
    if (text.includes(a) && text.includes(b)) {
      removed = true;
      return false;
    }
    return true;
  });
  if (removed) {
    return kept.map((bl) => bl.text).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  const tryClearInline = (table: string, column: string, expectedTarget: string): string | null => {
    const settings = getColumnSettings(src, table, column);
    if (!settings.refTarget) return null;
    if (stripQuotes(settings.refTarget).toLowerCase() !== stripQuotes(expectedTarget).toLowerCase()) {
      return null;
    }
    return setColumnSetting(src, table, column, { ...settings, refTarget: null });
  };

  const cleared = tryClearInline(fromTbl, fromCol, b) ?? tryClearInline(toTbl, toCol, a);
  return cleared ?? src;
}

function tableTokenInText(text: string, tableId: string): boolean {
  const bare = text.replace(/["`]/g, '');
  const t = stripQuotes(tableId);
  const re = new RegExp(`(?<![\\w.])${escapeRegex(t)}(?![\\w])`, 'i');
  return re.test(bare);
}

function pruneGroupMembers(block: string, tableId: string): string {
  return block
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (!t || /^(TableGroup|LayerGroup)\b/i.test(t) || t === '}') return true;
      return !tableTokenInText(t, tableId);
    })
    .join('\n');
}

function pruneLineageBlock(block: string, tableId: string): string | null {
  if (!/Lineage\s*\{/i.test(block)) return block;
  const bodyLines: string[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || /^Lineage\s*\{/i.test(trimmed) || trimmed === '}') {
      continue;
    }
    const m = /^([^\s<]+)\s*<\s*(.+)$/.exec(trimmed);
    if (!m) continue;
    const target = m[1].trim();
    if (tableMatches(target, tableId)) continue;
    const sources = m[2].split(',').map((s) => s.trim()).filter((s) => !tableMatches(s, tableId));
    if (!sources.length) continue;
    const indent = line.match(/^(\s*)/)?.[1] ?? '  ';
    bodyLines.push(`${indent}${target} < ${sources.join(', ')}`);
  }
  if (!bodyLines.length) return null;
  return `Lineage {\n${bodyLines.join('\n')}\n}\n`;
}

function pruneLineageFieldsBlock(block: string, tableId: string): string | null {
  if (!/LineageFields\s*\{/i.test(block)) return block;
  const bodyLines: string[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || /^LineageFields\s*\{/i.test(trimmed) || trimmed === '}') {
      continue;
    }
    const m = /^([^\s<]+)\s*<\s*([^\s\[]+)(?:\s*\[([^\]]*)\])?\s*$/.exec(trimmed);
    if (!m) continue;
    const target = splitTableColumn(m[1].trim());
    const source = splitTableColumn(m[2].trim());
    if (!target || !source) continue;
    if (tableMatches(target.table, tableId) || tableMatches(source.table, tableId)) continue;
    bodyLines.push(line);
  }
  if (!bodyLines.length) return null;
  return `LineageFields {\n${bodyLines.join('\n')}\n}\n`;
}

function clearInlineRefsToTable(src: string, tableId: string): string {
  return splitDbmlBlocks(src)
    .map((b) => {
      if (b.type !== 'table' || tableMatches(b.name, tableId)) return b.text;
      return b.text
        .split('\n')
        .map((line) => {
          if (!isFieldLine(line)) return line;
          const f = parseFieldLine(line);
          if (!f) return line;
          const settings = getColumnSettings(src, b.name!, f.name);
          if (!settings.refTarget || !tableTokenInText(settings.refTarget, tableId)) return line;
          return `${f.indent}${f.name} ${applySettings(f.rest, { ...settings, refTarget: null })}`;
        })
        .join('\n');
    })
    .join('\n');
}

/** Remove tabela e todas as referências cruzadas (refs, lineage, grupos, records). */
export function removeTable(src: string, tableId: string): string {
  const id = stripQuotes(tableId);
  let out = splitDbmlBlocks(src)
    .filter((b) => {
      if (b.type === 'table' && tableMatches(b.name, id)) return false;
      if (b.type === 'records' && tableMatches(b.name, id)) return false;
      if (b.type === 'ref' && tableTokenInText(b.text, id)) return false;
      return true;
    })
    .map((b) => {
      if (b.type === 'tableGroup' || b.type === 'layerGroup') {
        return pruneGroupMembers(b.text, id);
      }
      if (b.type === 'lineage') {
        const pruned = pruneLineageBlock(b.text, id);
        return pruned ?? '';
      }
      if (b.type === 'lineageFields') {
        const pruned = pruneLineageFieldsBlock(b.text, id);
        return pruned ?? '';
      }
      return b.text;
    })
    .filter(Boolean)
    .join('\n');

  out = clearInlineRefsToTable(out, id);
  return out.replace(/\n{3,}/g, '\n\n').trim() + (out.trim() ? '\n' : '');
}

/** Acrescenta `Ref: from.col > to.col`. Evita duplicata e self-loop na mesma coluna. */
export function appendRef(
  src: string,
  fromTbl: string,
  fromCol: string,
  toTbl: string,
  toCol: string,
  kind: '>' | '<' | '-' | '<>' = '>',
): string {
  if (fromTbl === toTbl && fromCol === toCol) return src;
  if (refExists(src, fromTbl, fromCol, toTbl, toCol)) return src;
  const line = `Ref: ${dbmlIdent(fromTbl)}.${fromCol} ${kind} ${dbmlIdent(toTbl)}.${toCol}`;
  const sep = src.endsWith('\n') ? '' : '\n';
  return `${src}${sep}${line}\n`;
}

// ---- Rolenames (mapeamento rolename child→parent) ----

export function addRolename(
  src: string,
  child: { table: string; column: string },
  parent: { table: string; column: string },
): string {
  const line = `  ${child.table}.${child.column} < ${parent.table}.${parent.column}`;
  const blocks = splitDbmlBlocks(src);
  const block = blocks.find((b) => b.type === 'rolenames');
  const needle = `${child.table}.${child.column} <`;
  if (block) {
    if (block.text.includes(needle)) return src;
    const close = block.text.lastIndexOf('}');
    if (close >= 0) {
      const newText = block.text.slice(0, close) + `${line}\n` + block.text.slice(close);
      return src.replace(block.text, newText);
    }
  }
  return `${src.replace(/\n+$/, '')}\n\nRolenames {\n${line}\n}\n`.replace(/^\n+/, '');
}

export function removeRolename(src: string, child: { table: string; column: string }): string {
  const blocks = splitDbmlBlocks(src);
  const block = blocks.find((b) => b.type === 'rolenames');
  if (!block) return src;
  const prefix = `${child.table}.${child.column} <`;
  const updated = block.text.split('\n').filter((l) => !l.trim().startsWith(prefix)).join('\n');
  if (!/\S/.test(updated.replace(/Rolenames\s*\{/i, '').replace('}', ''))) {
    return src.replace(block.text, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  return src.replace(block.text, updated);
}

/** Grava a cor de uma tabela no bloco `Colors {}` (ou remove com color=null). */
/** Grava/remove uma entrada `key: color` no bloco Colors {}. key = id de tabela ou `@grupo`. */
function setColorEntry(src: string, key: string, color: string | null): string {
  const blocks = splitDbmlBlocks(src);
  const block = blocks.find((b) => b.type === 'colors');
  const line = `  ${key}: ${color}`;
  const matches = (l: string) => stripQuotes(l.trim().split(':')[0] ?? '') === stripQuotes(key);
  if (block) {
    const kept = block.text.split('\n').filter((l) => {
      const t = l.trim();
      if (!t || /^Colors\s*\{/i.test(t) || t === '}') return true;
      return !matches(l);
    });
    let updated = kept.join('\n');
    if (color) {
      const close = updated.lastIndexOf('}');
      updated = updated.slice(0, close) + `${line}\n` + updated.slice(close);
    }
    if (!/\S/.test(updated.replace(/Colors\s*\{/i, '').replace('}', ''))) {
      return src.replace(block.text, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }
    return src.replace(block.text, updated);
  }
  if (!color) return src;
  return `${src.replace(/\n+$/, '')}\n\nColors {\n${line}\n}\n`.replace(/^\n+/, '');
}

/** Cor de uma tabela no bloco Colors {}. */
export function setTableColor(src: string, tableId: string, color: string | null): string {
  return setColorEntry(src, tableId, color);
}

/** Cor de um TableGroup no bloco Colors {} (chave prefixada com `@`). */
export function setGroupColor(src: string, group: string, color: string | null): string {
  return setColorEntry(src, `@${group}`, color);
}

/** Cor do nome de uma coluna no bloco Colors {} (chave `tabela.coluna`, 3 partes). */
export function setColumnColor(
  src: string,
  table: string,
  column: string,
  color: string | null,
): string {
  return setColorEntry(src, `${table}.${column}`, color);
}
