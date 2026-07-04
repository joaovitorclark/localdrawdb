# v15 — Plano de execução

Lote de melhorias de UX/canvas + 1 bug (Windows). Cada item tem sua spec detalhada
neste mesmo diretório. Ordem sugerida por risco/dependência.

## Itens

| # | Spec | Tipo | Dificuldade | Depende de |
|---|------|------|-------------|-----------|
| 05 | [Bug Windows: rename não propaga todas as refs](v15-05-windows-rename-refs-bug.md) | 🐛 bug | Média (investigação) | — |
| 06 | [Fundo preto em resolução pequena → cor do canvas](v15-06-small-resolution-canvas-bg.md) | 🎨 visual | Baixa | — |
| 03 | [Painel de Problemas flutuante no canto superior](v15-03-problems-panel-floating.md) | 🧩 UI | Baixa | — |
| 04 | [Dropdown de logs (últimos 100)](v15-04-status-logs-dropdown.md) | 🧩 UI | Média | — |
| 01 | [Resize diagonal/vertical da tabela (estilo macOS)](v15-01-table-diagonal-resize.md) | 🖱️ canvas | Média | 02 |
| 02 | [Scrollbar interno por seleção](v15-02-table-scrollbar-selection.md) | 🖱️ canvas | Média | — |

## Ordem recomendada
1. **05** (bug de perda de refs — impacto de dados; investigar primeiro).
2. **06** (visual rápido, isolado).
3. **03** + **04** (painéis do topo — independentes).
4. **02** depois **01** (resize por altura precisa do scroll interno resolvido).

## Convenções
- Gate por item: `npm run typecheck` (tsc) **e** `npm test -- --run`. Build (`npm run build`)
  não type-checa.
- Verificação de UI: headless com Chrome do sistema (ver `memory/headless-verify-system-chrome`).
- Cor persistida: bloco `Colors {}` (tabela=2 partes, `@grupo`, coluna=3 partes) — já existe.
- Tamanho da tabela: `canvas.json` → `sizes` (hoje `Record<string, number>` = largura).

## Critério de conclusão do lote
Todos os 6 itens com specs implementadas, gate verde, verificação headless dos pontos
de UI e uma verificação manual do bug 05 em ambiente Windows (ou repro sintético com CRLF).
