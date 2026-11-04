<#
.SYNOPSIS
  One-time setup of CourseMate on this PC for testers (docs/deploy-windows.md).

.DESCRIPTION
  Checks the tools, makes the backend's virtualenv and installs its packages, installs the frontend's, and writes
  backend\.env from deploy\windows\backend.env.example with fresh secrets. Safe to run again: an existing .env
  is kept (only missing secrets are filled in).

.EXAMPLE
  .\deploy\windows\setup.ps1 -Hostname study.example.com
#>
param(
    [string]$Hostname = "",          # your tunnel hostname (study.example.com); can be set later in backend\.env
    [switch]$SkipOllama              # don't pull the local model
)
. "$PSScriptRoot\common.ps1"

Step "Checking the tools"
$py = Find-Python
if (-not $py) { Fail "Python 3.11+ not found. Install Python 3.13 from python.org (tick 'Add to PATH'), then run this again." }
Ok "Python: $((Invoke-BasePython $py @("--version")) 2>&1)"
if (-not (Has "node")) { Fail "Node.js not found. Install Node 22 LTS from nodejs.org, then run this again." }
$nodeMajor = [int](((& node --version) -replace "^v", "").Split(".")[0])
if ($nodeMajor -lt 20) { Fail "Node $nodeMajor is too old: install Node 22 LTS." }
Ok "Node: $(& node --version)"
if (Has "cloudflared") { Ok "cloudflared: $((& cloudflared --version) 2>&1 | Select-Object -First 1)" }
else { Warn "cloudflared not found. Install it:  winget install --id Cloudflare.cloudflared   (needed by tunnel.ps1 / start.ps1)" }
$haveOllama = Has "ollama"
if ($haveOllama) { Ok "Ollama found" } else { Warn "Ollama not found (optional): https://ollama.com/download - small AI jobs then use your API key" }

Step "Backend: virtualenv and packages"
if (-not (Test-Path $VenvPy)) {
    Invoke-BasePython $py @("-m", "venv", (Join-Path $Backend ".venv"))
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the virtualenv." }
}
& $VenvPy -m pip install --upgrade pip --quiet
& $VenvPy -m pip install -r (Join-Path $Backend "requirements.txt")
if ($LASTEXITCODE -ne 0) { Fail "pip install failed (see above)." }
Ok "backend packages installed"

Step "Frontend: packages"
Push-Location $Frontend
try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { Fail "npm ci failed (see above)." }
} finally { Pop-Location }
Ok "frontend packages installed"

Step "backend\.env"
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $PSScriptRoot "backend.env.example") $EnvFile
    Ok "created backend\.env from the template"
} else { Ok "backend\.env exists: kept" }
if ((Get-EnvValue "JWT_SECRET") -in @("", "__GENERATED__")) {
    Set-EnvValue "JWT_SECRET" (& $VenvPy -c "import secrets; print(secrets.token_urlsafe(48))")
    Ok "JWT_SECRET generated"
}
if ((Get-EnvValue "ENCRYPTION_KEY") -in @("", "__GENERATED__")) {
    Set-EnvValue "ENCRYPTION_KEY" (& $VenvPy -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
    Ok "ENCRYPTION_KEY generated (back it up: without it saved API keys can't be read)"
}
if ($Hostname) {
    Set-EnvValue "ALLOWED_ORIGIN" "https://$Hostname"
    Ok "ALLOWED_ORIGIN = https://$Hostname"
}
if (-not (Get-EnvValue "GOOGLE_API_KEY") -and -not (Get-EnvValue "OPENAI_API_KEY") -and -not (Get-EnvValue "ANTHROPIC_API_KEY") -and -not (Get-EnvValue "NVIDIA_API_KEY")) {
    Warn "No server AI key in backend\.env yet: add GOOGLE_API_KEY (or another) so testers need no key of their own."
}

if ($haveOllama -and -not $SkipOllama) {
    $local = Get-EnvValue "LOCAL_LLM"
    if ($local -like "ollama:*") {
        $model = $local.Substring(7)
        Step "Ollama: pulling $model (once; a few GB)"
        & ollama pull $model
        if ($LASTEXITCODE -ne 0) { Warn "ollama pull failed: start Ollama and run  ollama pull $model" } else { Ok "$model ready" }
    }
}

Step "Done"
Say "Next:  .\deploy\windows\build.ps1     then  .\deploy\windows\tunnel.ps1 -Hostname <yours>  (once)"
Say "       .\deploy\windows\start.ps1     starts everything;  .\deploy\windows\stop.ps1  stops it"
