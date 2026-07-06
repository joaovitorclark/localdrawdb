# v15-03 — Painel de Problemas flutuante no canto superior

## Objetivo
Incorporar o **Painel de Problemas** ao canto **superior** (perto de Salvar/Auto-save/status),
como um **elemento solto** (flutuante/badge), em vez do painel arrastável no canto inferior direito.

## Estado atual (código)
- `src/canvas/ProblemsPanel.tsx`, renderizado em `src/App.tsx:1448`:
  `<ProblemsPanel issues={modelIssues} onFocusTable=... onGoToLine=... />`.
- CSS `.problems-panel` (`src/styles.css:1553`): `position: absolute; right:12px; bottom:36px;
  z-index:9; max-width:320px; max-height:200px`. Tem `__grip` (arrastável), `__head`, `__toggle`,
  `__list`, `__row`, itens `--error`/`--warn`.
- `modelIssues` (App): erros de parse + import + validações do modelo.

## Abordagem
1. **Badge no topo:** um indicador compacto no canto superior direito (junto do status), ex.:
   `⚠ 3 problemas` (contagem por severidade). Cor conforme houver erro (vermelho) vs só avisos
   (amarelo) vs 0 (verde/oculto).
2. **Clique abre a lista** (dropdown/popover flutuante ancorado ao badge, via portal para não ser
   coberto — cuidado com z-index, seguir o padrão do `TableInfoPopover`/paleta de grupo).
3. Manter `onFocusTable`/`onGoToLine` (clicar num problema foca a tabela / vai pra linha).
4. Remover a posição inferior-direita arrastável (ou manter o componente e só reposicionar +
   trocar o modo de exibição). Decidir: reescrever como badge+popover é mais limpo.

## Arquivos
`src/canvas/ProblemsPanel.tsx` (badge + popover portado), `src/App.tsx` (posição de render —
mover pra junto do header/topo), `src/styles.css` (`.problems-panel*` → estilo de badge/popover).

## Critérios de aceite
- Badge no canto superior mostrando contagem/severidade; 0 problemas = discreto/oculto.
- Clique abre a lista flutuante (não coberta por nós do canvas).
- Clicar num item foca a tabela / vai à linha (comportamento atual preservado).
- Verificação headless: badge presente, popover abre, item navega.

## Dificuldade
Baixa–média (reposição + popover portado).
