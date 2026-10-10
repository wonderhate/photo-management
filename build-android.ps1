param([string]$JavaHome, [string]$AndroidSdk, [string]$Gradle, [switch]$SkipTests)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (!$JavaHome) { $JavaHome = $env:JAVA_HOME }
if (!$JavaHome -and (Test-Path .cache/android/jdk)) { $JavaHome = (Get-ChildItem .cache/android/jdk -Directory | Select-Object -First 1).FullName }
if (!$AndroidSdk) { $AndroidSdk = $env:ANDROID_HOME }
if (!$AndroidSdk -and (Test-Path .cache/android/sdk)) { $AndroidSdk = (Resolve-Path .cache/android/sdk).Path }
if (!$Gradle -and (Test-Path .cache/android/gradle/gradle-8.11.1/bin/gradle.bat)) { $Gradle = (Resolve-Path .cache/android/gradle/gradle-8.11.1/bin/gradle.bat).Path }
if (!$Gradle) { $Gradle = Join-Path $PSScriptRoot 'android/gradlew.bat' }
if (!$JavaHome -or !$AndroidSdk) { throw '需要 JDK 17、Android SDK 35 / Build Tools 35.0.0、Gradle 8.11.1，见 README。' }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdk
$env:GRADLE_USER_HOME = Join-Path $PSScriptRoot '.cache/android/gradle-home'
New-Item -ItemType Directory -Force .runtime/signing, releases | Out-Null
$keyFile = Join-Path $PSScriptRoot '.runtime/signing/android-release.p12'
$passwordFile = Join-Path $PSScriptRoot '.runtime/signing/android-password.txt'
if (!(Test-Path $keyFile)) {
    if (!(Test-Path $passwordFile)) {
        $randomBytes = New-Object byte[] 32
        $randomSource = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $randomSource.GetBytes($randomBytes) } finally { $randomSource.Dispose() }
        [IO.File]::WriteAllText($passwordFile, [Convert]::ToBase64String($randomBytes))
    }
    & "$JavaHome\bin\keytool.exe" -genkeypair -keystore $keyFile -storetype PKCS12 -storepass:file $passwordFile -alias photo-collection -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Photo Collection, OU=Local App, O=Wonder, C=CN'
    if ($LASTEXITCODE) { throw '签名密钥生成失败' }
}
if (!(Test-Path $passwordFile)) { throw '缺少签名密码；请恢复 .runtime/signing 备份，不能替换现有密钥。' }
$env:PHOTO_ANDROID_KEYSTORE = $keyFile
$env:PHOTO_ANDROID_STORE_PASSWORD = [IO.File]::ReadAllText($passwordFile).Trim()
try {
    $tasks = @('assembleRelease', 'lintRelease')
    if (!$SkipTests) { $tasks += 'testDebugUnitTest' }
    & $Gradle -p android @tasks --console plain --no-daemon
    if ($LASTEXITCODE) { throw 'Android 构建或检查失败' }
    $apk = Join-Path $PSScriptRoot 'android/app/build/outputs/apk/release/app-release.apk'
    $verify = Join-Path $AndroidSdk 'build-tools/35.0.0/apksigner.bat'
    & $verify verify --verbose $apk
    if ($LASTEXITCODE) { throw 'APK 签名校验失败' }
    Copy-Item -LiteralPath $apk -Destination releases/PhotoCollection-Android.apk
    Get-FileHash releases/PhotoCollection-Android.apk -Algorithm SHA256 | Select-Object Hash
    Write-Host '已生成 releases/PhotoCollection-Android.apk。请备份 .runtime/signing，用于后续版本更新。'
} finally {
    Remove-Item Env:PHOTO_ANDROID_KEYSTORE -ErrorAction SilentlyContinue
    Remove-Item Env:PHOTO_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue
}
