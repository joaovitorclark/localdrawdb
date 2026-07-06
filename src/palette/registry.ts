export type CommandKind = 'table' | 'action';

export type Command = {
  id: string;
  label: string;
  kind: CommandKind;
  shortcut?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

export type CommandAction = Omit<Command, 'kind'>;

export type CommandTable = {
  id: string;
  name?: string;
  schema?: string;
};

type BuildCommandsInput = {
  tables: CommandTable[];
  actions: CommandAction[];
  onFocusTable: (tableId: string) => void;
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compactText(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function searchableTexts(command: Command): string[] {
  if (command.kind === 'table') {
    return [
      normalizeText(command.label),
      compactText(command.label),
      ...command.label
        .split(/[._\s/-]+/)
        .map((part) => normalizeText(part))
        .filter(Boolean),
    ];
  }

  return [
    normalizeText(command.label),
    compactText(command.label),
    ...(command.keywords ?? []).map((keyword) => normalizeText(keyword)),
    ...(command.keywords ?? []).map((keyword) => compactText(keyword)),
  ];
}

function commandMatches(command: Command, tokens: string[]): { matched: boolean; score: number } {
  const haystack = searchableTexts(command);
  let score = 0;

  for (const token of tokens) {
    let bestIndex = Number.POSITIVE_INFINITY;
    for (const text of haystack) {
      const idx = text.indexOf(token);
      if (idx >= 0 && idx < bestIndex) bestIndex = idx;
    }
    if (!Number.isFinite(bestIndex)) return { matched: false, score: Number.POSITIVE_INFINITY };
    score += bestIndex;
  }

  return { matched: true, score };
}

export function buildCommands({ tables, actions, onFocusTable }: BuildCommandsInput): Command[] {
  const tableCommands: Command[] = [...tables]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((table) => ({
      id: `table:${table.id}`,
      label: table.id,
      kind: 'table',
      keywords: [table.name ?? '', table.schema ?? ''].filter(Boolean),
      run: () => onFocusTable(table.id),
    }));

  const actionCommands: Command[] = actions.map((action) => ({
    ...action,
    kind: 'action',
  }));

  return [...tableCommands, ...actionCommands];
}

export function filterCommands(commands: Command[], query: string, limit = 12): Command[] {
  if (limit <= 0) return [];
  const normalized = normalizeText(query).trim();
  if (!normalized) return commands.slice(0, limit);

  const tokens = normalized.split(/\s+/).map((token) => compactText(token)).filter(Boolean);
  if (!tokens.length) return commands.slice(0, limit);
  const matched = commands
    .map((command, index) => {
      const result = commandMatches(command, tokens);
      return { command, index, ...result };
    })
    .filter((entry) => entry.matched);

  matched.sort((a, b) => {
    if (a.command.kind !== b.command.kind) return a.command.kind === 'table' ? -1 : 1;
    if (a.score !== b.score) return a.score - b.score;
    return a.index - b.index;
  });

  return matched.slice(0, limit).map((entry) => entry.command);
}
