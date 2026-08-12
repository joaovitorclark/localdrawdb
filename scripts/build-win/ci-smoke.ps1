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
vezes, antes e depois de mover o diretório extraído.
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

Write-Host "OK: $PackageDir"
