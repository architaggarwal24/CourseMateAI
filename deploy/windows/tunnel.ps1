<#
.SYNOPSIS
  One-time: create the Cloudflare Tunnel for CourseMate and point your hostname at it (docs/deploy-windows.md).

.DESCRIPTION
  Needs a domain on Cloudflare (free plan is fine). Opens the browser once to log cloudflared in, creates a tunnel
  named "coursemate", adds the DNS record for -Hostname, and writes deploy\windows\cloudflared.yml.

  No domain yet? Skip this and run  .\deploy\windows\start.ps1 -Quick  for a temporary https://*.trycloudflare.com
  address (it changes every start; fine for a quick try with a friend).

.EXAMPLE
  .\deploy\windows\tunnel.ps1 -Hostname study.example.com
#>
param(
    [Parameter(Mandatory = $true)][string]$Hostname,
    [string]$Name = "coursemate"
)
. "$PSScriptRoot\common.ps1"
if (-not (Has "cloudflared")) { Fail "cloudflared not found:  winget install --id Cloudflare.cloudflared" }

$cfDir = Join-Path $env:USERPROFILE ".cloudflared"
if (-not (Test-Path (Join-Path $cfDir "cert.pem"))) {
    Step "Logging cloudflared in (a browser window opens: pick your domain)"
    & cloudflared tunnel login
    if ($LASTEXITCODE -ne 0) { Fail "cloudflared login failed." }
}

Step "Tunnel '$Name'"
$list = (& cloudflared tunnel list --output json) | ConvertFrom-Json
$tunnel = $list | Where-Object { $_.name -eq $Name } | Select-Object -First 1
if (-not $tunnel) {
    & cloudflared tunnel create $Name
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the tunnel." }
    $tunnel = ((& cloudflared tunnel list --output json) | ConvertFrom-Json) | Where-Object { $_.name -eq $Name } | Select-Object -First 1
}
$id = $tunnel.id
Ok "tunnel id $id"

Step "DNS: $Hostname -> tunnel"
& cloudflared tunnel route dns $Name $Hostname
if ($LASTEXITCODE -ne 0) { Warn "route dns failed: if the record already exists for another target, remove it in the Cloudflare dashboard and run this again." }

$creds = Join-Path $cfDir "$id.json"
(Get-Content (Join-Path $PSScriptRoot "cloudflared.example.yml") -Raw).
    Replace("__TUNNEL_ID__", $id).Replace("__CREDENTIALS__", $creds).Replace("__HOSTNAME__", $Hostname) |
    Set-Content -Path $TunnelCfg -Encoding UTF8
Ok "wrote deploy\windows\cloudflared.yml"

if (Test-Path $EnvFile) {
    Set-EnvValue "ALLOWED_ORIGIN" "https://$Hostname"
    Ok "backend\.env: ALLOWED_ORIGIN = https://$Hostname"
}
Say "Start everything with  .\deploy\windows\start.ps1   then open https://$Hostname"
