// Parser puro das flags/slugs do launcher multimodo. Sem efeitos colaterais.
//
// SEM argumentos → `board` (controlboard: tela de escolha, aloca porta só quando você
// clica). `--all` sobe todos de uma vez (comportamento eager de antes); `--shared` força
// a instância única compartilhada. Slugs POSICIONAIS (estilo `uv run`): `lakehouse`,
// `vendas rh`, `vendas,rh`. Flags: --all, --shared, --preview, --list, e os aliases
// --project/--projects.
export function parseDevArgs(argv) {
  let explicit = null; // 'all' | 'shared' setado explicitamente por flag
  const slugs = [];
  let preview = false;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') {
      list = true;
    } else if (a === '--all' || a === '--shared') {
      if (slugs.length) throw new Error(`Use ${a} OU slugs, não ambos.`);
      explicit = a === '--all' ? 'all' : 'shared';
    } else if (a === '--project' || a === '--projects') {
      if (explicit) throw new Error('Use --all/--shared OU slugs, não ambos.');
      const val = argv[++i];
      if (!val || val.startsWith('--')) throw new Error(`${a} exige um slug (ex.: ${a} vendas).`);
      for (const s of val.split(',').map((x) => x.trim()).filter(Boolean)) slugs.push(s);
    } else if (a === '--preview') {
      preview = true;
    } else if (a.startsWith('--')) {
      throw new Error(`Flag desconhecida: ${a}`);
    } else {
      // Argumento posicional → slug(s) (aceita lista por vírgula).
      if (explicit) throw new Error('Use --all/--shared OU slugs, não ambos.');
      for (const s of a.split(',').map((x) => x.trim()).filter(Boolean)) slugs.push(s);
    }
  }
  if (list) return { mode: 'list', slugs: null, preview: false };
  if (slugs.length) return { mode: 'project', slugs, preview };
  // Sem slugs: default = controlboard (a escolha fica na UI). --all/--shared
  // continuam como atalhos explícitos pro comportamento eager de sempre.
  if (explicit === 'shared') return { mode: 'shared', slugs: null, preview };
  if (explicit === 'all') return { mode: 'all', slugs: null, preview };
  return { mode: 'board', slugs: null, preview };
}

/**
 * Resolve os alvos contra o registry. `shared`/`list` → null; `all` → todos;
 * `project` → cada termo casado por slug EXATO ou, na falta, por SUBSTRING única
 * (ambíguo ou inexistente → erro com a lista de candidatos/disponíveis).
 */
export function resolveSlugs(parsed, registry) {
  const available = registry.projects.map((p) => p.slug);
  if (parsed.mode === 'shared' || parsed.mode === 'list' || parsed.mode === 'board') return null;
  if (parsed.mode === 'all') {
    if (available.length === 0) throw new Error('Nenhum projeto no registry.');
    return available;
  }
  const resolved = [];
  for (const term of parsed.slugs) {
    if (available.includes(term)) {
      resolved.push(term);
      continue;
    }
    const matches = available.filter((s) => s.includes(term));
    if (matches.length === 1) {
      resolved.push(matches[0]);
    } else if (matches.length === 0) {
      throw new Error(
        `Slug(s) inexistente(s): ${term}. Disponíveis: ${available.join(', ') || '(nenhum)'}`,
      );
    } else {
      throw new Error(`"${term}" é ambíguo: ${matches.join(', ')}. Seja mais específico.`);
    }
  }
  // Dedup: dois termos podem casar o mesmo projeto (ex.: slug exato + uma substring dele).
  return [...new Set(resolved)];
}
