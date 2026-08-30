# Windows validation script for Chatbot-api
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "==> typecheck"
npm run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> ensure mock"
$npmCmd = "npm.cmd"
$npmResolved = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmResolved) { $npmCmd = $npmResolved.Source }

$mock = Start-Process -PassThru -NoNewWindow -FilePath $npmCmd -ArgumentList @("run", "mock") -WorkingDirectory (Get-Location).Path
Start-Sleep -Seconds 3

try {
  $up = $false
  for ($i = 0; $i -lt 10; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:4173/" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $up) { throw "Mock did not become ready on :4173" }

  Write-Host "==> smoke"
  npm run smoke
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "==> tests"
  $env:MOCK_URL = "http://127.0.0.1:4173"
  npm test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "validate.ps1 OK"
}
finally {
  if ($null -ne $mock -and -not $mock.HasExited) {
    Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
  }
}
