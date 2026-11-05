[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$reportDir = Join-Path $repoRoot 'local-audit-logs'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $reportDir "agentic-quality-gate-$stamp.log"
$reportPath = Join-Path $reportDir "agentic-quality-gate-$stamp.md"

$checks = @(
    [pscustomobject]@{ Name = 'TypeScript typecheck'; Executable = 'npm'; Arguments = @('run', 'typecheck') },
    [pscustomobject]@{ Name = 'ESLint'; Executable = 'npm'; Arguments = @('run', 'lint') },
    [pscustomobject]@{ Name = 'Playwright browser tests'; Executable = 'npm'; Arguments = @('run', 'test:e2e') },
    [pscustomobject]@{ Name = 'Next.js production build'; Executable = 'npm'; Arguments = @('run', 'build') },
    [pscustomobject]@{ Name = 'Dependency audit (high severity and above)'; Executable = 'npm'; Arguments = @('audit', '--audit-level=high') }
)

$results = @()
"Paxones agentic quality gate - $stamp" | Out-File -FilePath $logPath -Encoding utf8
"Repository: $repoRoot" | Out-File -FilePath $logPath -Append -Encoding utf8
"Branch/status baseline:" | Out-File -FilePath $logPath -Append -Encoding utf8
(git status --short --branch 2>&1 | Out-String) | Out-File -FilePath $logPath -Append -Encoding utf8

foreach ($check in $checks) {
    Write-Host "`n=== $($check.Name) ===" -ForegroundColor Cyan
    "`n`n=== $($check.Name) ===" | Out-File -FilePath $logPath -Append -Encoding utf8
    $argsForCommand = $check.Arguments
    $output = & $check.Executable @argsForCommand 2>&1
    $exitCode = $LASTEXITCODE
    $output | Out-File -FilePath $logPath -Append -Encoding utf8
    if ($exitCode -eq 0) {
        $status = 'PASS'
        Write-Host "PASS: $($check.Name)" -ForegroundColor Green
    } else {
        $status = 'FAIL'
        Write-Host "FAIL (exit $exitCode): $($check.Name)" -ForegroundColor Yellow
    }
    $results += [pscustomobject]@{ Check = $check.Name; Status = $status; ExitCode = $exitCode }
}

$lines = @(
    '# Paxones Agentic Quality Gate',
    '',
    "- Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
    "- Branch: $((git branch --show-current).Trim())",
    '- Scope: local checks only; no production database or wallet actions are run.',
    '',
    '| Check | Result | Exit code |',
    '|---|---|---:|'
)
foreach ($result in $results) {
    $lines += "| $($result.Check) | $($result.Status) | $($result.ExitCode) |"
}
$failed = @($results | Where-Object { $_.Status -ne 'PASS' })
$lines += ''
if ($failed.Count -eq 0) {
    $lines += 'All configured checks passed. This is not, by itself, proof of production readiness.'
} else {
    $lines += "**$($failed.Count) check(s) failed.** Inspect the paired `.log` file and fix root causes; do not suppress failing checks."
}
$lines += ''
$lines += "Full output: $([System.IO.Path]::GetFileName($logPath))"
$lines | Out-File -FilePath $reportPath -Encoding utf8

Write-Host "`nSummary: $reportPath"
Write-Host "Full log: $logPath"
Write-Host "Passed: $(@($results | Where-Object Status -eq 'PASS').Count); Failed: $($failed.Count)"
if ($failed.Count -gt 0) { exit 1 }
exit 0
