# Spec — Busca por colunas no Command Palette

**Data:** 2026-07-13
**Status:** aprovado (aguardando revisão do usuário)
**Branch alvo:** `feature/command-palette-columns`

## Objetivo

Estender o command palette (Ctrl/Cmd+K) para que o usuário possa buscar
**colunas** pelo nome, ver em quais tabelas elas aparecem e pular direto
para a coluna no canvas — replicando o mesmo fluxo "selecionei → tabela
centralizou → scroll posicionou → linha destacada" do clique direto no
canvas.

Hoje só tabelas e ações são buscáveis. Em modelos com centenas de tabelas,
localizar uma coluna específica ("`customer_id`", "`created_at`") é o gargalo
mais comum; o palette atual força o usuário a lembrar em qual tabela a
coluna vive.

## Escopo

### Dentro

- Novo `CommandKind = 'column'`, gerado a partir de `activeModel.tables[*].fields`.
- Busca tokenizada por nome da coluna (substring, normalizada — sem acentos,
  case-insensitive, separadores `.` `_` `-` `/`).
- Renderização de uma linha por coluna, com nome da tabela esmaecido + nome
  da coluna em destaque, badge `"Coluna"`.
- Atalho de execução: centraliza a tabela (`focusTableWithPan`),
  seleciona a coluna (`useInteraction.setSelectedColumn`); o scroll interno
  + highlight já existem em `TableColumnList` e reagem automaticamente.
- Testes do `registry` cobrindo match, ranking e filtro por query vazia.
- Abertura da branch + smoke test manual no demo_lakehouse.

### Fora (YAGNI)

- Agrupamento visual por tabela (header colapsável).
- Sintaxe de busca tipo `tabela.col` ou `col:id`.
- Filtro por tipo de dado (`int`, `string`, `date`).
- Mostrar tipo da coluna no item da paleta.
- Highlight na lista de tipos no Outline (escopo separado).

## Decisões de design

| Decisão | Escolha | Por quê |
|---|---|---|
| Forma do item | Linha por coluna (mesmo nome em N tabelas = N linhas) | Simplicidade, reuso total do motor de busca, navegação linear por teclado. |
| Comportamento ao selecionar | Mesmo do clique na coluna (centraliza + seleciona) | Não força zoom se já visível; consistência com o canvas. |
| Escopo da busca | Só nome da coluna | Cobre o caso de uso; sintaxe extra é fricção sem demanda comprovada. |
| Posição no ranking | Tabela < Coluna < Ação | Mantém o comportamento atual (tabelas primeiro); ações continuam últimas. |
| Query vazia | Colunas NÃO aparecem | Evita poluir a lista inicial com 200+ entradas inúteis. |
| Atalho | Reusa Cmd/Ctrl+K | Mesma paleta, sem novo atalho. |
| Migração | Nenhuma breaking change | `kind: 'table'` e `kind: 'action'` permanecem idênticos. |

## Arquitetura

### Modelo de dados (`src/palette/registry.ts`)

```ts
export type CommandKind = 'table' | 'column' | 'action';

export type ColumnCommand = {
  id: string;          // 'column:<tableId>.<columnName>'
  label: string;       // 'gold.dim_customer.id'
  kind: 'column';
  tableId: string;
  columnName: string;
  keywords?: string[]; // opcional, nome curto da tabela p/ match ambíguo
  run: () => void | Promise<void>;
};

export type Command = TableCommand | ColumnCommand | ActionCommand;
```

`searchableTexts` para `'column'` devolve `normalize(label)`, `compact(label)` e
as partes separadas por `.`. Assim `cust` casa `gold.dim_customer.id` via
`customer` (parte após split).

Ranking atualizado:

```ts
const KIND_RANK = { table: 0, column: 1, action: 2 } as const;
matched.sort((a, b) => {
  const r = KIND_RANK[a.command.kind] - KIND_RANK[b.command.kind];
  if (r) return r;
  if (a.score !== b.score) return a.score - b.score;
  return a.index - b.index;
});
```

### Construção dos comandos

```ts
export function buildCommands({
  tables, columns, actions, onFocusTable, onFocusColumn,
}: BuildCommandsInput): Command[] {
  const tableCommands: Command[] = [...tables]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((table) => ({ id: `table:${table.id}`, label: table.id, kind: 'table',
      keywords: [table.name ?? '', table.schema ?? ''].filter(Boolean),
      run: () => onFocusTable(table.id) }));

  const columnCommands: Command[] = [...columns]
    .sort((a, b) => a.tableId.localeCompare(b.tableId)
                  || a.columnName.localeCompare(b.columnName))
    .map((c) => ({
      id: `column:${c.tableId}.${c.columnName}`,
      label: `${c.tableId}.${c.columnName}`,
      kind: 'column' as const,
      tableId: c.tableId,
      columnName: c.columnName,
      run: () => onFocusColumn(c.tableId, c.columnName),
    }));

  const actionCommands: Command[] = actions.map((a) => ({ ...a, kind: 'action' as const }));

  return [...tableCommands, ...columnCommands, ...actionCommands];
}
```

### Foco da coluna (`src/App.tsx`)

```ts
const focusColumn = useCallback((tableId: string, columnName: string) => {
  focusTableWithPan(tableId);
  useInteraction.getState().setSelectedColumn({ table: tableId, column: columnName });
}, [focusTableWithPan]);
```

Nenhum scroll manual: `TableColumnList.tsx:181-187` já reage a mudanças em
`selectedColumn` e chama `scrollToColumn` internamente.

### UI (`src/palette/CommandPalette.tsx`)

Label da coluna renderiza nome da tabela esmaecido + nome da coluna em
destaque, separados por `.`:

```tsx
<span className="command-palette__label">
  {command.kind === 'column' ? (
    <>
      <span className="cp-table">{parts[0]}</span>
      <span className="cp-dot">.</span>
      <span className="cp-col">{parts[1]}</span>
    </>
  ) : command.label}
</span>
```

Badge:

```tsx
{command.kind === 'column' ? 'Coluna' : ...}
```

Placeholder do input: `"Buscar tabela, coluna ou ação…"`.

### Estilos (`src/styles.css`)

Adicionar:

```css
.cp-table { color: var(--muted); }
.cp-col  { color: var(--text); font-weight: 500; }
.cp-dot  { color: var(--muted-2); margin: 0 2px; }
```

Cores casadas com o tema atual (azul-marinho + verde Seguros Unimed) via
variáveis já existentes.

## Critérios de aceitação

1. Abrir paleta, digitar `id` → lista todas as colunas `id` do modelo,
   com o nome da tabela esmaecido à esquerda e o nome da coluna em destaque.
2. Enter / clique numa coluna: tabela centraliza no canvas, scroll interno
   do cartão posiciona a coluna em vista, linha fica destacada.
3. Buscar por nome de coluna que existe em várias tabelas (`cust` → `id`,
   `customer_name`, `customer_id` etc. de várias tabelas) lista uma linha
   por ocorrência.
4. Query vazia lista apenas tabelas + ações (sem poluição com 200+ colunas).
5. Tabela continua funcionando idêntica ao comportamento atual.
6. Ações continuam funcionando idênticas ao comportamento atual.
7. `npm test` verde, incluindo 4 testes novos no `registry.test.ts`.
8. `npm run typecheck` verde.
9. Smoke test manual: `npm run dev` → abrir `demo_lakehouse` → Ctrl+K →
   buscar `customer` → pular para uma coluna → confirmar destaque e scroll.

## Testes novos (`src/palette/__tests__/registry.test.ts`)

1. **Match por substring em partes**: `cust` casa `gold.dim_customer.id`
   via split em `.` que produz `customer`.
2. **Match em múltiplas tabelas**: `id` retorna uma entrada por tabela que
   tem coluna `id`.
3. **Query vazia exclui colunas**: com query `""`, `filterCommands` não
   devolve nenhum `kind: 'column'`.
4. **Ranking**: `table < column < action` quando todos casam.
5. **Limite**: com 20 tabelas × 5 colunas = 100 entradas, o limite de 12
   é respeitado e prioriza tabelas > colunas.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Performance com modelos muito grandes (1000+ colunas) | `useMemo` em `paletteCommands`; `filterCommands` é O(n × tokens × parts), aceitável até ~5k colunas. Se virar problema, índice pré-calculado é evolução futura. |
| Scroll interno da coluna não disparar se o nó ainda não montou | `setSelectedColumn` é idempotente; o `useEffect` em `TableColumnList` re-roda em qualquer mudança. Se houver race, evoluir para `requestAnimationFrame` no `focusColumn`. |
| Usuário se confunde com "Coluna" vs "Tabela" no badge | Nome da tabela sempre visível (esmaecido) no label — não depende só do badge. |
| Quebrar testes existentes | Mudança aditiva: `buildCommands` ganha parâmetro opcional `columns`; `CommandKind` só cresce. Callers existentes passam `columns: []`. |

## Plano de implementação (resumo)

1. Abrir branch `feature/command-palette-columns` a partir de `main`.
2. Editar `src/palette/registry.ts`:
   - Estender `CommandKind` para incluir `'column'`.
   - Adicionar `ColumnCommand` e `CommandColumn` no input do `buildCommands`.
   - Atualizar `searchableTexts` para o ramo `'column'`.
   - Atualizar o ranking com `KIND_RANK`.
3. Editar `src/App.tsx`:
   - Passar `columns: tables.flatMap(t => t.fields.map(f => ({tableId, columnName})))` e `onFocusColumn: focusColumn` para `buildCommands`.
   - Criar `focusColumn` (useCallback) que chama `focusTableWithPan` + `setSelectedColumn`.
4. Editar `src/palette/CommandPalette.tsx`:
   - Renderizar label especial para `'column'` (tabela esmaecida + coluna destacada).
   - Renderizar badge `"Coluna"`.
   - Atualizar placeholder do input.
5. Editar `src/styles.css`:
   - Adicionar `.cp-table`, `.cp-col`, `.cp-dot`.
6. Adicionar testes em `src/palette/__tests__/registry.test.ts`.
7. Rodar `npm test` + `npm run typecheck`.
8. Smoke test manual no demo.
9. Commit + push da branch.

## Arquivos tocados

- `src/palette/registry.ts` (estende tipos e builder)
- `src/palette/CommandPalette.tsx` (render do label e do badge)
- `src/styles.css` (~10 linhas de CSS novo)
- `src/App.tsx` (cria `focusColumn` e passa para o builder)
- `src/palette/__tests__/registry.test.ts` (5 testes novos)

Nenhum arquivo novo. Nenhuma dependência nova. Nenhuma migração de dados.