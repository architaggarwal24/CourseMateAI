<#
.SYNOPSIS
  Stop what start.ps1 started (tunnel first, so nobody reaches a half-stopped app).
#>
. "$PSScriptRoot\common.ps1"
if (-not (Test-Path $PidFile)) { Say "Nothing recorded as running (deploy\windows\.run\pids.json)."; exit 0 }
$pids = Get-Content $PidFile -Raw | ConvertFrom-Json
foreach ($name in @("tunnel", "frontend", "backend", "ollama")) {
    $procId = $pids.PSObject.Properties[$name]
    if (-not $procId) { continue }
    $p = Get-Process -Id $procId.Value -ErrorAction SilentlyContinue
    if ($p) {
        # /T: the whole tree (node and uvicorn may have children)
        & taskkill /PID $procId.Value /T /F | Out-Null
        Ok "$name stopped"
    } else { Say "$name was not running" }
}
Remove-Item $PidFile -Force
Step "Stopped"
