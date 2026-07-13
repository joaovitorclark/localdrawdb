import { describe, expect, it } from 'vitest';
import { useInteraction } from '../../store/interaction';

describe('foco de coluna via palette', () => {
  it('selectColumn preserva a seleção no estado', () => {
    useInteraction.getState().selectColumn(null);
    useInteraction.getState().selectColumn({ table: 'gold.x', column: 'id' });
    expect(useInteraction.getState().selectedColumn).toEqual({
      table: 'gold.x',
      column: 'id',
    });
  });

  it('selectColumn já marca a tabela como selecionada (sem precisar selectTable)', () => {
    useInteraction.getState().selectColumn({ table: 'gold.x', column: 'id' });
    const state = useInteraction.getState();
    expect(state.selectedTable).toBe('gold.x');
    expect(state.selectedTableIds).toEqual(['gold.x']);
  });

  it('ordem inversa (selectColumn após selectTable) deve deixar coluna selecionada', () => {
    useInteraction.getState().selectTable('gold.x');
    expect(useInteraction.getState().selectedColumn).toBeNull();
    useInteraction.getState().selectColumn({ table: 'gold.x', column: 'id' });
    expect(useInteraction.getState().selectedColumn).toEqual({
      table: 'gold.x',
      column: 'id',
    });
  });

  it('selectColumn sozinha (sem selectTable prévio) sobrevive — cenário da paleta', () => {
    useInteraction.getState().selectColumn(null);
    useInteraction.getState().selectColumn({ table: 'silver.fct_finance_wide', column: 'customer_fk' });
    expect(useInteraction.getState().selectedColumn).toEqual({
      table: 'silver.fct_finance_wide',
      column: 'customer_fk',
    });
    expect(useInteraction.getState().selectedTable).toBe('silver.fct_finance_wide');
    expect(useInteraction.getState().selectedTableIds).toEqual(['silver.fct_finance_wide']);
  });
});