import type { Command } from '../palette/registry';

export type Gesture = { gesture: string; effect: string };

export type ShortcutRow = { keys: string; label: string };

export type ShortcutSpec = { mod?: boolean; shift?: boolean; key: string };

export const CANVAS_GESTURES: Gesture[] = [
  { gesture: 'Hover em coluna ou ref', effect: 'Destaca relações FK conectadas' },
  { gesture: 'Arrastar coluna → coluna', effect: 'Cria bloco Ref: no DBML' },
  { gesture: 'Clicar em coluna', effect: 'Abre o painel do campo' },
  { gesture: 'Clicar em ⓘ na tabela', effect: 'Abre metadados da tabela' },
  { gesture: 'Cmd/Ctrl + clique ou arrasto', effect: 'Seleciona várias tabelas' },
  { gesture: 'Modo linhagem: portas nas bordas', effect: 'Edita entradas de linhagem' },
  { gesture: 'Delete', effect: 'Remove ref selecionada' },
  { gesture: 'Escape', effect: 'Limpa seleção e fecha modais' },
];

export const FIXED_SHORTCUT_SPECS: { label: string; spec: ShortcutSpec }[] = [
  { label: 'Buscar comandos e tabelas', spec: { mod: true, key: 'K' } },
  { label: 'Remover ref selecionada', spec: { key: 'Delete' } },
  { label: 'Limpar seleção / fechar modais', spec: { key: 'Escape' } },
  { label: 'Atalhos e gestos', spec: { key: '?' } },
];

export function formatShortcut(mac: boolean, spec: ShortcutSpec): string {
  const key = spec.key.length === 1 && spec.key !== '?' ? spec.key.toUpperCase() : spec.key;
  if (mac) {
    let result = '';
    if (spec.mod) result += '⌘';
    if (spec.shift) result += '⇧';
    return result + key;
  }
  const parts: string[] = [];
  if (spec.mod) parts.push('Ctrl');
  if (spec.shift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function parseRegistryShortcut(shortcut: string, mac: boolean): string {
  const hasMod = shortcut.startsWith('Cmd/Ctrl');
  const rest = hasMod ? shortcut.slice('Cmd/Ctrl'.length).replace(/^\+/, '') : shortcut;
  const hasShift = rest.startsWith('Shift+') || rest === 'Shift';
  const key = hasShift ? rest.replace(/^Shift\+?/, '') : rest;
  return formatShortcut(mac, { mod: hasMod, shift: hasShift, key });
}

export function shortcutsFromCommands(commands: Command[], mac: boolean): ShortcutRow[] {
  const fromRegistry = commands
    .filter((command): command is Command & { shortcut: string } => Boolean(command.shortcut))
    .map((command) => ({
      keys: parseRegistryShortcut(command.shortcut, mac),
      label: command.label,
    }));

  const fixed = FIXED_SHORTCUT_SPECS.map(({ label, spec }) => ({
    keys: formatShortcut(mac, spec),
    label,
  }));

  return [...fromRegistry, ...fixed];
}
