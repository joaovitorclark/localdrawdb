import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/App.tsx',
  'src/canvas/TableNode.tsx',
  'src/canvas/TableColumnList.tsx',
  'src/ProjectSwitcher.tsx',
  'src/canvas/ColumnMappings.tsx',
  'src/canvas/ProblemsPanel.tsx',
  'src/canvas/StatusLog.tsx',
  'src/canvas/LayersPanel.tsx',
  'src/records/RecordsPanel.tsx',
  'src/canvas/GroupNode.tsx',
  'src/canvas/ColumnPanel.tsx',
  'src/canvas/RelationEdge.tsx',
  'src/canvas/LineageEdge.tsx',
  'src/canvas/ExternalGroupNode.tsx',
  'src/ExportMenu.tsx',
  'src/editor/Outline.tsx',
  'src/domains/DomainPicker.tsx',
  'src/domains/domainPickerHelpers.ts',
];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}]/u;

describe('no-ui-emoji', () => {
  it('sem emoji pictográfico de UI', () => {
    for (const f of FILES) {
      expect(EMOJI.test(readFileSync(f, 'utf8')), f).toBe(false);
    }
  });
});
