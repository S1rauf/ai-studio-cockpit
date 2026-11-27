$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeExe = Join-Path $root 'bridge.exe'
$officeExe = Join-Path $root 'modules\office_agent.exe'

Write-Host "=== AI Studio Cockpit Installer ===" -ForegroundColor Cyan

if (!(Test-Path $bridgeExe)) {
    if (Get-Command go -ErrorAction SilentlyContinue) {
        Write-Host "[1/4] Building bridge.exe..."
        Push-Location (Join-Path $root 'go_bridge')
        go build -ldflags="-H windowsgui" -o $bridgeExe .
        Pop-Location
    } else {
        Write-Error "bridge.exe not found and Go is not installed."
    }
} else {
    Write-Host "[1/4] bridge.exe found."
}

if (!(Test-Path $officeExe)) {
    if (Get-Command go -ErrorAction SilentlyContinue) {
        Write-Host "[2/4] Building modules\office_agent.exe..."
        Push-Location (Join-Path $root 'modules\office_agent')
        go build -o $officeExe .
        Pop-Location
    } else {
        Write-Warning "Go not found — office_agent.exe skipped."
    }
} else {
    Write-Host "[2/4] office_agent.exe found."
}

Write-Host "[3/4] Setting COCKPIT_HOME and cockpit:// protocol..."
[Environment]::SetEnvironmentVariable('COCKPIT_HOME', $root, 'User')
$env:COCKPIT_HOME = $root
reg add "HKCU\Software\Classes\cockpit" /ve /d "URL:AI Studio Cockpit" /f | Out-Null
reg add "HKCU\Software\Classes\cockpit" /v "URL Protocol" /d "" /f | Out-Null
reg add "HKCU\Software\Classes\cockpit\shell\open\command" /ve /d "`"$bridgeExe`"" /f | Out-Null

Write-Host "[4/4] Starting bridge.exe..."
Get-Process -Name bridge -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process $bridgeExe

Write-Host "`nDone! Open chrome://extensions -> Developer mode -> Load unpacked -> $root" -ForegroundColor Green