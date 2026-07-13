export type CommandKind = 'table' | 'column' | 'action';

export type Command = {
  id: string;
  label: string;
  kind: CommandKind;
  shortcut?: string;
  keywords?: string[];
  /** Apenas para kind === 'column'. */
  tableId?: string;
  /** Apenas para kind === 'column'. */
  columnName?: string;
  run: () => void | Promise<void>;
};

export type CommandAction = Omit<Command, 'kind'>;

export type CommandTable = {
  id: string;
  name?: string;
  schema?: string;
};

export type CommandColumn = {
  tableId: string;
  columnName: string;
};

type BuildCommandsInput = {
  tables: CommandTable[];
  columns?: CommandColumn[];
  actions: CommandAction[];
  onFocusTable: (tableId: string) => void;
  onFocusColumn?: (tableId: string, columnName: string) => void;
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

  if (command.kind === 'column') {
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

const KIND_RANK: Record<CommandKind, number> = { table: 0, column: 1, action: 2 };

export function buildCommands({ tables, columns, actions, onFocusTable, onFocusColumn }: BuildCommandsInput): Command[] {
  const tableCommands: Command[] = [...tables]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((table) => ({
      id: `table:${table.id}`,
      label: table.id,
      kind: 'table',
      keywords: [table.name ?? '', table.schema ?? ''].filter(Boolean),
      run: () => onFocusTable(table.id),
    }));

  const columnCommands: Command[] = (columns ?? [])
    .slice()
    .sort((a, b) =>
      a.tableId.localeCompare(b.tableId) || a.columnName.localeCompare(b.columnName),
    )
    .map((c) => ({
      id: `column:${c.tableId}.${c.columnName}`,
      label: `${c.tableId}.${c.columnName}`,
      kind: 'column' as const,
      run: () => onFocusColumn?.(c.tableId, c.columnName),
    }));

  const actionCommands: Command[] = actions.map((action) => ({
    ...action,
    kind: 'action',
  }));

  return [...tableCommands, ...columnCommands, ...actionCommands];
}

export function filterCommands(commands: Command[], query: string, limit = 12): Command[] {
  if (limit <= 0) return [];
  const normalized = normalizeText(query).trim();
  if (!normalized) {
    return commands
      .filter((c) => c.kind !== 'column')
      .slice(0, limit);
  }

  const tokens = normalized.split(/\s+/).map((token) => compactText(token)).filter(Boolean);
  if (!tokens.length) {
    return commands
      .filter((c) => c.kind !== 'column')
      .slice(0, limit);
  }
  const matched = commands
    .map((command, index) => {
      const result = commandMatches(command, tokens);
      return { command, index, ...result };
    })
    .filter((entry) => entry.matched);

  matched.sort((a, b) => {
    const r = KIND_RANK[a.command.kind] - KIND_RANK[b.command.kind];
    if (r) return r;
    if (a.score !== b.score) return a.score - b.score;
    return a.index - b.index;
  });

  return matched.slice(0, limit).map((entry) => entry.command);
}
