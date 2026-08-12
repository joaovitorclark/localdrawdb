# Build do pacote Windows

`npm run build:win` gera `dist-win/LocalDrawDB-win.zip` — Node.js portátil +
servidor bundlado + build do Vite + launcher `.exe`, sem instalador, sem admin.

Baixa e cacheia o Node.js portátil win-x64 em `.cache/build-win/` na primeira
vez (não versionado); builds seguintes reusam o cache.

Roda a partir de macOS/Linux/Windows: o `.exe` é montado com Node SEA +
`postject`, que só manipula o formato binário PE — não precisa executar o
`.exe` na máquina de build.

**Risco conhecido ao buildar a partir de macOS/Linux:** o blob do SEA é
acoplado à versão exata do Node que o gera; injetá-lo num `node.exe` de
outra versão crasha ao abrir (`STATUS_ACCESS_VIOLATION`), sem nenhuma
mensagem. Em host **Windows**, o build gera o blob com o próprio Node
portátil pinado (`NODE_VERSION` em `fetchNode.mjs`), então as versões
sempre batem. Em host **macOS/Linux** isso não é possível — o Node
portátil é um binário win32 — e o blob é gerado com o Node do host, que
pode divergir do pinado. Mitigação: rode o build com a mesma versão major.minor.patch
pinada em `fetchNode.mjs` instalada localmente (`nvm use` com essa versão)
até existir automação que baixe um Node do host na versão certa só para
gerar o blob.

## Distribuição — como o usuário final chega no `.exe`

`dist-win/` é gitignored: clonar/baixar o repositório **não** dá acesso ao
`.exe`. O caminho pra usuário final é `.github/workflows/release-win.yml` —
builda, roda o smoke test, e publica `LocalDrawDB-win.zip` como asset de uma
GitHub Release (aba "Releases" do repositório). Dispara automaticamente em
todo push em `main` — mas só builda/publica de verdade quando a versão em
`package.json` mudou desde o commit anterior (job `check-version`, barato,
evita rebuildar em todo merge). Pra soltar uma release: dê bump na versão e
mergeie em `main`, sem precisar de comando nenhum. "Run workflow" (aba
Actions) fica como via manual, pra re-publicar a mesma versão sem bump (ex:
hotfix só no pacote). Quem só quer usar o app baixa o zip na página de
Releases — sem git, sem npm, sem clonar nada.

## CI (windows-latest)

`.github/workflows/build-win-check.yml` roda o build real numa VM Windows
hospedada pelo GitHub em todo PR que toca `server/`, `src/`, `scripts/build-win/`
ou o próprio workflow, usando `scripts/build-win/ci-smoke.ps1`. Ele reduz o
risco antes da checklist manual, mas **não substitui** o item 2 (fluxo de
editar/salvar) nem o teste real de clone/pull/push do item 3 — ambos exigem
interação de verdade com a UI, fora do que dá pra automatizar num runner
sem browser.

## Checklist manual (rodar numa VM/máquina Windows real antes de cada release)

Extraia `dist-win/LocalDrawDB-win.zip` numa pasta qualquer (idealmente numa
máquina **sem** Node.js e **sem** privilégio de administrador) e confirme:

1. [ ] Dar duplo-clique em `LocalDrawDB.exe` abre o navegador padrão na tela
   de escolha de domínio/projeto (não pede elevação de privilégio).
   **(CI cobre parcialmente: boot sem `-Verb RunAs` responde em `/api/meta`;
   a abertura real do navegador continua manual.)**
2. [ ] Criar um domínio local, criar um projeto, editar o modelo e salvar —
   funciona igual ao `npm run dev` local. **(Não coberto por CI — exige UI.)**
3. [ ] Numa máquina com `git` instalado: clonar um domínio, ver status,
   fazer pull, commit e push funcionam pela UI.
   **(CI cobre só a detecção — `gitAvailable: true` — não o fluxo completo.)**
4. [ ] Numa máquina **sem** `git`: as ações de git mostram aviso com link
   pra instalar o Git for Windows; o resto do app funciona normalmente.
   **(CI cobre a detecção — `gitAvailable: false` com PATH sem git — e que o
   app ainda sobe; o aviso na UI continua manual.)**
5. [ ] Mover a pasta `LocalDrawDB-win` inteira pra outro local (ex: de
   Downloads pra um pendrive) e rodar `LocalDrawDB.exe` de novo continua
   funcionando, com os dados preservados. **(Coberto por CI.)**
6. [ ] Nenhuma etapa (extrair o zip, rodar o exe, criar domínio/projeto
   local) mostra o prompt de UAC (elevação de administrador).
   **(CI cobre por proxy: o boot sem `-Verb RunAs` funciona; não observa
   diretamente a ausência do diálogo.)**
7. [ ] Fechar a janela do `LocalDrawDB.exe` encerra o processo do servidor
   (confira no Gerenciador de Tarefas que não sobra `node.exe` órfão).
   **(CI tenta fechamento gracioso via `taskkill` sem `/F` e checa órfãos;
   quando isso não confirma a tempo, o job avisa em vez de validar o item.)**

Se qualquer item falhar, não publique o release — abra uma issue com o item
que falhou antes de investigar a causa.

## Estrutura do pacote

```
LocalDrawDB-win/
  LocalDrawDB.exe        # launcher SEA (node.exe + blob do launcher)
  node/node.exe          # runtime portátil usado pelo servidor
  app/server.bundle.mjs  # servidor Fastify bundlado (esbuild)
  app/node_modules/      # dependências de produção
  dist/                  # frontend buildado pelo Vite
  data/                  # vazia — o app cria domains.json/domains/ no 1º boot
```

## Sobre WSL

Se você já usa WSL (Windows Subsystem for Linux), é Linux por baixo — pode
simplesmente rodar o fluxo normal (`npm install && npm run dev` / `./ldb`)
dentro dele, sem precisar deste pacote.
