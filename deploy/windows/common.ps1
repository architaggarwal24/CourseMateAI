# Shared by the CourseMate Windows scripts (docs/deploy-windows.md). Dot-source it: . "$PSScriptRoot\common.ps1"
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root      = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Backend   = Join-Path $Root "backend"
$Frontend  = Join-Path $Root "frontend"
$RunDir    = Join-Path $PSScriptRoot ".run"
$LogDir    = Join-Path $Root "logs"
$BackupDir = Join-Path $Root "backups"
$VenvPy    = Join-Path $Backend ".venv\Scripts\python.exe"
$EnvFile   = Join-Path $Backend ".env"
$TunnelCfg = Join-Path $PSScriptRoot "cloudflared.yml"
$PidFile   = Join-Path $RunDir "pids.json"

function Say($text)  { Write-Host "  $text" }
function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "  OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  !!  $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "  XX  $text" -ForegroundColor Red; exit 1 }

function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# The Python to build the virtualenv with: the py launcher's 3.13/3.12/3.11, else python on PATH.
function Find-Python {
    if (Has "py") {
        foreach ($v in @("3.13", "3.12", "3.11")) {
            & py "-$v" -c "import sys" 2>$null
            if ($LASTEXITCODE -eq 0) { return @("py", "-$v") }
        }
    }
    if (Has "python") {
        $ver = & python -c "import sys; print('%d.%d' % sys.version_info[:2])"
        if ([version]$ver -ge [version]"3.11") { return @("python") }
    }
    return $null
}

# Run the Python that Find-Python chose (@("py", "-3.13") or @("python")) with more arguments.
function Invoke-BasePython([string[]]$PyCmd, [string[]]$Arguments) {
    $exe = $PyCmd[0]
    $pre = @($PyCmd | Select-Object -Skip 1)
    & $exe @pre @Arguments
}

# Read one KEY=value from backend\.env (comments and blank lines ignored).
function Get-EnvValue($name) {
    if (-not (Test-Path $EnvFile)) { return "" }
    foreach ($line in Get-Content $EnvFile) {
        if ($line -match "^\s*$name\s*=\s*(.*)$") { return $Matches[1].Trim() }
    }
    return ""
}

function Set-EnvValue($name, $value) {
    $lines = @(Get-Content $EnvFile)
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*#?\s*$name\s*=") { $lines[$i] = "$name=$value"; $found = $true; break }
    }
    if (-not $found) { $lines += "$name=$value" }
    Set-Content -Path $EnvFile -Value $lines -Encoding UTF8
}

function Wait-Http($url, $seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -lt 500) { return $true }
        } catch { Start-Sleep -Milliseconds 700 }
    }
    return $false
}
