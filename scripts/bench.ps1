# Repeatable performance benchmarks (#8). Machine-local only; results are not comparable across machines.
param([int]$Iterations = 3)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'artifacts/bench'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$dotnet = Join-Path $root '.dotnet/dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet)) { $dotnet = 'dotnet' }
$results = @()
for ($i = 1; $i -le $Iterations; $i++) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & $dotnet build "$root/SutraBrowser.sln" -c Debug -m:1 --nologo -v q
  if ($LASTEXITCODE -ne 0) { throw "build failed on iteration $i" }
  $buildMs = $sw.ElapsedMilliseconds
  $sw.Restart()
  & $dotnet test "$root/SutraBrowser.sln" -c Debug --no-build -m:1 --nologo -v q
  if ($LASTEXITCODE -ne 0) { throw "tests failed on iteration $i" }
  $testMs = $sw.ElapsedMilliseconds
  $results += [pscustomobject]@{ iteration = $i; build_ms = $buildMs; test_ms = $testMs }
  Write-Output "iteration ${i}: build ${buildMs}ms test ${testMs}ms"
}
$manifest = [pscustomobject]@{
  machine = $env:COMPUTERNAME
  timestamp = (Get-Date).ToUniversalTime().ToString('O')
  iterations = $results
}
$path = Join-Path $out ("bench-{0:yyyyMMdd-HHmmss}.json" -f (Get-Date).ToUniversalTime())
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
Write-Output "wrote $path"
