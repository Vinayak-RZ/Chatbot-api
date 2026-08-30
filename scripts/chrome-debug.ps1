# Launch Chrome with remote debugging so Chatbot-api can attach (CDP).
# Close ALL Chrome windows first, then run this script, then open your chatbot and log in.
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
Write-Host "  CDP_URL=http://127.0.0.1:$Port"
Write-Host "  CHATBOT_URL=<your chatbot link>"
Write-Host "  HEADLESS=false"
Write-Host ""
Write-Host "Log in in that window, leave the chatbot tab open, then: npm run dev"

Start-Process -FilePath $chrome -ArgumentList $args
