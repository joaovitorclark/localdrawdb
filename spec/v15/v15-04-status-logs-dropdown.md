# v15-04 — Dropdown de logs (últimos 100)

## Objetivo
A área de status do topo (ex.: `Edição aplicada (17 refs atualizadas)`, `Pronto`,
`Backend offline…`) deve ter um **dropdown** para ver os **últimos 100 logs**.
> O usuário pediu para **avaliar a dificuldade primeiro** — avaliação abaixo.

## Avaliação de dificuldade: **MÉDIA-BAIXA**
Hoje o status é uma única string (`const [status, setStatus] = useState('Carregando…')` em
`src/App.tsx:160`), sobrescrita em ~10 pontos (`setStatus(...)`). Não há histórico. Para o
dropdown precisamos acumular um histórico (ring buffer de 100) com timestamp. Baixo risco;
o único "trabalho" é garantir que todas as escritas de status também virem entrada de log.

## Estado atual
- `src/App.tsx`: `status` (string) + ~10 `setStatus(...)` (linhas 249, 273, 279, 587, 589, 615,
  685, 762, 773…). Renderizado no header perto de Salvar/Auto-save.

## Abordagem
1. **Histórico:** `const [logs, setLogs] = useState<{ ts: number; msg: string }[]>([])`.
   Criar `pushStatus(msg)` que faz `setStatus(msg)` **e** `setLogs(l => [{ts:Date.now(), msg},
   ...l].slice(0, 100))`. Substituir os `setStatus` por `pushStatus` (ignorar strings vazias/de
   limpeza como `setStatus('')`).
2. **UI:** transformar o texto de status num botão que abre um **dropdown** (popover) listando os
   últimos 100 (mais recente no topo), com hora `HH:MM:SS` + mensagem. Fechar ao clicar fora
   (padrão já usado nas paletas).
3. Não persistir (memória da sessão) — simples e suficiente.

## Arquivos
`src/App.tsx` (estado `logs` + `pushStatus` + wiring dos `setStatus`), um pequeno componente
`src/canvas/StatusLog.tsx` (ou inline no header) + `src/styles.css`.

## Critérios de aceite
- Clicar no status abre o dropdown com até 100 entradas (recentes no topo, com horário).
- Novas mensagens entram no topo; passa de 100 → descarta as antigas.
- Fecha ao clicar fora.
- Verificação headless: gerar N ações, abrir dropdown, conferir contagem/ordem.

## Dificuldade
Média-baixa. Sem persistência, sem backend.
