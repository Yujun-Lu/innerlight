$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$candidates = @($bundledNode, (Get-Command node -ErrorAction SilentlyContinue).Source)
$demoNode = $null
foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
        $version = & $candidate -p 'Number(process.versions.node.split(".")[0])'
        if ([int]$version -ge 22) { $demoNode = $candidate; break }
    }
}
if (-not $demoNode) { throw 'Please install Node.js 22.13 or newer, then run this launcher again.' }
$env:Path = (Split-Path -Parent $demoNode) + ';' + $env:Path
# A reused Windows process ID must not make an old preview look alive forever.
$demoLockPath = Join-Path $PSScriptRoot '.vinext\dev\lock.json'
if (Test-Path -LiteralPath $demoLockPath) {
    try {
        $demoLock = Get-Content -LiteralPath $demoLockPath -Raw | ConvertFrom-Json
        $demoOwner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$demoLock.pid) -ErrorAction SilentlyContinue
        $demoStarted = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$demoLock.startedAt).UtcDateTime
        $demoReusedPid = $demoOwner -and ($demoOwner.CreationDate.ToUniversalTime() -gt $demoStarted.AddSeconds(1))
        if ((-not $demoOwner -or $demoReusedPid) -and -not (Get-NetTCPConnection -LocalPort ([int]$demoLock.port) -State Listen -ErrorAction SilentlyContinue)) {
            $demoRuntime = Join-Path $PSScriptRoot '.sites-runtime'
            New-Item -ItemType Directory -Path $demoRuntime -Force | Out-Null
            Move-Item -LiteralPath $demoLockPath -Destination (Join-Path $demoRuntime ('stale-dev-lock-' + [DateTime]::UtcNow.Ticks + '.json'))
        }
    } catch { Write-Host 'Could not inspect the previous preview; the framework will check it.' }
}
if (-not (Test-Path -LiteralPath 'node_modules\vinext\dist\cli.js')) {
    throw 'Dependencies are missing. Install with a modern Node.js version: npm install'
}
Write-Host 'Innerlight demo: http://127.0.0.1:5173' -ForegroundColor Green
Write-Host 'Keep this window open. Press Ctrl+C to stop.'
& $demoNode scripts/run-framework.mjs dev
