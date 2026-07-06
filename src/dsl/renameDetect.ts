import { splitDbmlBlocks, normalizeEol } from './blocks';
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
  // CRLF-safe: normaliza EOL antes de comparar. Sem isso, comparar `committed` (que pode
  // vir com CRLF do arquivo no Windows) contra `buffer` (LF do CodeMirror) faz o diff
  // linha-a-linha falhar silenciosamente.
  prevDbml = normalizeEol(prevDbml);
  nextDbml = normalizeEol(nextDbml);
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

  // --- Renome de tabela: cada id completo que some é pareado com um que aparece, por
  // semelhança de colunas (>= 0.8). Suporta VÁRIOS renames de uma vez, mas só aceita
  // pares com correspondência ÚNICA em ambos os lados (mútua) — assim, empates/ambiguidade
  // (ex.: colar tabela) não viram rename. ---
  const removedIds = [...prev.byId.keys()].filter((id) => !next.byId.has(id) && isCompleteTableId(id));
  const addedIds = [...next.byId.keys()].filter((id) => !prev.byId.has(id) && isCompleteTableId(id));
  const tableScore = (oldId: string, newId: string): number => {
    const prevNames = tableFields(prev.byId.get(oldId)!.text).map((f) => f.name);
    const nextNames = tableFields(next.byId.get(newId)!.text).map((f) => f.name);
    return columnOverlap(prevNames, nextNames);
  };
  const OVERLAP_MIN = 0.8;
  for (const oldId of removedIds) {
    if (prev.dup.has(oldId)) continue; // origem ambígua
    const matches = addedIds.filter((newId) => tableScore(oldId, newId) >= OVERLAP_MIN);
    if (matches.length !== 1) continue; // 0 ou ambíguo
    const newId = matches[0];
    if (next.dup.has(newId) || prev.byId.has(newId)) continue; // destino ambíguo/colisão
    // correspondência tem que ser única também do lado do destino (monogamia mútua)
    const back = removedIds.filter((rid) => !prev.dup.has(rid) && tableScore(rid, newId) >= OVERLAP_MIN);
    if (back.length !== 1) continue;
    renames.push({ kind: 'table', oldId, newId });
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
    // Pareia colunas removidas↔adicionadas pela ASSINATURA (tipo + atributos). Suporta vários
    // renames por tabela, mas só aceita quando a assinatura identifica UM par de forma única:
    // se duas colunas compartilham a mesma assinatura (ex.: duas `string`), é ambíguo e ignora.
    const sigOf = (fields: { name: string; sig: string }[], name: string) =>
      fields.find((f) => f.name === name)?.sig;
    const removedBySig = new Map<string, string[]>();
    const addedBySig = new Map<string, string[]>();
    for (const c of removedCols) {
      const sig = sigOf(prevFields, c);
      if (sig == null) continue;
      (removedBySig.get(sig) ?? removedBySig.set(sig, []).get(sig)!).push(c);
    }
    for (const c of addedCols) {
      const sig = sigOf(nextFields, c);
      if (sig == null) continue;
      (addedBySig.get(sig) ?? addedBySig.set(sig, []).get(sig)!).push(c);
    }
    for (const [sig, removedForSig] of removedBySig) {
      const addedForSig = addedBySig.get(sig);
      if (removedForSig.length === 1 && addedForSig?.length === 1) {
        renames.push({ kind: 'column', table: id, oldCol: removedForSig[0], newCol: addedForSig[0] });
      }
    }
  }

  return renames;
}
