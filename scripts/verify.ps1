param(
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Debug',
    [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$localSdk = Join-Path $repository '.dotnet\dotnet.exe'
$sdk = if (Test-Path -LiteralPath $localSdk) { $localSdk } else { (Get-Command dotnet -ErrorAction Stop).Source }
Push-Location $repository
try {
    & $sdk restore SutraBrowser.sln
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
    & $sdk build SutraBrowser.sln -c $Configuration -m:1 --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    $results = Join-Path $repository ('artifacts\test-results\' + $Configuration + '-' + [Guid]::NewGuid().ToString('N'))
    & $sdk test SutraBrowser.sln -c $Configuration --no-build -m:1 --logger trx --results-directory $results
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    $testProjects = @(Get-ChildItem -Path 'tests\*\*.csproj')
    $testReports = @(Get-ChildItem -LiteralPath $results -Filter '*.trx' -ErrorAction SilentlyContinue)
    if ($testReports.Count -ne $testProjects.Count) { throw 'A test project produced no results. Check solution configuration mappings.' }
    foreach ($report in $testReports) {
        [xml]$run = Get-Content -LiteralPath $report.FullName -Raw
        if ([int]$run.TestRun.ResultSummary.Counters.executed -le 0 -or [int]$run.TestRun.ResultSummary.Counters.failed -ne 0) { throw 'A test run was empty or failed.' }
    }
    if (Get-Command node -ErrorAction SilentlyContinue) {
        foreach ($script in Get-ChildItem -LiteralPath 'Sutra Ultra\js' -Filter '*.js') {
            & node --check $script.FullName
            if ($LASTEXITCODE -ne 0) { throw 'New-tab JavaScript syntax validation failed.' }
        }
    }
    if ($Publish) {
        $package = Join-Path $repository ('artifacts\releases\' + $Configuration + '-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
        & $sdk publish src/Browser.App/Browser.App.csproj -c $Configuration -r win-x64 --self-contained true -o $package -m:1
        if ($LASTEXITCODE -ne 0) { throw 'Publish failed.' }
        foreach ($required in @('Sutra.App.exe', 'App.xbf', 'Sutra.App.pri', 'SutraUltra\index.html', 'SutraUltra\css\workspace.css')) {
            if (!(Test-Path -LiteralPath (Join-Path $package $required))) { throw "Published artifact is missing $required." }
        }
        $manifest = Get-ChildItem -LiteralPath $package -File -Recurse | ForEach-Object {
            [ordered]@{ path = [IO.Path]::GetRelativePath($package, $_.FullName); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
        }
        [ordered]@{ configuration = $Configuration; architecture = 'x64'; signing = 'Development build; no trusted update feed'; files = @($manifest) } |
            ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $package 'artifact-manifest.json') -Encoding utf8
        Write-Output "Verified development package: $package"
    }
}
finally { Pop-Location }
