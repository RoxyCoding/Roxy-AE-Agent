# Installs the built CEP extension for the current user (development mode).
#  1. Sets PlayerDebugMode=1 for CEP 11 (AE 2024) and CEP 12 (AE 2025/2026) so the unsigned extension loads.
#  2. Links %APPDATA%\Adobe\CEP\extensions\com.roxy.aeagent.cep -> apps/ae-cep-plugin/dist (directory junction).
# Run after `npm run build`. Restart After Effects afterwards.
$ErrorActionPreference = "Stop"

$dist = Join-Path $PSScriptRoot "..\dist" | Resolve-Path
if (-not (Test-Path (Join-Path $dist "CSXS\manifest.xml"))) { throw "dist/ is not built. Run 'npm run build' first." }

foreach ($v in @("11", "12")) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  Set-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -Type String
  Write-Host "PlayerDebugMode=1 set for CSXS.$v"
}

$extRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
New-Item -ItemType Directory -Force -Path $extRoot | Out-Null
$link = Join-Path $extRoot "com.roxy.aeagent.cep"
if (Test-Path $link) {
  $item = Get-Item $link -Force
  if ($item.LinkType -eq "Junction") { Write-Host "Already linked: $link -> $($item.Target)"; exit 0 }
  throw "$link exists and is not a junction created by this script. Remove it manually if you want to replace it."
}
New-Item -ItemType Junction -Path $link -Target $dist | Out-Null
Write-Host "Linked $link -> $dist"
Write-Host "Restart After Effects, then open Window > Extensions > Roxy AE Agent."
