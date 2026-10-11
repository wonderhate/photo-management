#ifndef AppVersion
  #error AppVersion must be supplied by build-installer.ps1
#endif
#ifndef PackageDir
  #error PackageDir must be supplied by build-installer.ps1
#endif

[Setup]
AppId={{BCED57B5-7474-45C9-9D1A-0EC27E2E80F5}
AppName=Photo Collection
AppVersion={#AppVersion}
AppPublisher=wonderhate
AppPublisherURL=https://github.com/wonderhate/photo-management
AppSupportURL=https://github.com/wonderhate/photo-management/issues
DefaultDirName={localappdata}\Programs\PhotoCollection
DefaultGroupName=Photo Collection
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\releases
OutputBaseFilename=PhotoCollection-Setup-{#AppVersion}-x64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#PackageDir}\_internal\desktop\PhotoCollection.ico
UninstallDisplayIcon={app}\PhotoCollection.exe
CloseApplications=no
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Excludes: "library-config.json"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#WebViewBootstrap}"; DestName: "MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{group}\Photo Collection"; Filename: "{app}\PhotoCollection.exe"
Name: "{group}\{cm:UninstallProgram,Photo Collection}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Photo Collection"; Filename: "{app}\PhotoCollection.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\PhotoCollection.exe"; Description: "{cm:LaunchProgram,Photo Collection}"; Flags: nowait postinstall skipifsilent

; Do not delete a database, user configuration, exports or original photos during uninstall.

[CustomMessages]
english.WebViewMissing=WebView2 could not be installed. Check your internet connection, install Microsoft WebView2 Runtime and try again.
chinesesimplified.WebViewMissing=WebView2 could not be installed. Please install Microsoft WebView2 Runtime and try again.

[Code]
function RuntimeAt(Root: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(Root, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
end;

function HasWebView2: Boolean;
begin
  Result := RuntimeAt(HKLM32) or RuntimeAt(HKCU);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if HasWebView2 then exit;
  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) or not HasWebView2 then
    Result := CustomMessage('WebViewMissing');
end;
