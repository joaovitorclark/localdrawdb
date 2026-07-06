# v18 — Plano de execução

Lote com 1 feature de portabilidade (export/import de cores — pedido explícito) +
melhorias de UX/estética identificadas na avaliação de 2026-07-06 (screenshots headless
em produção, projeto `default` com 67 tabelas). Cada item tem spec própria neste diretório.

## Diagnóstico que originou o lote

- **Export LocalDrawDB (Spark/Oracle) perde todas as cores.** Verificado por round-trip
  real: `dbmlToModel` descarta o bloco `Colors {}` (o `Model` canônico não tem campo de
  cores), `modelToInputSql` nunca emite cor e `sqlImport` não tem parser de cor.
  Linhagem L1 (`@origen`) e L2 (rodapé `-- @lineage`), `@layer`, `@group`, notas
  (COMMENT ON), records (INSERT) e FKs **já** round-trippam corretamente.
- **UI**: estado inicial abre com tabela selecionada + popups abertos; painéis flutuantes
  concorrem pelo canvas (em 1280×720 sobra ~30%); tipografia sem escala (9–16px, moda em
  10–11px); toolbar com dois indicadores de estado ("Pronto" + "● Não salvo") e idioma
  misturado ("Exportar" / "Export PNG"); zero `@media`; ícones emoji.

## Itens

| # | Spec | Tipo | Dificuldade | Depende de |
|---|------|------|-------------|-----------|
| 01 | [Export/import de cores no formato LocalDrawDB](v18-01-export-colors-roundtrip.md) | 🔁 portabilidade | Média | — |
| 02 | [Estado inicial limpo (sem seleção/popups)](v18-02-clean-initial-state.md) | 🐛/🧩 UI | Baixa (investigação) | — |
| 03 | [Toolbar: um indicador de estado + hierarquia](v18-03-toolbar-status-hierarchy.md) | 🧩 UI | Baixa | — |
| 04 | [Escala tipográfica + contraste](v18-04-type-scale-contrast.md) | 🎨 visual | Baixa | — |
| 05 | [Painéis colapsáveis com estado persistido](v18-05-collapsible-panels.md) | 🧩 UI | Média | 02 |
| 06 | [Command palette (Cmd+K)](v18-06-command-palette.md) | ⚡ feature | Média | — |
| 07 | [Overlay de atalhos `?` + descoberta](v18-07-shortcuts-discovery.md) | ⚡ feature | Baixa | 06 |
| 08 | [Ícones SVG + tooltips próprios](v18-08-icons-tooltips.md) | 🎨 visual | Média | 03 |
| 09 | [Code-split (CodeMirror/parsers)](v18-09-code-split.md) | 🚀 perf | Média | — |
| 10 | [Input lê `.dbml` (troca nativa sem perdas)](v18-10-dbml-input.md) | 🔁 portabilidade | Baixa | 01 |
| 11 | [Export dbt com metadados + input de volta](v18-11-dbt-metadata-roundtrip.md) | 🔁 portabilidade | Média | 01 |

## Ordem recomendada

1. **01** — pedido explícito; destrava o fluxo "exportar → mandar para outra pessoa →
   abrir igual (menos posições)". Fazer isolado e completo (export + import + merge).
2. **02** — primeira impressão; investigação curta, correção pequena.
3. **03** + **04** — quase só CSS/JSX; mudam a cara da plataforma com risco baixo.
4. **05** — depende do 02 (política de estado inicial definida primeiro).
5. **06** depois **07** — o overlay `?` lista atalhos que o palette formaliza.
6. **08** e **09** — acabamento e perf; sem dependência entre si.

## Convenções

- Gate por item: `npm run typecheck` **e** `npm test -- --run`. Build (`npm run build`)
  não type-checa.
- Verificação de UI: headless com Chrome do sistema (`scripts/verify-*.mjs`, ver
  `memory/headless-verify-system-chrome`). Cada item de UI ganha/atualiza um script.
- Cor persistida no DBML: bloco `Colors {}` — chave com 2 partes = tabela
  (`schema.tabela`), `@nome` = grupo, 3 partes = coluna (`schema.tabela.coluna`).
- Posições/tamanhos/páginas ficam em `canvas.json` e **ficam fora** do export
  LocalDrawDB por decisão de produto (posicionamento não precisa viajar).

## Critério de conclusão do lote

Todos os itens com gate verde + verificação headless. Para o 01, round-trip completo
demonstrado: projeto com cores de tabela/grupo/coluna + linhagem L1/L2 → Exportar
LocalDrawDB (Oracle) → importar o arquivo em projeto vazio → mesmas cores e linhagem
visíveis no canvas (posições podem diferir).
