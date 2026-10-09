$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot '.runtime\server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No managed server PID found.'; exit 0 }
$serverPid = [int](Get-Content -LiteralPath $pidFile)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid"
$expectedPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if ($process -and $process.ExecutablePath -eq $expectedPython -and $process.CommandLine -like '*uvicorn backend.app.main:app*') {
    # Windows venv python.exe is a redirector; stop its verified uvicorn child too.
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $serverPid"
    foreach ($child in $children) {
        if ($child.CommandLine -like '*uvicorn backend.app.main:app*') {
            Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        }
    }
    Stop-Process -Id $serverPid -ErrorAction SilentlyContinue
    Write-Host 'Photo library server stopped. Originals are untouched.'
} elseif ($process) { throw 'PID belongs to another process; refusing to stop it.' }
Remove-Item -LiteralPath $pidFile -Force
