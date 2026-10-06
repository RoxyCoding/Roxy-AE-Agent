# Sideloads the Roxy AE Agent UXP plugin into After Effects (Beta) WITHOUT UXP Developer Tool.
#
# After Effects loads every plugin folder in "<AE>\Support Files\UXP\plugins" at startup (that is where
# Adobe's own bundled UXP plugins live). This script creates a directory junction there pointing to
# apps/ae-plugin/dist, so rebuilding updates the plugin in place (restart AE to reload).
#
# - Unofficial: not documented by Adobe. An AE update may remove the junction (just run this again).
# - Needs administrator rights (Program Files); the script asks for elevation.
# - Only the junction is created/removed; nothing inside the AE installation is modified.
#
# Usage: npm run sideload:plugin    (build + install)
#        npm run unsideload:plugin  (uninstall)
param(
  [switch]$Remove,
  [switch]$Elevated,
  [string]$AeDir = "C:\Program Files\Adobe\Adobe After Effects (Beta)"
)
$ErrorActionPreference = "Stop"

function Finish([int]$code) {
  # The elevated window closes on exit; keep it open so the result can be read.
  if ($Elevated) { Read-Host "Press Enter to close" | Out-Null }
  exit $code
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-AeDir", "`"$AeDir`"", "-Elevated")
  if ($Remove) { $argList += "-Remove" }
  Write-Host "Requesting administrator rights (a new window will open)..."
  $p = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs -Wait -PassThru
  if ($p.ExitCode -eq 0) { Write-Host "Done." } else { Write-Host "Failed (see the elevated window output)." }
  exit $p.ExitCode
}

try {
  $pluginsDir = Join-Path $AeDir "Support Files\UXP\plugins"
  if (-not (Test-Path $pluginsDir)) { throw "UXP plugins folder not found: $pluginsDir (is After Effects (Beta) installed there? use -AeDir)" }
  $link = Join-Path $pluginsDir "com.roxy.aeagent"

  if ($Remove) {
    if (Test-Path $link) {
      $item = Get-Item $link -Force
      if ($item.LinkType -ne "Junction") { throw "$link is not a junction created by this script; not removing it." }
      [System.IO.Directory]::Delete($link, $false)  # removes the link only
      Write-Host "Removed $link"
    } else {
      Write-Host "Not installed: $link"
    }
    Finish 0
  }

  $dist = Join-Path $PSScriptRoot "..\dist" | Resolve-Path
  if (-not (Test-Path (Join-Path $dist "manifest.json"))) { throw "dist/ is not built. Run 'npm run build' first." }
  if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.LinkType -eq "Junction") { Write-Host "Already linked: $link -> $($item.Target)"; Finish 0 }
    throw "$link exists and is not a junction created by this script. Remove it manually if you want to replace it."
  }
  New-Item -ItemType Junction -Path $link -Target $dist | Out-Null
  Write-Host "Linked $link -> $dist"
  Write-Host "Restart After Effects (Beta) and open the Roxy AE Agent panel."
  Finish 0
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Finish 1
}
