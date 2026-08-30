# Windows validation script for Chatbot-api
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "==> typecheck"
npm run typecheck

Write-Host "==> ensure mock"
$mock = Start-Process -PassThru -NoNewWindow npm -ArgumentList "run","mock"
Start-Sleep -Seconds 2

try {
  Write-Host "==> smoke"
  npm run smoke

  Write-Host "==> tests"
  $env:MOCK_URL = "http://127.0.0.1:4173"
  npm test

  Write-Host "validate.ps1 OK"
}
finally {
  if ($mock -and -not $mock.HasExited) {
    Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
  }
}
