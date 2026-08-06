# Build do pacote Windows

`npm run build:win` gera `dist-win/LocalDrawDB-win.zip` — Node.js portátil +
servidor bundlado + build do Vite + launcher `.exe`, sem instalador, sem admin.

Baixa e cacheia o Node.js portátil win-x64 em `.cache/build-win/` na primeira
vez (não versionado); builds seguintes reusam o cache.

Roda a partir de macOS/Linux/Windows: o `.exe` é montado com Node SEA +
`postject`, que só manipula o formato binário PE — não precisa executar o
`.exe` na máquina de build.

## Checklist manual (rodar numa VM/máquina Windows real antes de cada release)

Extraia `dist-win/LocalDrawDB-win.zip` numa pasta qualquer (idealmente numa
máquina **sem** Node.js e **sem** privilégio de administrador) e confirme:

1. [ ] Dar duplo-clique em `LocalDrawDB.exe` abre o navegador padrão na tela
   de escolha de domínio/projeto (não pede elevação de privilégio).
2. [ ] Criar um domínio local, criar um projeto, editar o modelo e salvar —
   funciona igual ao `npm run dev` local.
3. [ ] Numa máquina com `git` instalado: clonar um domínio, ver status,
   fazer pull, commit e push funcionam pela UI.
4. [ ] Numa máquina **sem** `git`: as ações de git mostram aviso com link
   pra instalar o Git for Windows; o resto do app funciona normalmente.
5. [ ] Mover a pasta `LocalDrawDB-win` inteira pra outro local (ex: de
   Downloads pra um pendrive) e rodar `LocalDrawDB.exe` de novo continua
   funcionando, com os dados preservados.
6. [ ] Nenhuma etapa (extrair o zip, rodar o exe, criar domínio/projeto
   local) mostra o prompt de UAC (elevação de administrador).
7. [ ] Fechar a janela do `LocalDrawDB.exe` encerra o processo do servidor
   (confira no Gerenciador de Tarefas que não sobra `node.exe` órfão).

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
