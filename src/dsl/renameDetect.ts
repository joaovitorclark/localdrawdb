import { splitDbmlBlocks } from './blocks';
import { isCompleteTableId } from './edit';

const stripQuotes = (s: string) => s.replace(/["`]/g, '').trim();

const isFieldLine = (line: string) => {
  const t = line.trim();
  if (!t || t.startsWith('//')) return false;
  if (/^Table\b/i.test(t) || t.startsWith('}') || t === '{') return false;
  if (/^(Note|indexes)\b/i.test(t)) return false;
  return /^("?[A-Za-z_][\w]*"?|"[^"]+")\s+\S/.test(t);
};

function parseFieldLine(line: string): { name: string; sig: string } | null {
  const m = /^(\s*)("?[A-Za-z_][\w]*"?|"[^"]+")\s+(.*)$/.exec(line);
  if (!m) return null;
  return { name: stripQuotes(m[2]), sig: m[3].trim() };
}

function tableFields(blockText: string): { name: string; sig: string }[] {
  return blockText
    .split('\n')
    .filter(isFieldLine)
    .map(parseFieldLine)
    .filter((x): x is { name: string; sig: string } => !!x);
}

function tableIdFromBlock(name: string | undefined): string {
  return stripQuotes(name ?? '');
}

function columnOverlap(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const setB = new Set(b);
  const match = a.filter((c) => setB.has(c)).length;
  return match / Math.max(a.length, b.length);
}

export type TableRename = { kind: 'table'; oldId: string; newId: string };
export type ColumnRename = { kind: 'column'; table: string; oldCol: string; newCol: string };
export type DetectedRename = TableRename | ColumnRename;

/**
 * Detecta renomeações estruturais entre dois snapshots do DBML (edição livre no editor).
 *
 * Casa entidades por IDENTIDADE (nome), NUNCA por posição (linha/índice). Colar, inserir
 * ou apagar linhas desloca posições e NÃO deve ser lido como renome — só é renome quando
 * exatamente uma entidade some e uma aparece, com o resto estável. Nomes duplicados
 * transitórios (copiar tabela/coluna) são ambíguos e suprimem a detecção.
 */
export function detectRenames(prevDbml: string, nextDbml: string): DetectedRename[] {
  if (prevDbml === nextDbml) return [];

  const prevTables = splitDbmlBlocks(prevDbml).filter((b) => b.type === 'table');
  const nextTables = splitDbmlBlocks(nextDbml).filter((b) => b.type === 'table');
  const renames: DetectedRename[] = [];

  type Block = (typeof prevTables)[number];
  // Indexa blocos por id de tabela; marca ids duplicados (ambíguos — não adivinhar).
  const index = (blocks: Block[]) => {
    const byId = new Map<string, Block>();
    const dup = new Set<string>();
    for (const b of blocks) {
      const id = tableIdFromBlock(b.name);
      if (!id) continue;
      if (byId.has(id)) dup.add(id);
      else byId.set(id, b);
    }
    return { byId, dup };
  };
  const prev = index(prevTables);
  const next = index(nextTables);

  // --- Renome de tabela: exatamente 1 id completo some + 1 aparece, com colunas semelhantes. ---
  const removedIds = [...prev.byId.keys()].filter((id) => !next.byId.has(id) && isCompleteTableId(id));
  const addedIds = [...next.byId.keys()].filter((id) => !prev.byId.has(id) && isCompleteTableId(id));
  if (removedIds.length === 1 && addedIds.length === 1) {
    const oldId = removedIds[0];
    const newId = addedIds[0];
    // Não renomeia se algum lado for ambíguo (nome duplicado) ou criaria colisão de nome.
    if (!prev.dup.has(oldId) && !next.dup.has(newId) && !prev.byId.has(newId)) {
      const prevNames = tableFields(prev.byId.get(oldId)!.text).map((f) => f.name);
      const nextNames = tableFields(next.byId.get(newId)!.text).map((f) => f.name);
      if (columnOverlap(prevNames, nextNames) >= 0.8) {
        renames.push({ kind: 'table', oldId, newId });
      }
    }
  }

  // --- Renome de coluna: só em tabelas presentes (por id) nos DOIS snapshots, não ambíguas. ---
  for (const [id, pb] of prev.byId) {
    const nb = next.byId.get(id);
    if (!nb) continue;
    if (prev.dup.has(id) || next.dup.has(id)) continue; // id ambíguo → não adivinha
    const prevFields = tableFields(pb.text);
    const nextFields = tableFields(nb.text);
    const prevNames = prevFields.map((f) => f.name);
    const nextNames = nextFields.map((f) => f.name);
    const prevSet = new Set(prevNames);
    const nextSet = new Set(nextNames);
    const removedCols = prevNames.filter((n) => !nextSet.has(n));
    const addedCols = nextNames.filter((n) => !prevSet.has(n));
    // Renome só quando exatamente 1 coluna sai e 1 entra (resto estável) e a assinatura bate.
    if (removedCols.length === 1 && addedCols.length === 1) {
      const oldCol = removedCols[0];
      const newCol = addedCols[0];
      const pf = prevFields.find((f) => f.name === oldCol);
      const nf = nextFields.find((f) => f.name === newCol);
      if (pf && nf && pf.sig === nf.sig) {
        renames.push({ kind: 'column', table: id, oldCol, newCol });
      }
    }
  }

  return renames;
}
