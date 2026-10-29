param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$Tag
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$encodedCert = $env:SUTRA_SIGNING_CERT_BASE64
$password = $env:SUTRA_SIGNING_CERT_PASSWORD
if ([string]::IsNullOrWhiteSpace($encodedCert) -or [string]::IsNullOrWhiteSpace($password)) { throw 'Release signing credentials are not configured.' }
if ($Version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$' -or $Tag -notmatch '^browser-v[\d.]+$') { throw 'The release version or tag is invalid.' }

$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    [Convert]::FromBase64String($encodedCert),
    $password,
    [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
$privateKey = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
if ($null -eq $privateKey) { throw 'The release certificate does not contain an RSA private key.' }

$hash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
$upstreamCommit = (Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'vendor\Sutra\UPSTREAM_COMMIT')).Trim()
if ($upstreamCommit -notmatch '^[0-9a-fA-F]{40}$') { throw 'The vendor upstream commit pin is invalid.' }
$publishedAt = [DateTimeOffset]::UtcNow.ToString('O')
$installerUrl = "https://github.com/tanujranjith/Sutra-Browser/releases/download/$Tag/SutraBrowserSetup.exe"
$payload = [string]::Join("`n", @($Version, $installerUrl, $hash, $upstreamCommit.ToLowerInvariant(), $publishedAt))
$signature = [Convert]::ToBase64String($privateKey.SignData([Text.Encoding]::UTF8.GetBytes($payload), [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1))
$manifest = [ordered]@{
    Version = $Version
    InstallerUrl = $installerUrl
    Sha256 = $hash
    UpstreamCommit = $upstreamCommit
    PublishedAt = $publishedAt
    Signature = $signature
}
Set-Content -LiteralPath (Join-Path $repoRoot 'update.json') -Value ($manifest | ConvertTo-Json -Compress) -Encoding utf8
$privateKey.Dispose()
$certificate.Dispose()
