param([string]$Compiler)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (!$Compiler) {
    $candidates = @((Join-Path $PSScriptRoot '.cache/inno/compiler/ISCC.exe'), 'C:\Program Files\Inno Setup 7\ISCC.exe', 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe')
    $Compiler = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (!$Compiler) { throw 'Install Inno Setup 7 or pass -Compiler with the ISCC.exe path.' }
$package = Join-Path $PSScriptRoot 'releases/windows/PhotoCollection'
$exe = Join-Path $package 'PhotoCollection.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Run build-windows.ps1 first.' }
& (Join-Path $PSScriptRoot '.venv/Scripts/python.exe') desktop/release_audit.py $package
if ($LASTEXITCODE) { throw 'Release privacy/resource audit failed; rebuild the public package.' }
$version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'The executable must have a valid product version.' }
$bootstrap = Join-Path $PSScriptRoot '.cache/packaging/MicrosoftEdgeWebview2Setup.exe'
if (!(Test-Path -LiteralPath $bootstrap)) {
    New-Item -ItemType Directory -Force (Split-Path $bootstrap) | Out-Null
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrap -UseBasicParsing
}
$signature = Get-AuthenticodeSignature -LiteralPath $bootstrap
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*') { throw 'WebView2 bootstrapper publisher verification failed.' }
& $Compiler "/DAppVersion=$version" "/DPackageDir=$package" "/DWebViewBootstrap=$bootstrap" desktop/installer.iss
if ($LASTEXITCODE) { throw 'Installer build failed.' }
Get-FileHash -LiteralPath "releases/PhotoCollection-Setup-$version-x64.exe" -Algorithm SHA256
