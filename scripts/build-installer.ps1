param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$Version = '',
    [switch]$RequireSigning
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$publishPath = Join-Path $repoRoot 'artifacts\publish'
$installerAssets = Join-Path $repoRoot 'artifacts\installer'
$setupPath = Join-Path $repoRoot 'SutraBrowserSetup.exe'
$tempCertPath = Join-Path ([System.IO.Path]::GetTempPath()) ("sutra-sign-" + [Guid]::NewGuid().ToString('N') + '.pfx')
$updaterProject = Join-Path $repoRoot 'src\Browser.Updater\Sutra.Updater.csproj'
$certAdded = $false
$signingCert = $null

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $File $($Arguments -join ' ')" }
    }
    finally { Pop-Location }
}

function Find-SignTool {
    $fromPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (Test-Path -LiteralPath $kits) {
        $candidate = Get-ChildItem -LiteralPath $kits -Directory | Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if ($candidate) { return $candidate }
    }
    throw 'Windows SDK signtool.exe was not found.'
}

try {
    if ($RequireSigning -and [string]::IsNullOrWhiteSpace($env:SUTRA_SIGNING_CERT_BASE64)) { throw 'Signing is required, but SUTRA_SIGNING_CERT_BASE64 is not configured.' }
    if ([string]::IsNullOrWhiteSpace($Version)) { $Version = $env:SUTRA_BROWSER_VERSION }
    if ([string]::IsNullOrWhiteSpace($Version)) {
        [xml]$coreProject = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'src\Browser.Core\Browser.Core.csproj')
        $Version = $coreProject.Project.PropertyGroup.Version | Select-Object -First 1
    }
    if ($Version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { throw 'Set a numeric x.y.z or x.y.z.w browser version before building the installer.' }
    $env:SUTRA_BROWSER_VERSION = $Version

    $dotnet = Join-Path $repoRoot '.dotnet\dotnet.exe'
    if (Test-Path -LiteralPath $dotnet) { $env:DOTNET_ROOT = Join-Path $repoRoot '.dotnet' }
    else { $dotnet = (Get-Command dotnet -ErrorAction Stop).Source }
    Invoke-Checked $dotnet @('publish', 'src/Browser.App/Browser.App.csproj', '-c', $Configuration, '-r', 'win-x64', '--self-contained', 'true', '-m:1', '/nodeReuse:false', "-p:Version=$Version", '-p:NuGetAudit=false', '-o', $publishPath) $repoRoot
    Invoke-Checked $dotnet @('publish', $updaterProject, '-c', $Configuration, '-r', 'win-x64', '--self-contained', 'true', '-m:1', '/nodeReuse:false', "-p:Version=$Version", '-p:NuGetAudit=false', '-o', $publishPath) $repoRoot

    New-Item -ItemType Directory -Force -Path $installerAssets | Out-Null
    $bootstrapper = Join-Path $installerAssets 'MicrosoftEdgeWebView2Setup.exe'
    if (-not (Test-Path -LiteralPath $bootstrapper)) {
        Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
    }
    $runtimeSignature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
    if ($runtimeSignature.Status -ne 'Valid' -or $runtimeSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
        throw 'The WebView2 bootstrapper must have a valid Microsoft Authenticode signature.'
    }
    $iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if (-not $iscc) {
        $known = @((Join-Path $repoRoot 'artifacts\tools\InnoSetup\ISCC.exe'), "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $known) { throw 'Inno Setup 6 is required. Install it and rerun scripts/build-installer.ps1.' }
        $isccPath = $known
    } else { $isccPath = $iscc.Source }
    $encodedCert = $env:SUTRA_SIGNING_CERT_BASE64
    if ([string]::IsNullOrWhiteSpace($encodedCert)) {
        if ($RequireSigning) { throw 'Signing is required, but SUTRA_SIGNING_CERT_BASE64 is not configured.' }
        Write-Warning 'Installer was built without Authenticode signing. Configure the signing certificate outside source control for production releases.'
    }
    else {
        [System.IO.File]::WriteAllBytes($tempCertPath, [Convert]::FromBase64String($encodedCert))
        $password = ConvertTo-SecureString $env:SUTRA_SIGNING_CERT_PASSWORD -AsPlainText -Force
        $signingCert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($tempCertPath, $password, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::UserKeySet)
        $rsaKey = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($signingCert)
        if ($null -eq $rsaKey) { throw 'The release signing certificate must contain an RSA private key.' }
        $rsaKey.Dispose()
        $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('My', [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        try {
            $existing = $store.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $signingCert.Thumbprint, $false)
            if ($existing.Count -eq 0) { $store.Add($signingCert); $certAdded = $true }
        }
        finally { $store.Close() }
        $signtool = Find-SignTool
        Get-ChildItem -LiteralPath $publishPath -Filter '*.exe' -File | ForEach-Object {
            Invoke-Checked $signtool @('sign', '/s', 'My', '/sha1', $signingCert.Thumbprint, '/fd', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256', $_.FullName) $repoRoot
            Invoke-Checked $signtool @('verify', '/pa', '/all', $_.FullName) $repoRoot
        }
    }
    Invoke-Checked $isccPath @('/Qp', (Join-Path $repoRoot 'installer\SutraBrowser.iss')) $repoRoot
    if ($signingCert) {
        Invoke-Checked $signtool @('sign', '/s', 'My', '/sha1', $signingCert.Thumbprint, '/fd', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256', $setupPath) $repoRoot
        Invoke-Checked $signtool @('verify', '/pa', '/all', $setupPath) $repoRoot
    }
    Write-Host "Installer created at $setupPath"
}
finally {
    if ($certAdded -and $signingCert) {
        $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('My', [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        try { $store.Remove($signingCert) } finally { $store.Close() }
    }
    if (Test-Path -LiteralPath $tempCertPath) { Remove-Item -LiteralPath $tempCertPath -Force }
    if ($signingCert) { $signingCert.Dispose() }
}
