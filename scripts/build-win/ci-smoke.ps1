<#
Fumaça do pacote Windows em CI (windows-latest): sobe o LocalDrawDB.exe já
extraído (sem -Verb RunAs — nenhuma elevação solicitada), espera /api/meta
responder, valida gitAvailable/activeDomain, encerra e confere que o
node.exe filho não fica órfão.

Cobre, automatizado, os itens 1/2/3/4/6 do checklist manual em
scripts/build-win/README.md. O item 7 (fechar a janela) é aproximado via
taskkill sem /F (fecha o processo como o Windows faria ao fechar a janela
do console); quando esse caminho não fecha a tempo, o script cai para
taskkill /F e avisa em vez de falhar — matar à força não passa pelo
handler de SIGINT do launcher, então não prova nada sobre esse item.
O item 5 (mover a pasta) é validado no workflow chamando este script duas
vezes, antes e depois de mover o diretório extraído — por isso este script
também encerra e espera sair qualquer msedge.exe que o launcher tenha aberto
(detached do launcher, não morre sozinho): sem isso o Edge fica de pé
segurando handles dentro da pasta e o Move-Item do passo seguinte falha de
forma intermitente.
#>
param(
    [Parameter(Mandatory = $true)][string]$PackageDir,
    [switch]$StripGit,
    [bool]$ExpectGitAvailable = $true,
    [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

$exePath = Join-Path $PackageDir 'LocalDrawDB.exe'
if (-not (Test-Path $exePath)) {
    throw "LocalDrawDB.exe não encontrado em $PackageDir"
}

if ($StripGit) {
    $filtered = ($env:PATH -split ';') | Where-Object { $_ -and ($_ -notmatch 'Git') }
    $env:PATH = ($filtered -join ';')
    Write-Host "PATH sem git para este teste."
}

$before = @(Get-Process node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
# windows-latest TEM Edge — o launcher realmente spawna msedge.exe com
# --user-data-dir dentro de $PackageDir. Snapshot de antes, no mesmo padrão
# do $before acima, pra depois saber quais msedge.exe surgiram nesta execução
# (e não matar um Edge que já estivesse aberto por outro motivo no runner).
$edgeBefore = @(Get-Process msedge -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)

# stdio: 'inherit' no launcher não vai a lugar nenhum sob -WindowStyle Hidden
# sem redirecionar explicitamente — sem isso, uma falha de boot vira só um
# timeout mudo. Os logs viram artefato do job em caso de falha.
$stdoutLog = Join-Path $env:RUNNER_TEMP "$(Split-Path $PackageDir -Leaf)-stdout.log"
$stderrLog = Join-Path $env:RUNNER_TEMP "$(Split-Path $PackageDir -Leaf)-stderr.log"

Write-Host "Iniciando $exePath ..."
$proc = Start-Process -FilePath $exePath -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

$meta = $null
$foundPort = $null
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline -and -not $meta) {
    if ($proc.HasExited) {
        Write-Host "--- stdout ---"; Get-Content $stdoutLog -ErrorAction SilentlyContinue
        Write-Host "--- stderr ---"; Get-Content $stderrLog -ErrorAction SilentlyContinue
        throw "LocalDrawDB.exe encerrou sozinho (código $($proc.ExitCode)) antes de responder — ver stdout/stderr acima."
    }
    foreach ($port in 5174..5199) {
        try {
            $meta = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/meta" -TimeoutSec 1 -ErrorAction Stop
            $foundPort = $port
            break
        } catch {
            continue
        }
    }
    if (-not $meta) { Start-Sleep -Milliseconds 500 }
}

if (-not $meta) {
    Write-Host "--- stdout ---"; Get-Content $stdoutLog -ErrorAction SilentlyContinue
    Write-Host "--- stderr ---"; Get-Content $stderrLog -ErrorAction SilentlyContinue
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    throw "LocalDrawDB não respondeu em /api/meta dentro de ${TimeoutSeconds}s (portas 5174-5199, sem elevação/UAC solicitada)"
}

Write-Host "Respondeu na porta $foundPort. gitAvailable=$($meta.gitAvailable) activeDomain=$($meta.activeDomain)"

if ($meta.gitAvailable -ne $ExpectGitAvailable) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    throw "Esperava gitAvailable=$ExpectGitAvailable, veio $($meta.gitAvailable)"
}
if ($null -ne $meta.activeDomain) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    throw "Esperava activeDomain nulo (picker, sem domínio ativo), veio $($meta.activeDomain)"
}

# Fechamento gracioso primeiro (aproxima fechar a janela do console), com
# fallback a /F só para não deixar o job pendurado.
& taskkill /PID $proc.Id /T 2>$null | Out-Null
$closedGracefully = $proc.WaitForExit(8000)
if (-not $closedGracefully) {
    Write-Warning "Fechamento gracioso não confirmou a tempo — forçando com /F (item 7 do checklist fica sem validar nesta execução)."
    & taskkill /PID $proc.Id /T /F 2>$null | Out-Null
    $proc.WaitForExit(5000) | Out-Null
} else {
    $after = @(Get-Process node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $orphans = $after | Where-Object { $before -notcontains $_ }
    if ($orphans) {
        throw "node.exe órfão após fechamento gracioso: PID(s) $($orphans -join ', ')"
    }
    Write-Host "Fechamento gracioso confirmado, sem node.exe órfão."
}

# openApp usa detached: true + unref(): encerrar o launcher (acima) NÃO leva o
# Edge junto — a janela de app fica de pé sozinha, segurando handles abertos
# em $PackageDir\data\edge-profile (mais crashpad/renderers). O Windows recusa
# renomear/mover um diretório enquanto qualquer processo tem handle aberto na
# subárvore, então sem isto o Move-Item do próximo passo do workflow falha de
# forma intermitente — parece um bug ali, mas a causa real é aqui: precisamos
# esperar o Edge soltar o perfil antes de devolver o controle.
$edgeAfter = @(Get-Process msedge -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$edgeSpawned = @($edgeAfter | Where-Object { $edgeBefore -notcontains $_ })
if ($edgeSpawned.Count -gt 0) {
    Write-Host "Encerrando Edge spawnado pelo launcher: PID(s) $($edgeSpawned -join ', ')"
    foreach ($edgePid in $edgeSpawned) {
        Stop-Process -Id $edgePid -Force -ErrorAction SilentlyContinue
    }
    # Não temos o objeto Process (só o PID) pra usar WaitForExit — poll curto
    # até sumirem do Get-Process, que é o sinal de que o handle no perfil foi
    # solto de verdade.
    $edgeDeadline = (Get-Date).AddSeconds(10)
    $stillRunning = @()
    do {
        Start-Sleep -Milliseconds 300
        $stillRunning = @($edgeSpawned | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    } while ($stillRunning.Count -gt 0 -and (Get-Date) -lt $edgeDeadline)
    if ($stillRunning.Count -gt 0) {
        # Não falha o smoke test por causa disso — o boot em si já foi
        # validado. Mas avisa de forma legível, porque o próximo sintoma
        # (Move-Item negado dois passos depois) não apontaria pra cá sozinho.
        Write-Warning "Edge ainda de pé após encerramento forçado: PID(s) $($stillRunning -join ', ') — um Move-Item sobre $PackageDir logo em seguida pode falhar por handle preso."
    } else {
        Write-Host "Edge encerrado, sem handles presos na pasta do pacote."
    }
}

Write-Host "OK: $PackageDir"
