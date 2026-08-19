# Spec C — Modo app (Edge) e atalho de Desktop no pacote Windows

**Data:** 2026-08-13
**Status:** aprovado (aguardando revisão do usuário)
**Branch alvo:** `feature/windows-edge-app-mode`
**Depende de:** [Spec B — Pacote portátil Windows](2026-08-04-windows-portable-package-design.md), já implementada.

## Objetivo

O pacote Windows (`LocalDrawDB.exe`) hoje abre o navegador padrão apontando
para `http://127.0.0.1:<porta>` — aparece como uma aba comum, com barra de
endereço/abas, sem ícone próprio na barra de tarefas, e a experiência varia
conforme o navegador padrão do usuário. Esta spec faz o launcher abrir numa
janela do Microsoft Edge em **modo app** (`--app=`) — sem chrome de
navegador, com ícone e entrada própria na barra de tarefas — e criar um
atalho de Desktop na primeira execução, sem exigir instalação nova nem
admin (o Edge já vem em todo Windows 10/11).

Uma janela nativa "de verdade" (WebView2 embutido num host próprio, sem
depender do `msedge.exe` do sistema) fica registrada como direção futura,
fora do escopo desta spec.

## Escopo

### Dentro

- Detecção do `msedge.exe` instalado (caminhos conhecidos + registro do
  Windows), só dentro do pacote Windows.
- Abrir a UI numa janela do Edge em modo app (`--app=`), com perfil isolado
  dentro da própria pasta portátil (`data/edge-profile/`).
- Fallback silencioso para o comportamento atual (abrir navegador padrão)
  quando o Edge não é encontrado.
- Criação automática (sem perguntar) de um atalho `.lnk` na Área de
  Trabalho na primeira execução, apontando para o `LocalDrawDB.exe`, com
  ícone customizado — idempotente via arquivo-marcador, nunca recriado se
  o usuário apagar o atalho depois.
- Ícone placeholder (`.ico`) commitado no repositório, usado tanto no
  atalho quanto no favicon da SPA (`index.html`) — este último é a única
  mudança fora de `scripts/build-win/`, e é inofensiva/cross-platform (só
  uma tag `<link>` estática).

### Fora (YAGNI / v1)

- Janela nativa via WebView2 embutido num host próprio (não depende do
  `msedge.exe` do sistema) — direção futura, não implementada aqui.
- Instalador MSI/NSIS, entrada no menu Iniciar, associação de arquivo
  (mantido fora, como na Spec B).
- Pin automático na barra de tarefas (usuário faz manualmente se quiser,
  a partir do atalho da Desktop).
- Prompt de confirmação antes de criar o atalho da Desktop.
- Empacotamento equivalente para Linux/macOS.
- Geração automatizada do `.ico` a partir de um design final — o desta
  spec é placeholder, substituível depois sem tocar em código.

## Decisões de design

| Decisão | Escolha | Por quê |
|---|---|---|
| Motor da janela | Edge do sistema em modo app (`--app=`), não WebView2 embutido | Zero dependência nova — Edge já vem em todo Windows 10/11. Reaproveita quase 100% do launcher atual (Spec B). Trade-off aceito: não é uma janela "nativa de verdade" (ainda é o motor do Edge por baixo); WebView2 embutido fica como direção futura. |
| Escopo da mudança | Só dentro de `scripts/build-win/` (nunca `server/`, nunca o resto de `src/`) | `scripts/build-win/` só entra no bundle do `npm run build:win`; `npm run dev`, `./ldb` e o build normal (`npm run build`/`npm start`) não são tocados. Única exceção é o favicon estático em `index.html` (ver linha abaixo). |
| Favicon em `index.html` | Adiciona `<link rel="icon">` | Mudança mínima e inofensiva (referência estática, sem lógica); beneficia todas as plataformas/dev, não só o pacote Windows — dá ícone também na aba do navegador em modo dev. |
| Perfil do Edge (`--user-data-dir`) | Dentro da pasta portátil (`data/edge-profile/`) | Mantém a promessa de portabilidade da Spec B — nada em `%LOCALAPPDATA%`; mover a pasta inteira continua levando tudo. |
| Fallback sem Edge | Silencioso, cai no `exec('start ...')` atual | Corporativo pode remover/bloquear o Edge; não é motivo para quebrar o app — só perde o modo app/ícone, funcionalidade continua 100%. |
| Criação do atalho de Desktop | Automática, sem perguntar, na primeira execução | Mais simples, mais parecido com "já funciona"; decisão do usuário nesta sessão de brainstorming. |
| Idempotência do atalho | Arquivo-marcador (`data/.desktop-shortcut-created`), não a existência do `.lnk` | Checar só a existência do `.lnk` faria ele reaparecer sempre que o usuário o apagasse de propósito — o marcador garante "uma vez só", depois quem decide é o usuário. |
| Alvo do atalho | `LocalDrawDB.exe` (o launcher), sem porta fixada | Porta é alocada dinamicamente a cada execução (mesma lógica de hoje) — fixar porta no atalho quebraria na primeira colisão de porta. Atalho é equivalente a dar duplo-clique no `.exe`. |
| Ferramenta de criação do `.lnk` | `powershell.exe` + COM `WScript.Shell` | Único jeito de criar `.lnk` sem lib nova — usa só o que já vem no Windows, mesmo padrão de já shell-out pra `git.exe`/`node.exe`. |
| Falha na criação do atalho | Silenciosa, só log no console | Nunca bloqueia o boot do app; o launcher já cumpriu o objetivo principal (abrir a janela). |

## Arquitetura

### Ponto de mudança

Único ponto cirúrgico: `scripts/build-win/launcherSrc.mjs`, linha 97, onde
hoje é:

```js
exec(`start "" "http://127.0.0.1:${port}"`);
```

Passa a ser uma função `openApp(port, launcherDir)` que:

1. **Detecta o Edge** (`scripts/build-win/edgeAppMode.mjs`, novo):
   - Checa `%ProgramFiles%\Microsoft\Edge\Application\msedge.exe` e a
     variante `%ProgramFiles(x86)%\...`.
   - Se não achar, consulta o registro via
     `reg query "HKLM\SOFTWARE\Clients\StartMenuInternet\Microsoft Edge\shell\open\command"`.
   - Retorna o caminho ou `null`.
2. **Se achou o Edge:**
   `spawn(msedgePath, ['--app=http://127.0.0.1:' + port, '--user-data-dir=' + path.join(launcherDir, 'data', 'edge-profile'), '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' })`.
3. **Se não achou:** `exec('start "" "http://127.0.0.1:' + port + '"')` — comportamento atual, inalterado.
4. **Garante o atalho** (`ensureDesktopShortcut`, mesmo módulo novo):
   verifica o marcador `data/.desktop-shortcut-created`; se ausente, roda o
   `powershell.exe` que cria o `.lnk` (Target = caminho absoluto do
   `LocalDrawDB.exe`, IconLocation = caminho absoluto do
   `scripts/build-win/assets/icon.ico` bundlado na pasta `app/`), depois
   grava o marcador. Qualquer erro nessa etapa vira `console.warn`, nunca
   lança.

### Estrutura de arquivos

```
scripts/build-win/
  edgeAppMode.mjs         # novo: findEdgePath(), openApp(), ensureDesktopShortcut()
  assets/
    icon.ico              # novo: ícone placeholder, multi-resolução
  launcherSrc.mjs          # modificado: linha 97 chama openApp() em vez de exec direto
  __tests__/
    edgeAppMode.test.mjs   # novo

index.html                 # modificado: <link rel="icon" href="...">
```

Pacote final (`dist-win/LocalDrawDB-win/`) ganha `app/assets/icon.ico` ao
lado do `server.bundle.js`/`dist/` já existentes; `data/edge-profile/` e
`data/.desktop-shortcut-created` são criados em runtime, não fazem parte
do zip.

## Critérios de aceitação

1. Numa máquina Windows com Edge instalado, `LocalDrawDB.exe` abre a UI numa
   janela sem barra de endereço/abas (modo app), com ícone próprio na barra
   de tarefas enquanto roda.
2. Numa máquina sem Edge (ou com `msedge.exe` bloqueado), o app cai no
   comportamento atual (navegador padrão numa aba normal) sem erro visível
   e sem travar o boot.
3. Primeira execução cria um atalho `LocalDrawDB.lnk` na Área de Trabalho,
   com ícone customizado, apontando para o `.exe`.
4. Rodar o app de novo não duplica nem recria o atalho.
5. Apagar o atalho manualmente e rodar o app de novo **não** o recria.
6. Nenhuma etapa (detecção do Edge, abrir a janela, criar o atalho) pede
   elevação de privilégio.
7. `npm run dev`, `./ldb` e `npm run build`/`npm start` continuam
   idênticos a hoje — nenhuma mudança de comportamento fora do pacote
   Windows.
8. `npm test` e `npm run typecheck` verdes.

## Testes

- Automatizados (`scripts/build-win/__tests__/edgeAppMode.test.mjs`, rodam
  em qualquer SO): `findEdgePath()` com `fs`/`exec` mockados (caminho
  conhecido existe, caminho ausente cai no `reg query`, nenhum dos dois
  encontra → `null`); montagem dos args do `spawn` do modo app
  (`--app=`, `--user-data-dir`, flags); `ensureDesktopShortcut()` — cria o
  marcador na ausência, não dispara o PowerShell de novo na presença.
- Manual (novo item no checklist de `scripts/build-win/README.md`,
  executado em VM Windows antes de release): os 8 critérios de aceitação
  acima, incluindo o caso "sem Edge" (renomear/mover `msedge.exe`
  temporariamente ou usar um snapshot de VM sem Edge) e o caso "atalho
  apagado não reaparece".

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Edge removido/bloqueado por política corporativa | Fallback silencioso já cobre; funcionalidade do app não depende do modo janela. |
| `reg query` ou `powershell.exe` bloqueados por política de grupo restrita | Falha vira log, não exceção — app abre mesmo assim (via fallback de navegador se a detecção também falhar). |
| Política de grupo redireciona/desabilita a pasta Desktop do usuário | Criação do atalho falha silenciosamente (mesmo tratamento acima); app funciona normalmente sem o atalho. |
| `.ico` placeholder ficar "feio"/genérico demais | Documentado como placeholder explícito; troca é só substituir o arquivo, sem mudança de código. |
| Perfil do Edge (`data/edge-profile/`) crescer com cache ao longo do tempo | Mesmo trade-off de portabilidade já aceito pra `data/domains/` na Spec B; documentar no README que apagar a subpasta é seguro (Edge recria). |

## Arquivos tocados (estimativa — plano detalhado fica para a fase de `writing-plans`)

- Novos: `scripts/build-win/edgeAppMode.mjs`, `scripts/build-win/assets/icon.ico`,
  `scripts/build-win/__tests__/edgeAppMode.test.mjs`.
- Modificados: `scripts/build-win/launcherSrc.mjs` (linha 97 → `openApp()`),
  `scripts/build-win/build.mjs` (copia `assets/icon.ico` para o pacote final),
  `index.html` (`<link rel="icon">`), `scripts/build-win/README.md`
  (checklist manual), `README.md` (nota sobre modo app na seção de
  distribuição Windows).

## Direção futura (fora desta spec)

Janela nativa "de verdade" via WebView2 embutido num host próprio (não
depende do `msedge.exe` do sistema instalado) — dá mais controle sobre
chrome/ícone/ciclo de vida, mas exige escrever e manter um host nativo
novo (ex.: C#/WinForms mínimo hospedando o controle WebView2). Avaliar
quando a experiência de app do Edge deixar de ser suficiente.
