# Benchmarks

Machine-local repeatable benchmarks (#8). Results are only comparable on the same
machine and power plan. No data leaves the machine.

Run:

```powershell
.\scripts\bench.ps1 -Iterations 3
```

Output: `artifacts/bench/bench-<UTC timestamp>.json` with per-iteration build and
test milliseconds. The script builds Debug once per iteration and runs the full
test suite without rebuilding, so the numbers isolate test time from build time.

Startup timings (#5) are also visible in Browser health and in copied diagnostics;
slow cold starts (>= 5000 ms total, phases >= 1500 ms) are flagged in debug output.
