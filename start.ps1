param([switch]$Install, [switch]$AI, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$runtimePath = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
if (-not (Test-Path -LiteralPath $pythonPath)) {
    & python -m venv (Join-Path $projectRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12+ is required. Could not create the virtual environment.' }
    $Install = $true
}
function Install-PythonRequirements([string]$requirements) {
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        & uv pip install --python $pythonPath --cache-dir (Join-Path $projectRoot '.cache\uv') -r $requirements
    } else {
        & $pythonPath -m ensurepip --upgrade
        & $pythonPath -m pip install -r $requirements
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not install $requirements" }
}
if ($Install) {
    Install-PythonRequirements (Join-Path $projectRoot 'backend\requirements.txt')
    & npm.cmd ci --prefix frontend --cache (Join-Path $projectRoot '.cache\npm') --offline=false
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    & npm.cmd run build --prefix frontend
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
}
if ($AI) { Install-PythonRequirements (Join-Path $projectRoot 'backend\requirements-ai.txt') }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend\dist\index.html'))) {
    throw 'Frontend is not built. Run: .\start.ps1 -Install'
}
$health = $null
try { $health = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 } catch {}
if ($health) {
    $libraryConfigPath = Join-Path $projectRoot 'library-config.json'
    $libraryConfig = if (Test-Path -LiteralPath $libraryConfigPath) { Get-Content -LiteralPath $libraryConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $expectedData = if ($env:PHOTO_DATA_DIR) { [IO.Path]::GetFullPath($env:PHOTO_DATA_DIR) } elseif ($libraryConfig.data_dir) { [IO.Path]::GetFullPath($libraryConfig.data_dir) } else { Join-Path $projectRoot 'data' }
    if ($health.version -ne '2.0.0' -or $health.data_dir -ne $expectedData) { throw 'Port 8000 is in use by another library. Stop it before starting this library.' }
} else {
    $serverProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'server.out.log') -RedirectStandardError (Join-Path $runtimePath 'server.err.log')
    $serverProcess.Id | Set-Content -LiteralPath (Join-Path $runtimePath 'server.pid')
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { $health = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 1; break } catch {}
        if ($serverProcess.HasExited) { break }
    }
    if (-not $health) { throw 'Backend did not start. Check .runtime\server.err.log.' }
}
Write-Host 'Photo library is ready: http://127.0.0.1:8000'
Write-Host 'Stop it with: .\stop.ps1'
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8000' }
