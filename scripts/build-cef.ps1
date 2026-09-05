[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Debug',

    [string] $CefRoot
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativeSource = Join-Path $repositoryRoot 'native\Sutra.CefHost'
$buildRoot = Join-Path $nativeSource 'build'
$stageRoot = Join-Path $repositoryRoot "artifacts\cef\runtime\$Configuration"

if ([string]::IsNullOrWhiteSpace($CefRoot)) {
    $pinnedVersion = (Get-Content (Join-Path $nativeSource 'CEF_VERSION.txt') -Raw).Trim()
    $CefRoot = Join-Path $repositoryRoot "third_party\cef\cef_binary_$pinnedVersion"
}

$CefRoot = [System.IO.Path]::GetFullPath($CefRoot)
if (-not (Test-Path -LiteralPath (Join-Path $CefRoot 'cmake\FindCEF.cmake'))) {
    throw "CEF_ROOT is not an extracted Windows x64 CEF distribution: $CefRoot"
}

$cmake = Get-Command cmake -ErrorAction SilentlyContinue
if ($null -eq $cmake) {
    throw 'CMake was not found. Install Visual Studio 2022 Build Tools with the Desktop development with C++ workload and CMake tools.'
}

& $cmake.Source -S $nativeSource -B $buildRoot -G 'Visual Studio 17 2022' -A x64 "-DCEF_ROOT=$CefRoot"
if ($LASTEXITCODE -ne 0) { throw "CEF host configuration failed with exit code $LASTEXITCODE." }

& $cmake.Source --build $buildRoot --config $Configuration --target Sutra.CefHost Sutra.CefSubprocess
if ($LASTEXITCODE -ne 0) { throw "CEF host build failed with exit code $LASTEXITCODE." }

$stageFullPath = [System.IO.Path]::GetFullPath($stageRoot)
$artifactsFullPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'artifacts'))
if (-not $stageFullPath.StartsWith($artifactsFullPath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to reset a staging directory outside the repository artifacts directory: $stageFullPath"
}
if (Test-Path -LiteralPath $stageFullPath) {
    Remove-Item -LiteralPath $stageFullPath -Recurse -Force
}
New-Item -ItemType Directory -Path $stageFullPath -Force | Out-Null

$cefBinaryDirectory = Join-Path $CefRoot $Configuration
Copy-Item -LiteralPath (Join-Path $cefBinaryDirectory 'libcef.dll') -Destination $stageFullPath
Get-ChildItem -LiteralPath $cefBinaryDirectory -File |
    Where-Object { $_.Extension -ne '.lib' -and $_.Name -ne 'libcef.dll' } |
    Copy-Item -Destination $stageFullPath
Copy-Item -Path (Join-Path $CefRoot 'Resources\*') -Destination $stageFullPath -Recurse -Force
Copy-Item -LiteralPath (Join-Path $CefRoot 'LICENSE.txt') -Destination (Join-Path $stageFullPath 'CEF-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $CefRoot 'CREDITS.html') -Destination (Join-Path $stageFullPath 'CEF-CREDITS.html')

$nativeRuntime = Join-Path $buildRoot "runtime\$Configuration"
foreach ($name in @('Sutra.CefHost.dll', 'Sutra.CefSubprocess.exe')) {
    $source = Join-Path $nativeRuntime $name
    if (-not (Test-Path -LiteralPath $source)) { throw "Native build output is missing: $source" }
    Copy-Item -LiteralPath $source -Destination $stageFullPath -Force
}

Write-Host "Staged CEF runtime at $stageFullPath"
