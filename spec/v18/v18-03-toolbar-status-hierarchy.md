# v18-03 — Toolbar: um indicador de estado + hierarquia + idioma

## Objetivo

A toolbar hoje tem dois indicadores de estado simultâneos à direita ("Pronto" e
"● Não salvo"), idioma misturado ("Exportar ▾" vs "Export PNG") e o verde de CTA no
botão "Organize", que não é a ação principal. Consolidar em um indicador único, PNG
dentro do menu Exportar e pesos visuais coerentes.

## Comportamento esperado

1. **Indicador único de estado** (direita da toolbar): um só elemento com os estados
   `Salvo ✓` · `● Não salvo` · `Salvando…` · `⚠ Falha ao salvar` · mensagens transitórias
   de operação (o dropdown de logs v15-04 continua ancorado nele). Remover o "Pronto"
   como elemento separado — "pronto" é a ausência de operação em andamento e o estado de
   salvamento já comunica isso.
2. **Export PNG entra no menu "Exportar ▾"** como último item ("PNG do canvas"),
   removendo o botão avulso. Menos um botão de primeiro nível.
3. **Idioma**: toda a toolbar em pt-BR ("Organizar" em vez de "Organize"; itens do menu
   mantêm nomes próprios de formato — "Spark DDL", "dbt", "Mermaid").
4. **Peso visual**: o verde fica reservado para a ação primária do fluxo (Salvar quando
   há alteração pendente); "Organizar" volta ao estilo padrão de botão. Demais botões
   mantêm o estilo atual.
5. Nenhuma mudança de comportamento funcional (atalhos Cmd/Ctrl+S, auto-save toggle,
   undo/redo intactos).

## Arquivos

- `src/App.tsx` — composição da toolbar, estados de salvamento, rótulos.
- `src/ExportMenu.tsx` — item "PNG do canvas" (chama o fluxo de `src/exportPng.ts`).
- `src/canvas/StatusLog.tsx` — único host do texto de status.
- `src/styles.css` — classe do botão primário (`.toolbar button.primary`), remoção de
  estilos órfãos do botão PNG.

## Critérios de aceite

- AC1: toolbar exibe **um** elemento de status; os 4 estados de salvamento aparecem
  nele (forçar cada um: salvar, editar, desligar rede/falha simulada).
- AC2: "Export PNG" não existe mais como botão; "Exportar ▾ → PNG do canvas" gera o
  download e `data/output/diagram.png` como antes.
- AC3: zero strings em inglês na toolbar (exceto nomes de formatos).
- AC4: botão verde = Salvar com pendência; sem pendência, Salvar fica no estilo padrão.

## Testes (TDD)

- Unit: mapa estado→rótulo/classe do indicador único (extrair para função pura).
- Headless `scripts/verify-toolbar.mjs`: conta 1 elemento de status; abre Exportar,
  clica "PNG do canvas", espera `data/output/diagram.png`; asserta ausência do botão
  "Export PNG".
