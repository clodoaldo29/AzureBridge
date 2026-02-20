param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('primary', 'fallback')]
    [string]$Source,

    [switch]$SkipDocker
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'

if (-not (Test-Path $envPath)) {
    throw "Arquivo .env não encontrado em: $envPath"
}

$content = Get-Content $envPath -Raw
if ($content -match '(?m)^DATABASE_URL_SOURCE=') {
    $updated = [regex]::Replace($content, '(?m)^DATABASE_URL_SOURCE=.*$', "DATABASE_URL_SOURCE=$Source")
} else {
    $separator = if ($content.EndsWith("`n")) { '' } else { "`n" }
    $updated = "$content$separator`nDATABASE_URL_SOURCE=$Source`n"
}

Set-Content -Path $envPath -Value $updated -Encoding utf8
Write-Host "[DB Source] .env atualizado: DATABASE_URL_SOURCE=$Source"

if ($SkipDocker) {
    Write-Host '[DB Source] SkipDocker ativado. Nenhum comando docker executado.'
    exit 0
}

Write-Host '[DB Source] Recriando API com docker compose...'
docker compose up -d --build api | Out-Host

Write-Host '[DB Source] Valor no container:'
docker compose exec api printenv DATABASE_URL_SOURCE | Out-Host

Write-Host '[DB Source] Health check:'
try {
    $health = curl.exe -s http://localhost:3001/api/health
    Write-Host $health
} catch {
    Write-Warning 'Falha ao consultar /api/health.'
}
