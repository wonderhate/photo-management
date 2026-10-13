param([switch]$SkipDependencies, [switch]$UseCurrentLibrary)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (!(Test-Path $python)) { throw '先按 README 建立 .venv 并安装后端依赖。' }
if (!$SkipDependencies) {
    if (Get-Command uv -ErrorAction SilentlyContinue) { & uv pip install --python $python -r desktop/requirements.txt }
    else { & $python -m ensurepip; & $python -m pip install -r desktop/requirements.txt }
    if ($LASTEXITCODE) { throw '安装打包依赖失败' }
}
Push-Location frontend
try { & npm.cmd run build; if ($LASTEXITCODE) { throw '前端构建失败' } } finally { Pop-Location }
New-Item -ItemType Directory -Force .cache/packaging, releases | Out-Null
& $python -c "from backend.version import build_id; from pathlib import Path; Path('.cache/packaging/build-id.txt').write_text(build_id(), encoding='ascii')"
& $python -m PyInstaller --noconfirm --distpath releases/windows --workpath .cache/packaging/build desktop/PhotoCollection.spec
if ($LASTEXITCODE) { throw 'Windows 打包失败' }
$package = Join-Path $PSScriptRoot 'releases\windows\PhotoCollection'
Copy-Item README.md -Destination $package
New-Item -ItemType Directory -Force (Join-Path $package 'docs') | Out-Null
Copy-Item -Path docs/README.md, docs/development-handoff-2026-10-13.md, docs/storage-paths.md, docs/watercolor-usage.md, docs/watermark-reference-analysis.md -Destination (Join-Path $package 'docs')
# Private library configuration is opt-in and is never included in the distributable ZIP.
$publicFiles = Get-ChildItem -LiteralPath $package | Where-Object { $_.Name -ne 'library-config.json' } | Select-Object -ExpandProperty FullName
Compress-Archive -Path $publicFiles -DestinationPath releases/PhotoCollection-Windows.zip -Force
if ($UseCurrentLibrary -and (Test-Path library-config.json)) {
    $config = Get-Content -LiteralPath library-config.json -Raw -Encoding UTF8 | ConvertFrom-Json
    $config | Add-Member -NotePropertyName models_dir -NotePropertyValue (Join-Path $PSScriptRoot 'models') -Force
    $config | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $package 'library-config.json')
}
Write-Host "启动：$package\PhotoCollection.exe；分发：releases\PhotoCollection-Windows.zip"
