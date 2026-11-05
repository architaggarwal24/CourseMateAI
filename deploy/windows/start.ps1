<#
.SYNOPSIS
  Start CourseMate for testers: Ollama (if used), the backend, the frontend and the Cloudflare Tunnel.

.DESCRIPTION
  Each runs in the background with its log in logs\ (backend.log, frontend.log, tunnel.log). The script waits
  until the backend and frontend answer, prints the address, then returns; stop.ps1 stops everything.
  -Quick: a temporary https://*.trycloudflare.com address instead of your own hostname (no tunnel.ps1 needed;
  the address changes every start, and the frontend proxies /api itself).
  -BackendOnly: only the backend (and Ollama) and the tunnel, for while the app itself runs on Cloudflare Workers
  (Phase 4, docs/deploy-cloudflare.md): the Worker forwards what it doesn't answer yet to this PC.

.EXAMPLE
  .\deploy\windows\start.ps1
  .\deploy\windows\start.ps1 -Quick
  .\deploy\windows\start.ps1 -BackendOnly
#>
param([switch]$Quick, [switch]$NoTunnel, [switch]$BackendOnly)
. "$PSScriptRoot\common.ps1"

if (-not (Test-Path $VenvPy)) { Fail "Run .\deploy\windows\setup.ps1 first." }
if (-not (Test-Path $EnvFile)) { Fail "backend\.env is missing: run .\deploy\windows\setup.ps1." }
$server = Join-Path $Frontend ".next\standalone\server.js"
if (-not $BackendOnly -and -not (Test-Path $server)) { Fail "The frontend isn't built: run .\deploy\windows\build.ps1." }
if ((Test-Path $PidFile)) { Warn "CourseMate may already be running (deploy\windows\.run\pids.json). Run stop.ps1 first if it isn't." }
New-Item -ItemType Directory -Force -Path $RunDir, $LogDir | Out-Null
$pids = @{}

function Start-Bg($name, $exe, [string[]]$arguments, $workdir, [hashtable]$envs = @{}) {
    foreach ($k in $envs.Keys) { Set-Item -Path "env:$k" -Value $envs[$k] }
    $log = Join-Path $LogDir "$name.log"
    $p = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $workdir -WindowStyle Hidden `
         -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru
    $pids[$name] = $p.Id
    Ok "$name started (pid $($p.Id), log logs\$name.log)"
}

# ── Ollama (only when the backend is set to use it) ─────────────────────────────────────────────────────────
$local = Get-EnvValue "LOCAL_LLM"
if ($local -like "ollama:*") {
    $base = Get-EnvValue "LOCAL_LLM_BASE_URL"; if (-not $base) { $base = "http://localhost:11434" }
    if (Wait-Http "$base/api/tags" 2) { Ok "Ollama is running" }
    elseif (Has "ollama") {
        Start-Bg "ollama" "ollama" @("serve") $Root
        if (-not (Wait-Http "$base/api/tags" 20)) { Warn "Ollama didn't answer: small AI jobs will use the API instead." }
    } else { Warn "LOCAL_LLM is Ollama but Ollama isn't installed: small AI jobs will use the API." }
}

# ── backend (production: no reload, one worker; the tunnel's X-Forwarded-* are trusted from this PC) ─────────
Step "Backend"
Start-Bg "backend" $VenvPy @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000",
                             "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1", "--timeout-keep-alive", "75") $Backend
if (-not (Wait-Http "http://127.0.0.1:8000/api/v1/health" 90)) { Fail "The backend didn't start: see logs\backend.log.err" }
Ok "backend answers on http://127.0.0.1:8000"

# ── frontend (the standalone Next.js server) ───────────────────────────────────────────────────────────────
if (-not $BackendOnly) {
    Step "Frontend"
    # BACKEND_URL: where the frontend forwards the /api calls it doesn't answer itself (read at start, not at build).
    Start-Bg "frontend" "node" @($server) (Split-Path $server) @{ PORT = "3000"; HOSTNAME = "127.0.0.1"; NODE_ENV = "production"; BACKEND_URL = "http://127.0.0.1:8000" }
    if (-not (Wait-Http "http://127.0.0.1:3000/login" 60)) { Fail "The frontend didn't start: see logs\frontend.log.err" }
    Ok "frontend answers on http://127.0.0.1:3000"
}

# ── tunnel ─────────────────────────────────────────────────────────────────────────────────────────────────
if (-not $NoTunnel) {
    Step "Cloudflare Tunnel"
    if (-not (Has "cloudflared")) { Fail "cloudflared not found:  winget install --id Cloudflare.cloudflared" }
    if ($Quick) {
        $target = if ($BackendOnly) { "http://127.0.0.1:8000" } else { "http://127.0.0.1:3000" }
        Start-Bg "tunnel" "cloudflared" @("tunnel", "--no-autoupdate", "--url", $target) $Root
        $url = $null
        foreach ($i in 1..40) {
            Start-Sleep -Milliseconds 750
            $text = (Get-Content "$LogDir\tunnel.log.err" -Raw -ErrorAction SilentlyContinue) + (Get-Content "$LogDir\tunnel.log" -Raw -ErrorAction SilentlyContinue)
            if ($text -match "https://[a-z0-9-]+\.trycloudflare\.com") { $url = $Matches[0]; break }
        }
        if ($url) { Ok "public address: $url   (temporary: changes on every start)" }
        else { Warn "No address yet: look in logs\tunnel.log.err" }
    } else {
        if (-not (Test-Path $TunnelCfg)) { Fail "No deploy\windows\cloudflared.yml: run .\deploy\windows\tunnel.ps1 -Hostname <yours> once (or start.ps1 -Quick)." }
        Start-Bg "tunnel" "cloudflared" @("tunnel", "--no-autoupdate", "--config", $TunnelCfg, "run") $Root
        $origin = Get-EnvValue "ALLOWED_ORIGIN"
        if ($BackendOnly) { Ok "the backend is reachable through your tunnel hostname (the app: $origin)" }
        else { Ok "public address: $origin" }
    }
}

$pids | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8
Step "CourseMate is running"
Say "Logs: logs\   Stop: .\deploy\windows\stop.ps1   Backup: .\deploy\windows\backup.ps1"
Say "Invite testers:  cd backend; .\.venv\Scripts\python.exe scripts\admin.py invite create --tier sage --days 30 --uses 20"
