# Optional fallback: launch Chrome/Edge with --remote-debugging-port so Chatbot-api can attach.
# Preferred path (Chrome 144+): leave this unused. Open your existing browser, enable
# remote debugging at chrome://inspect/#remote-debugging, set BROWSER_MODE=attach and
# CDP_URL=chrome in .env. See docs/CUTOVER.md.
#
# Use this script for older Chrome, or a dedicated empty profile (no personal tabs).
# Close ALL Chrome windows first if you reuse the default profile.
#
# Usage:
#   .\scripts\chrome-debug.ps1
#   .\scripts\chrome-debug.ps1 -Port 9222
#   .\scripts\chrome-debug.ps1 -Url "https://your-chatbot.example/"

param(
  [int]$Port = 9222,
  [string]$Url = "",
  [string]$UserDataDir = ""
)

$ErrorActionPreference = "Stop"

$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  throw "Chrome or Edge not found. Install Chrome, or edit this script with the full path to chrome.exe"
}

if (-not $UserDataDir) {
  $UserDataDir = Join-Path $PSScriptRoot "..\data\chrome-debug-profile"
}
$UserDataDir = [System.IO.Path]::GetFullPath($UserDataDir)
New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null

# Fail if something is already listening (likely a previous debug Chrome)
try {
  $existing = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 1
  Write-Host "Port $Port already has a debug browser. Reuse it, or close that Chrome and retry."
  Write-Host $existing.Content
  exit 0
} catch {
  # free — good
}

$args = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$UserDataDir",
  "--no-first-run",
  "--no-default-browser-check"
)
if ($Url) { $args += $Url }

Write-Host "Starting: $chrome"
Write-Host "Debug URL: http://127.0.0.1:$Port"
Write-Host "Profile:   $UserDataDir"
Write-Host "Then set in .env:"
Write-Host "  BROWSER_MODE=attach"
Write-Host "  CDP_URL=http://127.0.0.1:$Port"
Write-Host "  CDP_ATTACH_TAB=focused"
Write-Host "  HEADLESS=false"
Write-Host ""
Write-Host "Focus the chatbot tab, then: npm run dev"

Start-Process -FilePath $chrome -ArgumentList $args
