# v18-07 — Overlay de atalhos `?` + descoberta de gestos

## Objetivo

Os recursos mais poderosos do canvas são invisíveis: arrastar coluna→coluna cria FK,
clicar coluna abre o painel de campo, ⓘ abre metadados, hover destaca relações,
Delete remove ref. Nada na UI ensina isso. Dar um ponto único de descoberta.

Depende de **v18-06** (o overlay lista os comandos do registry, sem duplicar strings).

## Comportamento esperado

1. **Overlay `?`**: tecla `?` (Shift+/) fora de inputs abre um modal com duas colunas:
   - **Atalhos**: gerados do `CommandRegistry` (v18-06) + atalhos fixos (Cmd+S,
     Cmd+Z/Cmd+Shift+Z, Cmd+K, Delete, Escape).
   - **Gestos do canvas**: lista curada e estática — hover destaca FKs; arrastar
     coluna→coluna cria `Ref:`; clicar coluna abre painel do campo; ⓘ abre metadados;
     Cmd+clique/arrasto seleciona múltiplas; portas nas bordas no modo linhagem.
2. Botão "?" discreto no canto inferior direito do canvas abre o mesmo overlay.
3. `Escape`/clique-fora fecham. Sem tour guiado, sem tooltips de primeira visita
   (YAGNI — medir se o overlay basta antes de investir em onboarding).

## Arquivos

- `src/help/ShortcutsOverlay.tsx` (novo) — modal com as duas colunas.
- `src/help/gestures.ts` (novo) — lista curada (dados, não JSX, para testar).
- `src/App.tsx` — tecla `?`, botão flutuante.
- `src/styles.css` — estilos do overlay.

## Critérios de aceite

- AC1: `?` abre o overlay; `Escape` e clique-fora fecham; `?` dentro do editor DBML
  **não** abre (digitação normal).
- AC2: todo comando do registry com atalho aparece no overlay (derivado, não
  hardcoded).
- AC3: overlay legível em 1280×720 (scroll interno se precisar; nunca corta conteúdo).

## Testes (TDD)

- Unit: função que deriva a lista de atalhos do registry (inclui só os com atalho,
  formata `⌘K`/`Ctrl+K` por plataforma).
- Headless `scripts/verify-help.mjs`: `?` abre, `Escape` fecha, `?` no editor não abre.
