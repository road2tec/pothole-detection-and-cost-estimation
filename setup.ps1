# One-terminal setup and start for Windows (PowerShell).
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Safe to re-run: existing .env files, virtualenv and accounts are kept.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function RandomHex($bytes) { node -e "console.log(require('crypto').randomBytes($bytes).toString('hex'))" }

Step 'Checking prerequisites'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js 20+ is required: https://nodejs.org' }
Write-Host "Node $(node -v)"
$py = $null
foreach ($cand in @('py -3.12', 'py -3.11', 'py -3.10', 'python')) {
  $exe, $arg = $cand.Split(' ', 2)
  if (Get-Command $exe -ErrorAction SilentlyContinue) {
    $ver = if ($arg) { & $exe $arg --version 2>$null } else { & $exe --version 2>$null }
    if ($ver -match 'Python 3\.(1[0-2])') { $py = $cand; Write-Host "$ver ($cand)"; break }
  }
}
if (-not $py) { Fail 'Python 3.10-3.12 is required: https://www.python.org/downloads/' }
$mongo = Test-NetConnection -ComputerName 127.0.0.1 -Port 27017 -WarningAction SilentlyContinue
if (-not $mongo.TcpTestSucceeded) { Fail 'MongoDB is not running on localhost:27017. Install/start MongoDB Community Server first.' }
Write-Host 'MongoDB reachable on 27017'

Step 'Installing Node packages (root, server, client)'
npm install --no-fund --no-audit
npm --prefix server install --no-fund --no-audit
npm --prefix client install --no-fund --no-audit

Step 'Setting up the Python AI service'
if (-not (Test-Path 'ai-service\.venv\Scripts\python.exe')) {
  $exe, $arg = $py.Split(' ', 2)
  if ($arg) { & $exe $arg -m venv ai-service\.venv } else { & $exe -m venv ai-service\.venv }
}
& ai-service\.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
& ai-service\.venv\Scripts\python.exe -m pip install -r ai-service\requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { Fail 'Python dependency installation failed' }

Step 'Creating configuration files'
$token = RandomHex 24
if (-not (Test-Path 'ai-service\.env')) {
  (Get-Content 'ai-service\.env.example') -replace '^AI_SERVICE_TOKEN=.*', "AI_SERVICE_TOKEN=$token" | Set-Content 'ai-service\.env' -Encoding utf8
  Write-Host 'Created ai-service\.env'
} else {
  $token = ((Get-Content 'ai-service\.env') | Where-Object { $_ -match '^AI_SERVICE_TOKEN=' }) -replace '^AI_SERVICE_TOKEN=', ''
  Write-Host 'Keeping existing ai-service\.env'
}
if (-not (Test-Path 'server\.env')) {
  (Get-Content 'server\.env.example') `
    -replace '^JWT_ACCESS_SECRET=.*', "JWT_ACCESS_SECRET=$(RandomHex 48)" `
    -replace '^JWT_REFRESH_SECRET=.*', "JWT_REFRESH_SECRET=$(RandomHex 48)" `
    -replace '^AI_SERVICE_TOKEN=.*', "AI_SERVICE_TOKEN=$token" | Set-Content 'server\.env' -Encoding utf8
  Write-Host 'Created server\.env'
} else { Write-Host 'Keeping existing server\.env' }

Step 'Administrator account'
$check = npm --prefix server run --silent has-admin 2>$null | Select-Object -Last 1
if ($check -eq 'yes') {
  Write-Host 'An administrator already exists.'
} else {
  $email = Read-Host 'Admin email'
  $name = Read-Host 'Admin full name'
  $env:ADMIN_EMAIL = $email; $env:ADMIN_NAME = $name
  npm --prefix server run bootstrap:admin
  Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_NAME
}

Step 'Starting AI service (:8000), API (:4000) and web app (:5173)'
Write-Host 'Open http://localhost:5173  -  press Ctrl+C to stop everything.' -ForegroundColor Green
Write-Host 'First start downloads the pretrained model weights (~150 MB) once.' -ForegroundColor Yellow
npm run dev
