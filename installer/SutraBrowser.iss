#define MyAppName "Sutra"
#define MyAppVersion GetEnv("SUTRA_BROWSER_VERSION")
#define MyAppPublisher "Sutra"
#define MyAppExeName "Sutra.exe"

[Setup]
AppId={{B0423B96-9D5B-4C9A-9557-3B7D660AD8D1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\Sutra
DefaultGroupName=Sutra
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
PrivilegesRequired=lowest
OutputDir=..
OutputBaseFilename=SutraBrowserSetup
SetupIconFile=..\src\Browser.App\Assets\sutra-browser.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
DisableProgramGroupPage=yes
Uninstallable=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "..\artifacts\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\artifacts\installer\MicrosoftEdgeWebView2Setup.exe"; Flags: dontcopy

[InstallDelete]
Type: files; Name: "{autoprograms}\Sutra Browser.lnk"
Type: files; Name: "{autodesktop}\Sutra Browser.lnk"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: postinstall nowait skipifsilent

[Code]
function HasRuntimeVersion(RootKey: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and
            (Version <> '') and (Version <> '0.0.0.0');
end;

function IsWebView2RuntimeInstalled: Boolean;
begin
  Result := HasRuntimeVersion(HKLM64) or HasRuntimeVersion(HKCU64) or
            HasRuntimeVersion(HKLM32) or HasRuntimeVersion(HKCU32);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if IsWebView2RuntimeInstalled then Exit;
  ExtractTemporaryFile('MicrosoftEdgeWebView2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
  begin
    Result := 'The Evergreen WebView2 Runtime installer could not start. Install the runtime and try again.';
    Exit;
  end;
  if (ExitCode <> 0) or not IsWebView2RuntimeInstalled then
    Result := 'The Evergreen WebView2 Runtime could not be installed. Check your internet connection, install the runtime, and try again.';
end;
