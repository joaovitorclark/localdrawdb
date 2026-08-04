# Spec B — Pacote portátil Windows (.exe sem instalador, sem admin)

**Data:** 2026-08-04
**Status:** aprovado (aguardando revisão do usuário)
**Branch alvo:** `feature/windows-portable-package`
**Depende de:** [Spec A — Domínios versionados (git) e sistema de projetos](2026-08-04-git-domains-versioning-design.md).
A tela de escolha (picker) e o contexto ativo por projeto da Spec A são o que
torna "executar só dentro do projeto" possível — esta spec só empacota esse
comportamento pra quem não quer instalar Node manualmente no Windows.

## Objetivo

Distribuir o LocalDrawDB para usuários Windows sem exigir instalação de
Node.js, sem instalador MSI e **sem precisar de acesso admin** — mesmo padrão
usado pelo Oracle SQL Developer Data Modeler: ZIP portátil com runtime
embutido, extrai e roda.

### Referência: Oracle SQL Developer Data Modeler

- Distribuído como ZIP contendo o app **e** uma cópia embutida do JDK 17; basta
  extrair em qualquer pasta e rodar o `.exe` na raiz — sem instalador, sem
  admin ([softradar.com](https://softradar.com/oracle-sql-developer-data-modeler/),
  [oracle.com/tools/downloads/dm-install-win32-64.html](https://www.oracle.com/tools/downloads/dm-install-win32-64.html)).
- Única dependência externa do sistema citada é uma DLL (`MSVCR100.dll`) quase
  sempre já presente no Windows.

O equivalente pra nós: embutir um **Node.js portátil** em vez do JDK.

## Escopo

### Dentro

- Script `npm run build:win` que gera uma pasta/zip portátil:
  Node.js portátil (win-x64) + servidor bundlado (esbuild) + build do Vite +
  launcher `.exe` fino.
- Launcher: aloca porta livre, sobe `node server.bundle.js`, espera responder,
  abre o navegador padrão direto na tela de escolha (picker) da Spec A.
  Fechar o processo encerra o servidor.
- Dados do usuário (`data/domains/`) ficam **ao lado do launcher**, dentro da
  mesma pasta extraída do zip — portátil de verdade (dá pra levar num
  pendrive), com o trade-off documentado abaixo.
- Detecção de `git.exe` no boot: se ausente, app funciona normalmente para
  domínios locais; qualquer ação git mostra aviso com link para o instalador
  do Git for Windows (que também não exige admin). Não embutimos Git no pacote.
- Nota de documentação sobre WSL (ver seção própria abaixo) — sem trabalho de
  engenharia associado.

### Fora (YAGNI / v1)

- Instalador MSI/NSIS, entrada no menu Iniciar, associação de arquivo.
- Executável único "fundido" via Node SEA/pkg (ver decisão abaixo).
- Empacotamento Electron (janela nativa).
- Auto-update do pacote.
- CI/release automatizado (GitHub Actions) — só script local por ora.
- Git portátil embutido no pacote.
- Empacotamento equivalente para Linux/macOS.
- Qualquer caminho de instalação/uso via WSL — ver nota abaixo.

## Decisões de design

| Decisão | Escolha | Por quê |
|---|---|---|
| Forma do pacote | Pasta portátil (Node embutido + launcher fino) | Reaproveita 100% do `server/` atual sem reescrever nada; menor risco que Node SEA/pkg (ainda frágeis com dependências como as nossas) ou Electron (rearquitetura pesada). Continua abrindo no navegador padrão, não numa janela nativa. |
| Local dos dados (`data/domains/`) | Ao lado do launcher, dentro da pasta extraída | Usuário escolheu portabilidade total sobre robustez contra "apagar a pasta". Mitigado: domínios git podem ser re-clonados do remote; documentar o risco explicitamente. |
| Git no pacote | Não embutir; detectar e orientar instalação | Mantém o pacote leve; Git for Windows também não exige admin, então não quebra a promessa central. |
| Geração do pacote | Script local (`npm run build:win`), sem CI por ora | Escopo v1 enxuto; publicar é uma ação manual de quem mantém o projeto. |
| WSL | Não vira caminho suportado; só nota de documentação | Habilitar WSL2 tipicamente exige admin (contradiz o objetivo central) e é comum estar desabilitado em Windows corporativo travado — pior fit que o launcher portátil para o público-alvo. Quem já tem WSL configurado por conta própria já roda Linux por baixo e pode simplesmente seguir o fluxo normal (`npm install && npm run dev` / `./ldb`) sem precisar deste pacote — zero trabalho de engenharia, só uma frase na doc. |

## Arquitetura

### Estrutura do pacote

```
LocalDrawDB-win/
  node/                    # Node.js portátil oficial win-x64 (versão pinada)
  app/
    server.bundle.js       # server/ + deps, bundlado via esbuild
    dist/                  # build do Vite (SPA), igual ao `npm run build` atual
  LocalDrawDB.exe          # launcher fino
  data/
    domains/                # criado no primeiro uso
    domains.json
```

### Launcher

- Não é o app inteiro fundido num binário — é um executável mínimo (gerado a
  partir de um wrapper pequeno) que:
  1. Resolve a porta livre (mesma lógica de `scripts/devPorts.mjs` já
     existente, reaproveitada).
  2. Roda `node/node.exe app/server.bundle.js` com `LOCALDRAWDB_DATA_DIR`
     apontando para `./data` (relativo ao launcher).
  3. Aguarda o servidor responder (`waitForPort`, já existente em
     `scripts/devPorts.mjs`).
  4. Abre `http://localhost:<porta>` no navegador padrão do Windows.
  5. Mantém o processo vivo; fechar a janela do console encerra o servidor
     filho.

### Build (`npm run build:win`, novo script)

1. Garante/baixa o Node.js portátil win-x64 numa versão pinada (cache local,
   não versionado no repo — ex.: `scripts/build-win/fetchNode.mjs`).
2. `esbuild` bundla `server/` (+ dependências) num único `server.bundle.js`
   CommonJS/ESM compatível com o Node embutido.
3. `vite build` gera `dist/` (mesmo passo do build atual).
4. Monta a estrutura acima em `dist-win/LocalDrawDB-win/` e compacta em
   `dist-win/LocalDrawDB-win.zip`.

### Detecção de git

- No boot do `server.bundle.js`: `execFile('git', ['--version'])`. Resultado
  cacheado em memória e exposto via `/api/meta` (já existe esse endpoint,
  passa a incluir `gitAvailable: boolean`).
- Painel de git (Spec A) usa essa flag pra trocar botões de ação por um aviso
  com link, em vez de tentar rodar comandos que vão falhar.

## Critérios de aceitação

1. `npm run build:win` produz `dist-win/LocalDrawDB-win.zip` sem erros.
2. Extrair o zip numa máquina Windows limpa (sem Node, sem admin) e rodar
   `LocalDrawDB.exe` abre o navegador na tela de escolha (picker) da Spec A.
3. Fluxo completo funciona sem Node/git pré-instalados: criar domínio local,
   criar projeto, editar, salvar — idêntico ao comportamento do dev atual.
4. Numa máquina com `git` instalado: clonar domínio, ver status, pull, commit,
   push funcionam a partir do pacote portátil igual ao modo dev.
5. Numa máquina sem `git`: ações git mostram aviso com link de instalação;
   resto do app funciona normalmente.
6. Mover a pasta extraída inteira para outro local e rodar de novo continua
   funcionando (portabilidade real).
7. Nenhuma etapa (extrair, rodar, criar domínio/projeto local) pede elevação
   de privilégio.

## Testes

- Automatizados: `esbuild` bundling e montagem de pasta cobertos por um teste
  de smoke do script de build (`scripts/build-win/__tests__/`), rodando em
  qualquer SO de dev (não depende de Windows).
- Manual (checklist documentado no `README.md` da pasta `scripts/build-win/`):
  os 7 critérios de aceitação acima, executados numa VM/máquina Windows real
  antes de cada release — não há como automatizar em CI hoje sem uma runner
  Windows dedicada (fora de escopo v1).

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Apagar/mover a pasta do app perde domínios git não publicados | Documentado explicitamente no README/UI; domínios com remote são recuperáveis via novo clone — só o não commitado se perde. |
| Node portátil desatualizado (CVE) | Versão pinada e revisada periodicamente; script de fetch facilita bump. |
| `esbuild` não conseguir bundlar alguma dependência nativa do `server/` (ex.: binding nativo) | Nenhuma dependência atual do `server/` usa binding nativo (checar `package.json` na fase de implementação); se surgir, tratar caso a caso na fase de `writing-plans`. |
| Antivírus/SmartScreen do Windows sinalizar o `.exe` por não ser assinado | Fora de escopo v1 (assinatura de código custa e não é essencial pro objetivo "sem admin"); documentar como aviso conhecido. |

## Arquivos tocados (estimativa — plano detalhado fica para a fase de `writing-plans`)

- Novos: `scripts/build-win/fetchNode.mjs`, `scripts/build-win/bundleServer.mjs`,
  `scripts/build-win/makeLauncher.mjs`, `scripts/build-win/build.mjs`,
  `scripts/build-win/__tests__/`.
- Modificados: `package.json` (`build:win` script), `server/index.ts` /
  `server/routes.ts` (`gitAvailable` em `/api/meta`), `README.md` (seção de
  distribuição Windows + nota de WSL).
