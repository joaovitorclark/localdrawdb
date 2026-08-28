# Spec — `domains.json` / `projects.json` que se auto-regeneram do disco

**Data:** 2026-08-28
**Status:** aprovado (aguardando revisão do usuário)
**Branch alvo:** `fix/domains-registry-self-heal`
**Depende de:** [Domínios versionados](2026-08-04-git-domains-versioning-design.md),
[Controlboard de dev](2026-08-19-dev-controlboard-design.md), ambas implementadas.

## Objetivo

Depois de mergear o controlboard, `npm run dev` sem argumentos abre o
controlboard, que lista **só os domínios registrados em `data/domains.json`**.
Um usuário no WSL abriu o board e um domínio git que existia
(`data/domains/lakehouse-data-modeler/`, com o Explorer do Windows aberto
na pasta) **não apareceu**, e o `git clone` de novo falhou com:

```
fatal: destination path '/home/.../data/domains/lakehouse-data-modeler'
already exists and is not an empty directory.
```

Causa: a pasta existe no disco mas **não está no registry**, e:

- `deleteDomain()` tira o domínio do registry **antes** de apagar a pasta;
  se o `fs.rm` falha (Explorer/watcher segurando o diretório — comum no
  WSL/Windows), a pasta fica **órfã** (fora do registry, ainda em disco);
- `cloneDomain()` nunca checa se a pasta-alvo existe, e o `uniqueSlug()`
  só desduplica contra o registry, não contra o disco — então o
  `git clone` cai numa pasta já ocupada e aborta;
- nada reconcilia o registry com o disco (ao contrário de `projects.json`,
  que já tem `syncRegistryWithDisk()` add-only rodando no `activateDomain`).

`domains.json` e `projects.json` são **derivados** — a fonte de verdade é
a pasta em disco. Eles têm que se regenerar sozinhos, muitas vezes.

## Escopo

### Dentro

- `syncDomainsRegistryWithDisk()` (novo, add-only, exportado): varre
  `data/domains/*`, e registra toda pasta que **parece um domínio** e não
  tem entrada. "Parece um domínio" = contém `.git`, `projects.json` ou
  `projects/`. Nunca remove. Idempotente.
- `listDomains()` chama o sync antes de ler — o board e o
  `GET /api/domains` passam a mostrar pastas órfãs automaticamente.
- `migrateLegacyDomains()` (boot) chama o sync mesmo no caminho
  "registry já existe".
- `deleteDomain()`: apaga a **pasta primeiro**; se o `fs.rm` falhar,
  lança erro claro ("feche programas usando a pasta") e **não** mexe no
  registry — sem órfã. `maxRetries` no `fs.rm` para o EBUSY transitório.
- `cloneDomain()`: roda o sync (adota o que já existe), e desduplica o
  slug contra registry **e** pastas do disco — retry cai em
  `<slug>-2/`, nunca colide.
- Controlboard `listProjectsForDomain()`: chama `syncRegistryWithDisk()`
  (add-only, **não** `ensureRegistry()`), para um domínio clonado que
  traz `projects/` no disco sem `projects.json` aparecer com os projetos
  certos no board.

### Fora (YAGNI)

- Remover do registry entradas cuja pasta sumiu (o `toDomainMeta` já
  devolve `hasGit:false` e a UI lida; remoção automática é arriscada).
- UI dedicada de "adotar pasta" — a adoção é automática, não precisa de
  botão.
- Recuperar nome/id originais de um domínio adotado (usa o slug como
  nome, igual `syncRegistryWithDisk` faz para projetos).
- Limpar pastas de clone parcial (sem `.git`) — ficam quietas, o
  `uniqueSlug` desvia delas.

## Decisões de design

| Decisão | Escolha | Por quê |
|---|---|---|
| Reconciliação | Add-only, espelha `syncRegistryWithDisk()` de `files.ts` | Padrão já existente e testado no projeto; nunca destrói dado. |
| Marcadores de "é domínio" | `.git` OU `projects.json` OU `projects/` | Cobre domínio git, domínio local já usado, e clone recém-feito. Pasta de lixo (`autorizacao_git/` com só `.sql`) não é adotada. |
| Nome do domínio adotado | O próprio slug | Nome/id originais não são recuperáveis; mesma escolha de `ensureRegistry`. |
| Quando rodar | `listDomains()`, boot (`migrateLegacyDomains`), e `cloneDomain()` | Os três pontos onde "o que existe no disco" precisa bater com o registry. |
| `deleteDomain` ordem | Pasta primeiro, registry depois | Se a remoção falhar, o domínio continua registrado e íntegro — sem órfã que o sync readotaria logo em seguida. |
| `fs.rm` que falha | Lança erro traduzido (fechar Explorer/watcher) | No WSL/Windows é o caso comum; o usuário precisa saber o que fazer. |
| `cloneDomain` slug | Desduplica contra registry + disco | Sem isso, `git clone` numa pasta existente aborta com erro cru. |
| Board `listProjectsForDomain` | `syncRegistryWithDisk()`, não `ensureRegistry()` | `ensureRegistry` chamaria `migrateLegacy()` e materializaria projeto "default"; o sync só adota o que já está lá. |

## Arquitetura

### `server/domains.ts`

```ts
async function domainSlugsOnDisk(): Promise<string[]>          // readdir data/domains/
async function looksLikeDomain(slug): Promise<boolean>         // .git | projects.json | projects/
export async function syncDomainsRegistryWithDisk(): Promise<string[]>  // add-only

export async function listDomains() {
  await syncDomainsRegistryWithDisk();
  // ... como antes
}

export async function cloneDomain(url, name?) {
  await syncDomainsRegistryWithDisk();
  const taken = new Set([...registrySlugs, ...await domainSlugsOnDisk()]);
  const slug = uniqueSlug(toSlug(baseName), [...taken]);
  // ...
}

export async function deleteDomain(id) {
  // valida id no registry
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    throw new Error(`Não foi possível apagar "${dir}": ... Feche programas ...`, { cause: err });
  }
  // só agora: splice + writeDomainsRegistry + limpar activeDomain
}

export async function migrateLegacyDomains() {
  if (alreadyMigrated) { await syncDomainsRegistryWithDisk(); return; }
  // ... migração ...
  await registerDomain('Local', 'local');
  await syncDomainsRegistryWithDisk();
}
```

### `server/routes/controlboardRoutes.ts`

`listProjectsForDomain(slug)` passa a chamar
`await syncRegistryWithDisk().catch(() => {})` depois do
`setActiveDomainSlug(slug)`.

### Sem mudança

`server/git.ts`, layout em disco, `.gitignore`, frontend do app,
`server/files.ts` (só passa a exportar `syncRegistryWithDisk`, que já era
exportado).

## Critérios de aceitação

1. Pasta `data/domains/lakehouse-data-modeler/` com `.git`, ausente do
   `domains.json` → `listDomains()` a registra e devolve com
   `hasGit: true`. O board a mostra sem re-clone.
2. Pasta `data/domains/autorizacao_git/` só com `.sql` → **não** é
   adotada.
3. `deleteDomain` com `fs.rm` falhando (EBUSY) → lança
   `/não foi possível apagar/`, o domínio continua em `listDomains()`, a
   pasta continua em disco.
4. `cloneDomain(url, 'src')` com `data/domains/src/` já ocupada por lixo
   → clona para `src-2/`, sem erro de "destination path already exists".
5. `syncDomainsRegistryWithDisk()` chamado 2x → segunda vez retorna `[]`.
6. `npm test` e `npm run typecheck` passam; testes novos cobrem 1–5.

## Testes

`server/__tests__/domains.test.ts`:

- adota pasta órfã com `.git` (git real); adota com `projects.json` e
  ignora pasta de lixo; idempotência.
- `deleteDomain` com `vi.spyOn(fs, 'rm').mockRejectedValueOnce(EBUSY)` →
  registry intacto, pasta intacta.
- `cloneDomain` com pasta-alvo ocupada → slug `-2`.

Regressão implícita: `domainRoutes.test.ts` e `controlboardRoutes.test.ts`
continuam verdes (o sync é add-only e não altera o resultado quando o
registry já bate com o disco).

## Checklist manual (o caso do usuário)

1. `npm run dev` → controlboard. O domínio `lakehouse-data-modeler`
   aparece na lista (foi adotado do disco).
2. Abrir uma instância dele funciona.
3. "Apagar domínio" com o Explorer aberto na pasta → erro claro pedindo
   para fechar o Explorer; a pasta e o registro continuam lá.
4. Fechar o Explorer, apagar de novo → some da lista e do disco.
