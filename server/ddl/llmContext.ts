// Gerador de contexto para LLM (Markdown estruturado + bloco JSON no
// mesmo arquivo). O output é texto puro: o usuário cola em qualquer chat
// de LLM (Claude, GPT, Gemini) e o modelo consegue raciocinar sobre o
// modelo físico e lógico a partir das seções Markdown e do JSON.
//
// Estrutura:
//   1. Cabeçalho com metadados do projeto.
//   2. Visão geral (contadores).
//   3. Glossário de layers/cores.
//   4. Tabelas com note, tags, materialização e tabela de colunas.
//   5. Relacionamentos.
//   6. Bloco JSON final com tudo estruturado.

import type { Model, Table, Column } from '../model.ts';

function fmtType(c: Column): string {
  return c.args ? `${c.type}(${c.args})` : c.type;
}

function fmtCol(c: Column): string {
  const flags: string[] = [];
  if (c.pk) flags.push('PK');
  if (c.nullable === false) flags.push('NN');
  if (c.unique) flags.push('unique');
  return `\`${c.name}\` (${fmtType(c)})${flags.length ? ' [' + flags.join(', ') + ']' : ''}`;
}

function fmtConstraints(c: Column): string {
  if (!c.tests?.length) return '—';
  return c.tests
    .map((t) => {
      if (t.kind === 'accepted_values' && t.values) return `accepted_values [${t.values.join(', ')}]`;
      if (t.kind === 'unique') return 'unique';
      if (t.kind === 'not_null') return 'not_null';
      if (t.kind === 'relationships') return `relationships → ${t.to}.${t.field}`;
      return t.kind;
    })
    .join('; ');
}

function tableMd(t: Table): string {
  const head = t.schema ? `${t.schema}.${t.name}` : t.name;
  const lines: string[] = [];
  lines.push(`### ${head}`);
  if (t.note) lines.push(`- **Descrição**: ${t.note}`);
  if (t.group) lines.push(`- **TableGroup**: ${t.group}`);
  if (t.layer) lines.push(`- **Camada**: ${t.layer}`);
  if (t.resourceType) lines.push(`- **Recurso dbt**: ${t.resourceType}`);
  if (t.materialization) lines.push(`- **Materialização**: ${t.materialization}`);
  if (t.tags?.length) lines.push(`- **Tags**: ${t.tags.map((x) => '`' + x + '`').join(', ')}`);
  if (t.compositePks?.length) {
    lines.push(`- **PKs compostas**: ${t.compositePks.map((g) => `[${g.join(', ')}]`).join('; ')}`);
  }
  if (t.columns.length) {
    lines.push('');
    lines.push('| coluna | tipo | constraints | descrição |');
    lines.push('|---|---|---|---|');
    for (const c of t.columns) {
      lines.push(`| ${fmtCol(c)} | ${fmtType(c)} | ${fmtConstraints(c)} | ${c.note ?? ''} |`);
    }
  }
  return lines.join('\n');
}

export function modelToLlmContext(model: Model): string {
  const out: string[] = [];
  const refCount = model.refs.length;
  const tableCount = model.tables.length;
  const layerNames = Object.keys(model.layerColors ?? {});
  const now = new Date().toISOString().slice(0, 10);

  out.push(`# Contexto de modelo de dados (LocalDrawDB)`);
  out.push('');
  out.push(`> Gerado em ${now}. Tabelas: ${tableCount}. Relacionamentos: ${refCount}.`);
  out.push('');
  out.push('## Visão geral');
  out.push(`- Tabelas: ${tableCount}`);
  out.push(`- Relacionamentos (FK): ${refCount}`);
  out.push(`- Camadas: ${layerNames.length || 0}`);
  if (model.warnings?.length) {
    out.push('');
    out.push('### Avisos');
    for (const w of model.warnings) out.push(`- ${w}`);
  }
  out.push('');

  if (layerNames.length) {
    out.push('## Camadas (layers)');
    out.push('');
    out.push('| camada | cor |');
    out.push('|---|---|');
    for (const name of layerNames) {
      out.push(`| ${name} | ${model.layerColors?.[name] ?? '—'} |`);
    }
    out.push('');
  }

  out.push('## Tabelas');
  out.push('');
  for (const t of model.tables) {
    out.push(tableMd(t));
    out.push('');
  }

  if (model.refs.length) {
    out.push('## Relacionamentos');
    out.push('');
    for (const r of model.refs) {
      const arrow = r.kind === '>' ? '>' : r.kind === '<' ? '<' : r.kind === '-' ? '—' : '<>';
      out.push(`- ${r.from.table}.${r.from.column} ${arrow} ${r.to.table}.${r.to.column}`);
    }
    out.push('');
  }

  out.push('## JSON estruturado');
  out.push('');
  out.push('Abaixo, o mesmo conteúdo em JSON — útil para parsing automático pelo agente.');
  out.push('');
  out.push('```json');
  // serialização segura (remove refs circulares e campos undefined).
  const safe = JSON.stringify(model, (_k, v) => v === undefined ? undefined : v, 2);
  out.push(safe);
  out.push('```');

  return out.join('\n');
}