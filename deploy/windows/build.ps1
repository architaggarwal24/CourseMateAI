<#
.SYNOPSIS
  Build the frontend for production (docs/deploy-windows.md). Run after setup.ps1 and after every update.

.DESCRIPTION
  next build makes a self-contained server (.next\standalone); its static files and public\ are copied next to
  it so `node .next\standalone\server.js` serves everything. The /api rewrite points at the backend on this PC.
#>
param([string]$BackendUrl = "http://127.0.0.1:8000")
. "$PSScriptRoot\common.ps1"

Step "Building the frontend (a few minutes)"
Push-Location $Frontend
try {
    $env:BACKEND_URL = $BackendUrl
    $env:NEXT_TELEMETRY_DISABLED = "1"
    & npm run build
    if ($LASTEXITCODE -ne 0) { Fail "next build failed (see above)." }
    $standalone = Join-Path $Frontend ".next\standalone"
    foreach ($pair in @(@(".next\static", ".next\static"), @("public", "public"))) {
        $to = Join-Path $standalone $pair[1]
        if (Test-Path $to) { Remove-Item -Recurse -Force $to }          # else Copy-Item nests it one level down
        Copy-Item -Recurse (Join-Path $Frontend $pair[0]) $to
    }
} finally { Pop-Location }
Ok "built: frontend\.next\standalone"
Say "Start it with  .\deploy\windows\start.ps1"
