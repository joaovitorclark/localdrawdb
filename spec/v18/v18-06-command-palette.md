# v18-06 — Command palette (Cmd/Ctrl+K)

## Objetivo

Num modelo com 67+ tabelas, achar uma tabela ou disparar uma ação exige conhecer o
canto certo da UI (busca escondida no painel Camadas, ações espalhadas na toolbar).
Um palette único (Cmd/Ctrl+K) dá acesso a tudo por teclado.

## Comportamento esperado

1. **Abrir**: `Cmd/Ctrl+K` (e um botão discreto de busca na toolbar). Modal centrado,
   input com foco imediato, lista de resultados abaixo. `Escape` fecha; clique-fora fecha.
2. **Fontes de resultado** (nesta ordem):
   - **Tabelas** (`schema.tabela`, filtro fuzzy simples por substring das partes):
     Enter → centra a tabela no canvas com o mecanismo existente de
     `focusTableId`/`focusTableView` e a seleciona.
   - **Ações**: Salvar, Organizar DBML, Organizar canvas, Exportar <cada formato>,
     Export PNG, Importar (input/), Undo, Redo, alternar Auto-save, alternar Modo
     linhagem, abrir/fechar painéis (Camadas, Dados, Páginas, Problemas).
3. **Navegação**: ↑/↓ move a seleção, Enter executa, mouse também. Máx. 12 resultados
   visíveis com scroll.
4. **Reuso**: as ações delegam aos handlers existentes (`src/canvas/actions.ts`,
   handlers do `App.tsx`) — o palette não reimplementa nada; registro central
   `CommandRegistry` (id, rótulo pt-BR, atalho se houver, `run()`).
5. Sem dependência nova (não adicionar `cmdk` etc.; lista + filtro são triviais e o
   bundle já está no limite — ver v18-09).

## Arquivos

- `src/palette/CommandPalette.tsx` (novo) — modal, input, lista, teclado.
- `src/palette/registry.ts` (novo) — tipo `Command` + montagem da lista a partir de
  handlers passados por props/contexto; fonte de tabelas via modelo parseado atual.
- `src/App.tsx` — atalho global, estado aberto/fechado, injeção dos handlers.
- `src/styles.css` — estilos (mesma família visual dos dropdowns existentes).

## Critérios de aceite

- AC1: `Cmd/Ctrl+K` abre com foco no input; `Escape`/clique-fora fecham.
- AC2: digitar `dim_cust` lista `gold.dim_customer`; Enter centra e seleciona a tabela.
- AC3: "Exportar Oracle DDL" pelo palette produz o mesmo efeito do menu Exportar.
- AC4: palette funciona com o editor DBML focado (atalho global, sem conflitar com o
  CodeMirror — interceptar na captura e `preventDefault`).
- AC5: navegação completa por teclado (abrir → filtrar → escolher → executar) sem mouse.

## Testes (TDD)

- `src/palette/__tests__/registry.test.ts`: filtro (substring nas partes do nome,
  case-insensitive), ordenação (tabelas antes de ações quando o termo casa com ambas),
  limite de resultados.
- Headless `scripts/verify-palette.mjs`: Cmd+K, digita, Enter, asserta tabela
  selecionada/centrada; executa uma ação de export e asserta o arquivo de saída.
