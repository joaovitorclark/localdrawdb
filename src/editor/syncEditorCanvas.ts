export type FocusTableOptions = { pan?: boolean };

export const shouldSyncCursorLine = (line0: number): boolean => line0 >= 0;

/** Decide se o canvas deve recentralizar na tabela (evita pan a cada keystroke). */
export function shouldPanToTable(
  previousTableId: string | null,
  nextTableId: string | null,
  options?: FocusTableOptions,
): boolean {
  if (!nextTableId) return false;
  if (options?.pan) return true;
  return nextTableId !== previousTableId;
}

/** Decide se sync editor→canvas deve atualizar a tabela focada. */
export function shouldSyncEditorTable(
  editingTableId: string | null,
  nextTableId: string | null,
): boolean {
  if (!nextTableId) return false;
  return nextTableId !== editingTableId;
}
