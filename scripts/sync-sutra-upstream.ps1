param(
    [string]$UpstreamPath = "",
    [switch]$ForceChecks
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$vendorPath = Join-Path $repoRoot 'vendor\Sutra'
$tempBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$tempBase = [System.IO.Path]::GetFullPath($tempBase)
$scratch = Join-Path $tempBase ("sutra-upstream-sync-" + [Guid]::NewGuid().ToString('N'))
$candidate = Join-Path $scratch 'candidate'
$backup = Join-Path $scratch 'previous-vendor'
$promotionStarted = $false
$promoted = $false

function Assert-ChildPath([string]$Path, [string]$Parent) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside the expected directory."
    }
    return $fullPath
}

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $File $($Arguments -join ' ')" }
    }
    finally { Pop-Location }
}

try {
    New-Item -ItemType Directory -Force -Path $scratch | Out-Null
    $null = Assert-ChildPath $scratch $tempBase
    $sourcePath = $UpstreamPath
    if ([string]::IsNullOrWhiteSpace($sourcePath)) {
        $sourcePath = Join-Path $scratch 'upstream'
        Invoke-Checked 'git' @('clone', '--depth', '1', 'https://github.com/tanujranjith/Sutra.git', $sourcePath) $repoRoot
    }
    $sourcePath = (Resolve-Path $sourcePath).Path
    if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'package.json'))) { throw 'The selected upstream folder is not a Sutra source checkout.' }
    $upstreamCommit = (& git -C $sourcePath rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $upstreamCommit -notmatch '^[0-9a-f]{40}$') { throw 'Could not read the Sutra upstream commit.' }
    $currentCommit = if (Test-Path -LiteralPath (Join-Path $vendorPath 'UPSTREAM_COMMIT')) { (Get-Content -Raw -LiteralPath (Join-Path $vendorPath 'UPSTREAM_COMMIT')).Trim() } else { '' }
    if ($currentCommit -eq $upstreamCommit -and -not $ForceChecks) {
        Write-Host "Sutra vendor is current at $upstreamCommit."
        return
    }

    New-Item -ItemType Directory -Force -Path $candidate | Out-Null
    Get-ChildItem -LiteralPath $sourcePath -Force |
        Where-Object { $_.Name -notin @('.git', 'node_modules') } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $candidate -Recurse -Force }
    Set-Content -LiteralPath (Join-Path $candidate 'UPSTREAM_COMMIT') -Value $upstreamCommit -NoNewline

    Push-Location $candidate
    try {
        Invoke-Checked 'npm' @('ci', '--no-audit', '--no-fund') $candidate
        Invoke-Checked 'npm' @('run', 'check:all') $candidate
        Invoke-Checked 'npm' @('run', 'test:unit') $candidate
    }
    finally { Pop-Location }

    $nodeModules = Join-Path $candidate 'node_modules'
    if (Test-Path -LiteralPath $nodeModules) {
        $null = Assert-ChildPath $nodeModules $candidate
        Remove-Item -LiteralPath $nodeModules -Recurse -Force
    }

    $null = Assert-ChildPath $vendorPath $repoRoot
    $promotionStarted = $true
    if (Test-Path -LiteralPath $vendorPath) { Move-Item -LiteralPath $vendorPath -Destination $backup }
    Move-Item -LiteralPath $candidate -Destination $vendorPath
    $promoted = $true

    $dotnet = Join-Path $repoRoot '.dotnet\dotnet.exe'
    if (Test-Path -LiteralPath $dotnet) { $env:DOTNET_ROOT = Join-Path $repoRoot '.dotnet' }
    else { $dotnet = (Get-Command dotnet -ErrorAction Stop).Source }
    Invoke-Checked $dotnet @('restore', 'SutraBrowser.sln', '-m:1', '-p:NuGetAudit=false', '--ignore-failed-sources', '/nodeReuse:false') $repoRoot
    Invoke-Checked $dotnet @('build', 'SutraBrowser.sln', '-c', 'Debug', '-m:1', '--no-restore', '/nodeReuse:false', '-p:NuGetAudit=false') $repoRoot
    Invoke-Checked $dotnet @('test', 'SutraBrowser.sln', '-c', 'Debug', '--no-build', '-m:1', '/nodeReuse:false', '-p:NuGetAudit=false') $repoRoot
    Invoke-Checked 'npm' @('ci', '--ignore-scripts', '--no-audit', '--no-fund') $repoRoot
    Invoke-Checked 'npm' @('run', 'test:desktop') $repoRoot
    Write-Host "Sutra vendor updated and Browser solution checks passed at $upstreamCommit."
}
catch {
    if ($promotionStarted) {
        $null = Assert-ChildPath $vendorPath $repoRoot
        if (Test-Path -LiteralPath $vendorPath) { Remove-Item -LiteralPath $vendorPath -Recurse -Force }
        if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $vendorPath }
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $scratch) {
        $null = Assert-ChildPath $scratch $tempBase
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
