$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testRoot = Join-Path $repoRoot ('artifacts\sync-test-' + [Guid]::NewGuid().ToString('N'))
$vendorPath = Join-Path $repoRoot 'vendor\Sutra'
$pinBefore = Get-Content -Raw -LiteralPath (Join-Path $vendorPath 'UPSTREAM_COMMIT')
$htmlHashBefore = (Get-FileHash -LiteralPath (Join-Path $vendorPath 'Sutra.html') -Algorithm SHA256).Hash

function Invoke-Git([string[]]$Arguments) {
    & git -C $testRoot @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the Browser-owned upstream fixture.' }
}

try {
    New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    $package = @{ name = 'sutra-sync-failure-fixture'; version = '1.0.0'; private = $true; scripts = @{ 'check:all' = 'node -e "process.exit(17)"'; 'test:unit' = 'node -e "process.exit(0)"' } }
    $lock = @{ name = $package.name; version = '1.0.0'; lockfileVersion = 3; requires = $true; packages = @{ '' = @{ name = $package.name; version = '1.0.0' } } }
    Set-Content -LiteralPath (Join-Path $testRoot 'package.json') -Value ($package | ConvertTo-Json -Depth 6) -Encoding utf8
    Set-Content -LiteralPath (Join-Path $testRoot 'package-lock.json') -Value ($lock | ConvertTo-Json -Depth 6) -Encoding utf8
    Set-Content -LiteralPath (Join-Path $testRoot 'Sutra.html') -Value '<h1>Browser-owned failing fixture</h1>'
    Invoke-Git @('init', '--quiet')
    Invoke-Git @('add', '.')
    Invoke-Git @('-c', 'user.name=Sutra sync test', '-c', 'user.email=sync-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Browser-owned sync fixture')
    $failed = $false
    try { & (Join-Path $PSScriptRoot 'sync-sutra-upstream.ps1') -UpstreamPath $testRoot }
    catch { $failed = $true }
    if (-not $failed) { throw 'The intentionally failing upstream check unexpectedly passed.' }
    if ((Get-Content -Raw -LiteralPath (Join-Path $vendorPath 'UPSTREAM_COMMIT')) -ne $pinBefore -or
        (Get-FileHash -LiteralPath (Join-Path $vendorPath 'Sutra.html') -Algorithm SHA256).Hash -ne $htmlHashBefore) { throw 'The failing sync changed the existing vendor copy.' }
    Write-Host 'PASS: a new failing upstream revision was rejected; the vendor source and pin stayed intact.'
}
finally {
    $resolved = [System.IO.Path]::GetFullPath($testRoot)
    $expectedRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'artifacts')).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a fixture outside artifacts.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
