import { describe, expect, it } from 'vitest';
import { detectRenames, type DetectedRename } from '../renameDetect';
import { renameColumnAllRefs, renameTable } from '../edit';

/**
 * REPRO: data-corruption on editor commit (blur / Ctrl+S).
 *
 * `detectRenames` matches tables POSITIONALLY by `block.lineStart` and columns
 * POSITIONALLY by field index. Any paste/insert/delete that shifts positions makes
 * it compare UNRELATED entities. Because the mock tables share column signatures
 * (natural_id, description, category, status, valid_from, valid_to, is_current),
 * the `columnOverlap >= 0.8` (table) and `pf.sig === nf.sig` (column) checks fire and
 * emit FALSE renames, which the commit path then propagates -> corruption.
 *
 * These tests assert the CORRECT behavior (pastes/inserts are additions, not renames).
 * Regression guard: detectRenames now matches by identity (name), not by position.
 */

// Mimics App.tsx `applyRenames`: table -> renameTable, column -> renameColumnAllRefs.
// (Real code uses propagateKeyRename for key columns; renameColumnAllRefs is enough to show corruption.)
function applyDetected(buffer: string, renames: DetectedRename[]): string {
  let out = buffer;
  for (const r of renames) {
    if (r.kind === 'table') out = renameTable(out, r.oldId, r.newId);
    else out = renameColumnAllRefs(out, r.table, r.oldCol, r.newCol);
  }
  return out;
}

const countOccurrences = (s: string, sub: string) => s.split(sub).length - 1;

describe('reconcile corruption on commit', () => {
  it('(a) paste a duplicate column line -> must NOT emit renames', () => {
    const prev = `Table gold.dim_warehouse {
  natural_id bigint [pk]
  description string
  category string
  status string
  valid_from date
  valid_to date
  is_current boolean
}
`;
    // user copies `description string` and pastes it right below
    const next = `Table gold.dim_warehouse {
  natural_id bigint [pk]
  description string
  description string
  category string
  status string
  valid_from date
  valid_to date
  is_current boolean
}
`;
    const detected = detectRenames(prev, next);
    // CORRECT: pasting a duplicate line is not a rename.
    expect(detected).toEqual([]);

    // Demonstrate the resulting corruption if the (wrong) renames are applied:
    const applied = applyDetected(next, detected);
    expect(countOccurrences(applied, 'description string')).toBe(2); // the 2 pasted lines, nothing else
    expect(applied).toContain('status string');
    expect(applied).toContain('valid_to date');
  });

  it('(b) paste a whole (equal-height) table block -> must NOT rename other tables', () => {
    const prev = `Table gold.dim_warehouse {
  natural_id bigint [pk]
  description string
}
Table gold.dim_store {
  natural_id bigint [pk]
  description string
}
Table gold.dim_customer {
  natural_id bigint [pk]
  description string
}
`;
    // user copies the whole dim_warehouse block and pastes it right after
    const next = `Table gold.dim_warehouse {
  natural_id bigint [pk]
  description string
}
Table gold.dim_warehouse {
  natural_id bigint [pk]
  description string
}
Table gold.dim_store {
  natural_id bigint [pk]
  description string
}
Table gold.dim_customer {
  natural_id bigint [pk]
  description string
}
`;
    const detected = detectRenames(prev, next);
    // CORRECT: no existing table was renamed.
    expect(detected.filter((d) => d.kind === 'table')).toEqual([]);

    const applied = applyDetected(next, detected);
    // dim_store / dim_customer must still exist (not renamed away).
    expect(applied).toContain('Table gold.dim_store');
    expect(applied).toContain('Table gold.dim_customer');
  });

  it('(c) insert a blank line before a table -> must NOT emit renames', () => {
    const prev = `Table gold.dim_a {
  natural_id bigint [pk]
  description string
}
Table gold.dim_b {
  category string
  status string
}
`;
    const next = `Table gold.dim_a {
  natural_id bigint [pk]

  description string
}
Table gold.dim_b {
  category string
  status string
}
`;
    expect(detectRenames(prev, next)).toEqual([]);
  });

  it('(d) delete a column line -> must NOT emit renames', () => {
    const prev = `Table gold.dim_a {
  natural_id bigint [pk]
  description string
  category string
  status string
}
`;
    const next = `Table gold.dim_a {
  natural_id bigint [pk]
  category string
  status string
}
`;
    const detected = detectRenames(prev, next);
    // CORRECT: deleting a column is not a rename of the following columns.
    expect(detected).toEqual([]);

    const applied = applyDetected(next, detected);
    expect(applied).toContain('category string');
    expect(applied).toContain('status string');
    expect(countOccurrences(applied, 'status string')).toBe(1);
  });

  it('(e) copy a table then rename the copy header -> must NOT rename OTHER tables', () => {
    const prev = `Table gold.dim_warehouse {
  natural_id bigint [pk]
  description string
}
Table gold.dim_customer {
  natural_id bigint [pk]
  description string
}
`;
    // paste a copy of dim_warehouse and rename the copy's header to dim_warehouse2
    const next = `Table gold.dim_warehouse {
  natural_id bigint [pk]
  description string
}
Table gold.dim_warehouse2 {
  natural_id bigint [pk]
  description string
}
Table gold.dim_customer {
  natural_id bigint [pk]
  description string
}
`;
    const detected = detectRenames(prev, next);
    // CORRECT: dim_customer was NOT renamed; dim_warehouse2 is a new table.
    expect(detected).toEqual([]);

    const applied = applyDetected(next, detected);
    expect(applied).toContain('Table gold.dim_customer');
    // no duplicate table name should be introduced by reconcile
    expect(countOccurrences(applied, 'Table gold.dim_warehouse2')).toBe(1);
  });

  it('(f) add a brand-new (look-alike) table at the top -> must NOT rename existing table', () => {
    const prev = `Table gold.dim_a {
  natural_id bigint [pk]
  description string
}
`;
    const next = `Table gold.dim_new {
  natural_id bigint [pk]
  description string
}
Table gold.dim_a {
  natural_id bigint [pk]
  description string
}
`;
    const detected = detectRenames(prev, next);
    // CORRECT: dim_a still exists; dim_new is an addition.
    expect(detected).toEqual([]);

    const applied = applyDetected(next, detected);
    expect(applied).toContain('Table gold.dim_a');
    expect(countOccurrences(applied, 'Table gold.dim_new')).toBe(1);
  });
});
